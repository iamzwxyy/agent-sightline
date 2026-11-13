import type { Effective, InstructionBlock, Source } from './types.js';
import { stripComments } from './utils.js';

function paragraphs(content: string): { content: string; startLine: number; endLine: number }[] {
  const blocks: { content: string; startLine: number; endLine: number }[] = [];
  let lines: string[] = [];
  let fence = '';
  let startLine = 0;
  const sourceLines = content.replace(/\r\n/g, '\n').split('\n');
  for (const [index, line] of sourceLines.entries()) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = '';
    }
    if (!line.trim() && !fence) {
      if (lines.length) blocks.push({ content: lines.join('\n'), startLine, endLine: index - 1 });
      lines = [];
    } else {
      if (!lines.length) startLine = index;
      lines.push(line);
    }
  }
  if (lines.length) blocks.push({ content: lines.join('\n'), startLine, endLine: sourceLines.length - 1 });
  return blocks;
}

export function compareInstructions(clients: Effective[], sources: Source[], scrub: (text: string) => string): InstructionBlock[] {
  const blocks = new Map<string, InstructionBlock>();
  const sourceById = new Map(sources.map(source => [source.id, source]));
  for (const client of clients) {
    let order = 0;
    for (const decision of client.decisions) {
      if (!['active', 'truncated'].includes(decision.status) || !['instructions', 'rules'].includes(decision.kind)) continue;
      const source = sourceById.get(decision.sourceId);
      const prefix = source?.text.slice(0, source.text.length - source.body.length).replace(/[^\r\n]/g, '\0') ?? '';
      const body = source?.body ?? '';
      const sourceText = (prefix + (client.client === 'claude' ? stripComments(body, true) : body)).replace(/\r\n/g, '\n');
      const contentLines = scrub(decision.content.replace(/\r\n/g, '\n')).split('\n');
      let cursor = 0;
      let sourceLine = 1;
      let sourceColumn = 1;
      let canLocate = true;
      for (const paragraph of paragraphs(decision.content)) {
        const content = paragraph.content;
        const redacted = scrub(content);
        const contextual = contentLines.slice(paragraph.startLine, paragraph.endLine + 1).join('\n');
        const block = blocks.get(content) ?? { content: redacted, clients: [], origins: [] };
        if (contextual !== redacted) block.content = '[REDACTED]';
        if (!block.clients.includes(client.client)) block.clients.push(client.client);
        const origin: InstructionBlock['origins'][number] = {
          client: client.client, location: { path: decision.path, line: decision.line, column: 1 }, order: ++order,
        };
        const offset = canLocate ? sourceText.indexOf(content, cursor) : -1;
        if (offset >= 0) {
          const before = sourceText.slice(cursor, offset);
          sourceLine += before.match(/\n/g)?.length ?? 0;
          sourceColumn = before.includes('\n') ? before.length - before.lastIndexOf('\n') : sourceColumn + before.length;
          origin.location = { path: decision.path, line: sourceLine, column: sourceColumn };
          origin.endLine = sourceLine + (content.match(/\n/g)?.length ?? 0);
          cursor = offset + content.length;
          sourceLine = origin.endLine;
          sourceColumn = content.includes('\n') ? content.length - content.lastIndexOf('\n') : sourceColumn + content.length;
        } else canLocate = false;
        block.origins.push(origin);
        blocks.set(content, block);
      }
    }
  }
  return [...blocks.values()];
}
