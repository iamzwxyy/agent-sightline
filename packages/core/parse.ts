import { parseTree, getNodeValue, type Node, type ParseError, printParseErrorCode } from 'jsonc-parser';
import { parse as toml } from 'smol-toml';
import { parseDocument, LineCounter } from 'yaml';
import { finding, lineAt, plainObject } from './utils.js';
import type { Finding, Source } from './types.js';

const jsonErrorMessages: Record<string, string> = {
  InvalidSymbol: 'Unexpected token in JSON.',
  InvalidNumberFormat: 'Invalid JSON number.',
  PropertyNameExpected: 'Expected a property name in double quotes.',
  ValueExpected: 'Expected a JSON value.',
  ColonExpected: "Expected ':' after the property name.",
  CommaExpected: "Expected ',' between items.",
  CloseBraceExpected: "Expected '}' to close the object.",
  CloseBracketExpected: "Expected ']' to close the array.",
  EndOfFileExpected: 'Unexpected content after the JSON value.',
  InvalidCommentToken: 'Remove comments from this strict JSON file.',
  UnexpectedEndOfComment: 'Unclosed block comment.',
  UnexpectedEndOfString: 'Unclosed JSON string.',
  UnexpectedEndOfNumber: 'Incomplete JSON number.',
  InvalidUnicode: 'Invalid Unicode escape in the string.',
  InvalidEscapeCharacter: 'Invalid escape sequence in the string.',
  InvalidCharacter: 'Invalid character in the string.',
};

export function parseSource(s: Source): Finding[] {
  const findings: Finding[] = [];
  const issue = (rule: string, message: string, line = 1, column = 1) => {
    s.invalid = true;
    findings.push(finding(rule, 'error', { path: s.path, line, column }, message, 'The client cannot reliably parse this source.', 'Correct the syntax and rerun the scan.'));
  };
  if (!s.text.trim()) findings.push(finding('source.empty', 'info', { path: s.path, line: 1, column: 1 }, 'Empty configuration source.', 'It contributes no settings or instructions.', 'Add content or remove the unused file.'));
  if (s.kind === 'instructions') return findings;
  let syntaxRule = 'parse.frontmatter';
  try {
    if (/\.jsonc?$/.test(s.path)) {
      syntaxRule = 'parse.json';
      const errors: ParseError[] = [];
      const jsonc = s.path.endsWith('.jsonc') || s.owners.includes('copilot') && s.kind === 'settings' && s.path.endsWith('settings.json');
      const tree = parseTree(s.text, errors, { allowTrailingComma: jsonc, disallowComments: !jsonc });
      for (const error of errors) {
        const message = jsonErrorMessages[printParseErrorCode(error.error)] ?? 'Invalid JSON syntax.';
        issue('parse.json', message, lineAt(s.text, error.offset), error.offset - s.text.slice(0, error.offset).lastIndexOf('\n'));
      }
      const visit = (n: Node, keys: string[]) => {
        if (n.type === 'object') {
          const seen = new Set<string>();
          for (const p of n.children ?? []) {
            const name = String(p.children![0].value); const full = [...keys, name].join('.');
            s.lines[full] = lineAt(s.text, p.offset);
            if (seen.has(name)) issue('parse.duplicate-key', `Duplicate key "${name}".`, s.lines[full], p.offset - s.text.slice(0, p.offset).lastIndexOf('\n'));
            seen.add(name);
            // A recovered JSON tree can retain a property whose value is missing.
            if (p.children?.[1]) visit(p.children[1], [...keys, name]);
          }
        } else if (n.type === 'array') (n.children ?? []).forEach((x, i) => {
          const elementKeys = [...keys, String(i)];
          s.lines[elementKeys.join('.')] = lineAt(s.text, x.offset);
          visit(x, elementKeys);
        });
      };
      if (tree) { visit(tree, []); const v = getNodeValue(tree); if (!plainObject(v)) issue('parse.structure', 'Expected an object at the top level.'); else s.data = v; }
    } else if (s.path.endsWith('.toml')) {
      syntaxRule = 'parse.toml';
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
      syntaxRule = 'parse.yaml';
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
    issue(syntaxRule, 'Invalid syntax (including possible duplicate keys).', e.line ?? 1);
  }
  return findings;
}
