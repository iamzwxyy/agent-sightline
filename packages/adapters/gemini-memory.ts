import path from 'node:path';
import { access, lstat, readFile, readlink, realpath } from 'node:fs/promises';
import type { Context, Effective, Location, Source } from '../core/types.js';
import { bytes, cmp, finding, within } from '../core/utils.js';
import { decision, effectiveValue } from './common.js';
import { parseSource } from '../core/parse.js';
import { redactSourcePreview } from '../core/redact.js';

interface Reference { path: string; start: number; end: number }
interface ContextText { text: string; redacted: string }

function capturePrivacy(source: Source): void {
  if (source.kind !== 'instructions' || source.valueRanges !== undefined) return;
  const parsed = { ...source, kind: 'rules' as const, data: {}, lines: {}, invalid: false };
  parseSource(parsed);
  source.valueRanges = parsed.valueRanges;
}

function privateReference(source: Source, reference: Reference): boolean {
  return source.valueRanges?.some(range => range.private && range.offset < reference.end && range.offset + range.length > reference.start) ?? false;
}

function redactFragment(source: Source, start: number, end: number): string {
  const valueRanges = source.valueRanges?.filter(range => range.offset < end && range.offset + range.length > start).map(range => ({
    ...range, offset: Math.max(start, range.offset) - start,
    length: Math.min(end, range.offset + range.length) - Math.max(start, range.offset),
  }));
  return redactSourcePreview({ ...source, text: source.text.slice(start, end), valueRanges }, value => value);
}

// Matches the published 0.68.0 processor's ASCII boundaries and backtick regions.
function references(text: string): Reference[] {
  const code = [...text.matchAll(/(`+)([\s\S]*?)\1/g)].map(match => [match.index, match.index + match[0].length]);
  return [...text.matchAll(/(?:^|[ \t\r\n])@([./A-Za-z][^ \t\r\n]*)/g)].flatMap(match => {
    const start = match.index + match[0].indexOf('@');
    return code.some(([left, right]) => start >= left && start < right) ? [] : [{ path: match[1], start, end: match.index + match[0].length }];
  });
}

function location(source: Source, offset: number): Location {
  const before = source.text.slice(0, offset);
  return { path: source.path, line: before.split('\n').length, column: before.length - before.lastIndexOf('\n') };
}

async function canonical(filename: string, seen = new Set<string>()): Promise<string> {
  const key = process.platform === 'win32' ? filename.toLowerCase() : filename;
  if (seen.has(key)) throw new Error('Cyclic import path.');
  seen.add(key);
  try { return await realpath(filename); }
  catch (error) {
    if (!['ENOENT', 'EISDIR', 'ENAMETOOLONG', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    const info = await lstat(filename).catch((error: NodeJS.ErrnoException) => {
      if (!['ENOENT', 'EISDIR', 'ENAMETOOLONG', 'ENOTDIR'].includes(error.code ?? '')) throw error;
      return null;
    });
    if (info?.isSymbolicLink()) return canonical(path.resolve(path.dirname(filename), await readlink(filename)), seen);
    const parent = path.dirname(filename);
    return parent === filename ? filename : path.join(await canonical(parent, seen), path.basename(filename));
  }
}

function nativeWithin(root: string, filename: string): boolean {
  return process.platform === 'darwin' ? within(root.toLowerCase(), filename.toLowerCase()) : within(root, filename);
}

async function memoryRoot(ctx: Context, directory: string, markers: string[]): Promise<string> {
  let current = directory;
  if (!markers.length) return directory;
  for (;;) {
    ctx.options.signal?.throwIfAborted();
    for (const marker of markers) {
      if (path.isAbsolute(marker) || marker.includes('..')) continue;
      if (await access(path.join(current, marker)).then(() => true, () => false)) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return directory;
    current = parent;
  }
}

export async function resolveGeminiMemory(e: Effective, ctx: Context, includeProject = true): Promise<void> {
  const configuredNames = effectiveValue(e, 'context.fileName', 'GEMINI.md');
  const names = [...new Set([...(Array.isArray(configuredNames) ? configuredNames : [configuredNames]), 'GEMINI.md']
    .filter((name): name is string => typeof name === 'string').map(name => name.trim())
    .filter(name => name && !name.includes('/') && !name.includes('\\')))];
  const markers = effectiveValue(e, 'context.memoryBoundaryMarkers', ['.git']);
  if (!Array.isArray(markers) || markers.some(marker => typeof marker !== 'string')) {
    const setting = e.settings.findLast(setting => setting.key === 'context.memoryBoundaryMarkers');
    e.findings.push(finding('gemini.context-type', 'error', setting!.location, 'context.memoryBoundaryMarkers must be an array of strings.', 'Gemini cannot traverse context boundaries with this value.', 'Use an array of marker filenames, or an empty array for the launch directory.', 'gemini'));
    return;
  }
  const format = effectiveValue(e, 'context.importFormat') === 'flat' ? 'flat' : 'tree';
  const boundary = await memoryRoot(ctx, ctx.directory, markers);
  const userRoot = ctx.geminiHome;
  const roots: Source[] = [];
  if (ctx.options.user !== false) for (const name of names) {
    const source = await ctx.read(path.join(userRoot, name), 'gemini', 'instructions', 'user');
    if (source) { capturePrivacy(source); roots.push(source); }
  }
  const projectPaths = ctx.dirs.filter(directory => includeProject && nativeWithin(boundary, directory) && directory !== userRoot)
    .flatMap(directory => names.map(name => path.join(directory, name))).sort(cmp);
  for (const filename of [...new Set(projectPaths)]) {
    const source = await ctx.read(filename, 'gemini', 'instructions');
    if (source) { capturePrivacy(source); roots.push(source); }
  }

  function retainPrivateText(content: string): void {
    if (!content.trim()) return;
    const values = ctx.privateInstructionValues ??= new Set();
    values.add(content); values.add(content.trim());
  }

  function trace(source: Source, content: string, offset: number, importedFrom?: Location): string {
    const origin = location(source, offset);
    // An imported configuration file contributes literal text to Gemini.
    const textSource = { ...source, kind: 'instructions' as const, bodyLine: origin.line, invalid: false };
    const entry = decision(e, textSource, 'active', importedFrom ? 'Text from a Gemini context import, in native loading order.' : 'Text from a global or applicable project context file.', content, importedFrom);
    entry.column = origin.column;
    const redacted = redactFragment(source, offset, offset + content.length);
    if (redacted !== content) (ctx.redactedInstructionContent ??= new WeakMap()).set(entry, redacted);
    if (source.valueRanges?.some(range => range.private && range.offset === 0 && range.length === source.text.length)) retainPrivateText(content);
    return redacted;
  }

  function incomplete(origin: Location): void {
    if (ctx.discovery) ctx.discovery.complete = false;
    e.findings.push(finding('include.inspection-scope', 'warn', origin, 'Gemini context import could not be fully inspected.', 'The declared import exceeds the repository/user configuration scope or an existing source-reading limit.', 'Inspect the imported directory explicitly or reduce the source size, then rerun the inspection.', 'gemini'));
  }

  async function resolveReference(source: Source, reference: Reference, root: string, scope: string): Promise<{ target: string; failure?: string; incomplete?: boolean }> {
    ctx.options.signal?.throwIfAborted();
    const origin = location(source, reference.start);
    const target = path.resolve(path.dirname(source.path), reference.path);
    let accepted = false;
    try {
      let decodedTarget = target, decodedRoot = root;
      try { decodedTarget = decodeURIComponent(target); } catch { /* Native validation retains malformed escapes. */ }
      try { decodedRoot = decodeURIComponent(root); } catch { /* Native validation retains malformed escapes. */ }
      accepted = !/^(file|https?):\/\//.test(reference.path) && nativeWithin(await canonical(decodedRoot), await canonical(decodedTarget));
    } catch { ctx.options.signal?.throwIfAborted(); }
    if (!accepted) {
      e.findings.push(finding('include.outside-scope', 'warn', origin, 'Gemini rejects this context import path.', 'The resolved path is outside this context file’s native memory boundary or uses a rejected URL scheme.', 'Use a local file inside the applicable memory boundary.', 'gemini'));
      return { target, failure: `<!-- Import failed: ${reference.path} - Path traversal attempt -->` };
    }
    const allowed = await canonical(scope);
    const resolved = await canonical(target).catch(() => undefined);
    if (!resolved || !within(allowed, resolved)) {
      incomplete(origin);
      return { target, incomplete: true };
    }
    return { target };
  }

  async function readImport(source: Source, reference: Reference, target: string, privateContent = false): Promise<{ source?: Source; failure?: string }> {
    const origin = location(source, reference.start);
    try {
      await access(target);
      const info = await lstat(target);
      if (!info.isFile()) await readFile(target, { encoding: 'utf8', signal: ctx.options.signal });
      const imported = await ctx.read(target, 'gemini', 'instructions', source.scope === 'user' ? 'user' : 'import');
      if (imported) {
        capturePrivacy(imported);
        if (privateContent && !imported.valueRanges?.some(range => range.private && range.offset === 0 && range.length === imported.text.length)) {
          imported.valueRanges = [...imported.valueRanges ?? [], { offset: 0, length: imported.text.length, value: imported.text.trim() ? imported.text : undefined, private: true }];
          for (const contribution of e.decisions.filter(contribution => contribution.sourceId === imported.id)) retainPrivateText(contribution.content);
        }
        return { source: imported };
      }
      incomplete(origin);
      return {};
    } catch (error) {
      ctx.options.signal?.throwIfAborted();
      e.findings.push(finding('include.missing', 'error', origin, 'Gemini context import cannot be read.', 'The declared file is missing or cannot be opened as instruction text.', 'Correct the path or file permissions and rerun the inspection.', 'gemini'));
      return { failure: `<!-- Import failed: ${reference.path} - ${(error as Error).message} -->` };
    }
  }

  async function tree(source: Source, root: string, scope: string, processed: Set<string>, depth = 0, importedFrom?: Location): Promise<ContextText> {
    const refs = references(source.text);
    if (!refs.length || depth >= 5) {
      const redacted = trace(source, source.text, 0, importedFrom);
      if (depth >= 5 && refs.length) e.findings.push(finding('include.depth', 'info', location(source, refs[0].start), 'Gemini retains nested import directives at its five-level tree limit.', 'The published tree processor returns the deepest file as literal text.', 'Shorten the import chain to load the remaining referenced content.', 'gemini'));
      return { text: source.text, redacted };
    }
    let result = '', redacted = '', cursor = 0;
    for (const reference of refs) {
      const content = source.text.slice(cursor, reference.start);
      if (content || cursor === 0) redacted += trace(source, content, cursor, importedFrom);
      result += content;
      const hidden = privateReference(source, reference);
      const resolved = await resolveReference(source, reference, root, scope);
      if (resolved.failure) { result += resolved.failure; redacted += hidden ? '[REDACTED]' : resolved.failure; }
      else if (!resolved.incomplete && processed.has(resolved.target)) {
        const duplicate = `<!-- File already processed: ${reference.path} -->`;
        result += duplicate; redacted += hidden ? '[REDACTED]' : duplicate;
        e.findings.push(finding('include.cycle', 'error', location(source, reference.start), 'Circular Gemini context import.', 'This path already occurs in the current import chain.', 'Remove the back-reference.', 'gemini'));
      } else if (!resolved.incomplete) {
        const imported = await readImport(source, reference, resolved.target, hidden);
        if (imported.failure) { result += imported.failure; redacted += hidden ? '[REDACTED]' : imported.failure; }
        else if (imported.source) {
          const next = new Set(processed); next.add(resolved.target);
          const content = await tree(imported.source, root, scope, next, depth + 1, location(source, reference.start));
          result += `<!-- Imported from: ${reference.path} -->\n${content.text}\n<!-- End of import from: ${reference.path} -->`;
          redacted += hidden ? '[REDACTED]' : `<!-- Imported from: ${reference.path} -->\n${content.redacted}\n<!-- End of import from: ${reference.path} -->`;
        }
      }
      cursor = reference.end;
    }
    const tail = source.text.slice(cursor);
    if (tail) redacted += trace(source, tail, cursor, importedFrom);
    return { text: result + tail, redacted };
  }

  async function flat(source: Source, root: string, scope: string): Promise<ContextText> {
    const pending: { source: Source; reference?: Reference }[] = [{ source }];
    const processed = new Set<string>();
    const blocks: string[] = [];
    const redactedBlocks: string[] = [];
    while (pending.length) {
      ctx.options.signal?.throwIfAborted();
      const entry = pending.pop()!;
      let current = entry.source;
      let label = path.dirname(source.path);
      let origin: Location | undefined;
      if (entry.reference) {
        origin = location(current, entry.reference.start);
        const resolved = await resolveReference(current, entry.reference, root, scope);
        if (resolved.failure || resolved.incomplete) continue;
        label = resolved.target;
        if (processed.has(label)) {
          e.findings.push(finding('include.duplicate', 'info', origin, 'Gemini flat context already includes this path.', 'The flat processor loads each normalized path once per context root.', 'Keep a single reference where possible.', 'gemini'));
          continue;
        }
        const imported = await readImport(current, entry.reference, label);
        if (!imported.source) continue;
        current = imported.source;
      }
      processed.add(label);
      const content = current.text.trim();
      const redacted = trace(current, content, current.text.length - current.text.trimStart().length, origin);
      blocks.push(`--- File: ${label} ---\n${content}\n--- End of File: ${label} ---`);
      redactedBlocks.push(`--- File: ${label} ---\n${redacted}\n--- End of File: ${label} ---`);
      for (const reference of references(current.text)) pending.push({ source: current, reference });
    }
    return { text: blocks.join('\n\n'), redacted: redactedBlocks.join('\n\n') };
  }

  const contexts: string[] = [];
  const redactedContexts: string[] = [];
  for (const source of roots) {
    const root = await memoryRoot(ctx, path.dirname(source.path), markers);
    const scope = source.scope === 'user' ? userRoot : ctx.repo;
    const content = format === 'flat' ? await flat(source, root, scope) : await tree(source, root, scope, new Set());
    if (content.text.trim()) {
      contexts.push(`--- Context from: ${source.path} ---\n${content.text.trim()}\n--- End of Context from: ${source.path} ---`);
      redactedContexts.push(`--- Context from: ${source.path} ---\n${content.redacted.trim()}\n--- End of Context from: ${source.path} ---`);
    }
  }
  e.instructions = redactedContexts.join('\n\n');
  e.instructionBytes = bytes(contexts.join('\n\n'));
  e.estimatedTokens = Math.ceil(e.instructionBytes / 4);
  e.notes.push(`Gemini context import format: ${format}. Published 0.68.0 context and import delimiters are included in effective text.`, 'Tree imports retain repeated sibling references and stop expanding at five levels. Flat imports load normalized paths once in reverse encounter order. Import origins retain their source line and column.');
}
