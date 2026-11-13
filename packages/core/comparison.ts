import type { Effective, InstructionBlock, Source } from './types.js';
import { stripComments } from './utils.js';

function paragraphs(content: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fence = '';
  for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = '';
    }
    if (!line.trim() && !fence) {
      if (lines.length) blocks.push(lines.join('\n'));
      lines = [];
    } else lines.push(line);
  }
  if (lines.length) blocks.push(lines.join('\n'));
  return blocks;
}

export function compareInstructions(clients: Effective[], sources: Source[]): InstructionBlock[] {
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
      let cursor = 0;
      let sourceLine = 1;
      let sourceColumn = 1;
      let canLocate = true;
      for (const content of paragraphs(decision.content)) {
        const block = blocks.get(content) ?? { content, clients: [], origins: [] };
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
