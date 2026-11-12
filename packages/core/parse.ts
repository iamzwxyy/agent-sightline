import { parseTree, getNodeValue, type Node, type ParseError, printParseErrorCode } from 'jsonc-parser';
import { parse as toml } from 'smol-toml';
import { parseDocument, LineCounter } from 'yaml';
import { finding, lineAt, plainObject } from './utils.js';
import type { Finding, Source } from './types.js';

export function parseSource(s: Source): Finding[] {
  const findings: Finding[] = [];
  const issue = (rule: string, message: string, line = 1) => {
    s.invalid = true;
    findings.push(finding(rule, 'error', { path: s.path, line, column: 1 }, message, 'The client cannot reliably parse this source.', 'Correct the syntax and rerun the scan.'));
  };
  if (!s.text.trim()) findings.push(finding('source.empty', 'info', { path: s.path, line: 1, column: 1 }, 'Empty configuration source.', 'It contributes no settings or instructions.', 'Add content or remove the unused file.'));
  if (s.kind === 'instructions') return findings;
  try {
    if (/\.jsonc?$/.test(s.path)) {
      const errors: ParseError[] = [];
      const jsonc = s.path.endsWith('.jsonc') || s.owners.includes('copilot') && s.kind === 'settings' && s.path.endsWith('settings.json');
      const tree = parseTree(s.text, errors, { allowTrailingComma: jsonc, disallowComments: !jsonc });
      for (const e of errors) issue('parse.json', printParseErrorCode(e.error), lineAt(s.text, e.offset));
      const visit = (n: Node, keys: string[]) => {
        if (n.type === 'object') {
          const seen = new Set<string>();
          for (const p of n.children ?? []) {
            const name = String(p.children![0].value); const full = [...keys, name].join('.');
            s.lines[full] = lineAt(s.text, p.offset);
            if (seen.has(name)) issue('parse.duplicate-key', `Duplicate key "${name}".`, s.lines[full]);
            seen.add(name); visit(p.children![1], [...keys, name]);
          }
        } else if (n.type === 'array') (n.children ?? []).forEach((x, i) => visit(x, [...keys, String(i)]));
      };
      if (tree) { visit(tree, []); const v = getNodeValue(tree); if (!plainObject(v)) issue('parse.structure', 'Expected an object at the top level.'); else s.data = v; }
    } else if (s.path.endsWith('.toml')) {
      s.data = toml(s.text);
      let section = '';
      s.text.split('\n').forEach((l, i) => {
        const header = l.match(/^\s*\[\[?(.+?)\]\]?\s*(?:#.*)?$/);
        if (header) section = header[1].replace(/"([^"\\]*)"/g, '$1');
        const key = l.match(/^\s*([\w.-]+|"[^"\n]+")\s*=/);
        if (key) s.lines[[section, key[1].replace(/^"|"$/g, '')].filter(Boolean).join('.')] = i + 1;
        if (header) s.lines[section] = i + 1;
      });
    } else if (/\.ya?ml$/.test(s.path)) {
      const lc = new LineCounter(); const doc = parseDocument(s.text, { uniqueKeys: true, lineCounter: lc });
      for (const e of doc.errors) issue(e.code === 'DUPLICATE_KEY' ? 'parse.duplicate-key' : 'parse.yaml', e.code, e.linePos?.[0].line ?? 1);
      const v = doc.toJS(); if (!plainObject(v)) issue('parse.structure', 'Expected a YAML mapping.'); else s.data = v;
    } else {
      if (s.kind !== 'rules' && s.kind !== 'skill') return findings;
      const fm = s.text.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
      if (fm) {
        const doc = parseDocument(fm[1], { uniqueKeys: true });
        for (const e of doc.errors) issue(e.code === 'DUPLICATE_KEY' ? 'parse.duplicate-key' : 'parse.frontmatter', e.code, (e.linePos?.[0].line ?? 1) + 1);
        const v = doc.toJS(); if (v != null && !plainObject(v)) issue('parse.frontmatter', 'Frontmatter must be a mapping.', 2); else s.data = v ?? {};
        s.body = s.text.slice(fm[0].length); s.bodyLine = lineAt(s.text, fm[0].length);
        fm[1].split('\n').forEach((l, i) => { const m = l.match(/^([\w-]+):/); if (m) s.lines[m[1]] = i + 2; });
      } else if (/^---\r?\n/.test(s.text)) issue('parse.frontmatter', 'Unclosed Markdown frontmatter.');
    }
  } catch (error) {
    const e = error as { line?: number; message?: string };
    // Parser messages may contain the raw offending value; use only a generic error.
    issue(s.path.endsWith('.toml') ? 'parse.toml' : 'parse.yaml', 'Invalid syntax (including possible duplicate keys).', e.line ?? 1);
  }
  return findings;
}
