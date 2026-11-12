export const CLIENTS = ['codex', 'claude', 'copilot', 'gemini', 'cursor', 'opencode'] as const;
export type ClientId = typeof CLIENTS[number];
export type Severity = 'error' | 'warn' | 'info';
export type Status = 'active' | 'conditional' | 'shadowed' | 'ignored' | 'truncated' | 'invalid';
export type Kind = 'instructions' | 'rules' | 'settings' | 'mcp' | 'skill' | 'hooks';
export interface Location { path: string; line: number; column: number; key?: string }
export interface Finding {
  id: string; ruleId: string; severity: Severity; client?: ClientId;
  message: string; location: Location; related: Location[]; why: string; suggestion: string;
}
/** Internal sources contain raw text. Only public scan() output is safe to export. */
export interface Source {
  id: string; path: string; relativePath: string; owners: ClientId[]; kind: Kind;
  scope: 'user' | 'repository' | 'directory' | 'system' | 'import'; baseDir: string;
  bytes: number; text: string; body: string; bodyLine: number;
  data: Record<string, any>; lines: Record<string, number>; invalid: boolean;
}
export interface Decision {
  sourceId: string; path: string; line: number; kind: Kind; scope: Source['scope'];
  status: Status; reason: string; order: number | null; bytes: number; loadedBytes: number;
  estimatedTokens: number; content: string; importedFrom?: Location;
}
export interface Setting {
  key: string; value: unknown; status: Status; location: Location;
  reason: string; overrides: Location[];
}
export interface Extension {
  kind: 'mcp' | 'skill' | 'hook' | 'permission'; name: string;
  status: Status; location: Location; config: Record<string, any>; reason: string;
}
export interface AdapterMetadata {
  id: ClientId; name: string; maturity: 'verified' | 'experimental';
  ruleVersion: string; verifiedOn: string; evidence: string[]; limitations: string[];
}
export interface Effective {
  client: ClientId; metadata: AdapterMetadata; detected: boolean; executable: string | null;
  decisions: Decision[]; instructions: string; instructionBytes: number; estimatedTokens: number;
  settings: Setting[]; extensions: Extension[]; findings: Finding[]; notes: string[];
}
export interface Report {
  schemaVersion: '1.0'; tool: { name: string; version: string };
  repository: string; target: string; sessionDirectory: string;
  assumptions: string[]; sources: Omit<Source, 'text' | 'body' | 'data' | 'lines' | 'baseDir'>[];
  clients: Effective[]; findings: Finding[];
  diff: { content: string; clients: ClientId[]; sources: Location[] }[];
}
export interface ScanOptions {
  repo?: string; target?: string; clients?: ClientId[]; home?: string; user?: boolean;
  trust?: 'auto' | 'trusted' | 'untrusted'; system?: boolean;
  env?: NodeJS.ProcessEnv; maxFiles?: number;
}
export interface Context {
  repo: string; target: string; directory: string; home: string; codexHome: string;
  claudeHome: string; copilotHome: string; dirs: string[]; sources: Source[];
  findings: Finding[]; options: ScanOptions; env: NodeJS.ProcessEnv;
  read: (path: string, owner: ClientId, kind: Kind, scope?: Source['scope']) => Promise<Source | null>;
}
export interface Adapter {
  metadata: AdapterMetadata;
  detect(ctx: Context): Promise<{ detected: boolean; executable: string | null }>;
  discover(ctx: Context): Promise<Source[]>;
  parse(source: Source): Source;
  resolveForTarget(ctx: Context): Promise<Effective>;
  validate(ctx: Context, effective: Effective): Promise<Finding[]>;
  probe(extension: Extension, ctx: Context): Promise<Finding[]>;
  explain(effective: Effective): string[];
}
