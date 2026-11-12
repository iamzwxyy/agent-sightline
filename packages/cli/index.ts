#!/usr/bin/env node
import path from 'node:path';
import { rename, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { scan, adapters } from '../core/index.js';
import { CLIENTS, type ClientId, type Report, type ScanOptions, type Severity } from '../core/types.js';
import { failed, filter, html, json, terminal } from '../reporter/index.js';
import { redactText } from '../core/redact.js';
import { serve } from '../web/server.js';
import { VERSION } from '../core/version.js';

const program = new Command().exitOverride();
const severity = (s: string): Severity => { if (!['error', 'warn', 'info'].includes(s)) throw new InvalidArgumentError('Choose error, warn or info.'); return s as Severity; };
const client = (s: string): ClientId => { if (!CLIENTS.includes(s as ClientId)) throw new InvalidArgumentError(`Choose ${CLIENTS.join(', ')}.`); return s as ClientId; };
const failOn = (s: string): Severity | 'none' => s === 'none' ? s : severity(s);
program.name('agent-sightline').description('See what your coding agent actually sees. Local, read-only configuration diagnostics.')
  .version(VERSION).argument('[repository]', 'directory to scan (default: current directory)')
  .option('--repo <directory>', 'inspection boundary / repository directory')
  .option('--client <client>', 'inspect one client', client)
  .option('--clients <list>', 'comma-separated client IDs')
  .option('--json', 'stable, redacted JSON output')
  .option('--format <format>', 'terminal, json or html')
  .option('--output <file>', 'atomically write a report to this path')
  .option('--severity <level>', 'show this severity and higher', severity)
  .option('--fail-on <level>', 'exit 1 for findings at this severity or higher; none disables', failOn)
  .option('--trust <state>', 'auto, trusted or untrusted; trusted assumes project/server approval', 'auto')
  .option('--no-user', 'exclude user configuration')
  .option('--home <directory>', 'explicit user home for reproducible isolated scans')
  .option('--system', 'also inspect documented system configuration')
  .option('--probe', 'doctor only: launch local stdio MCP servers and test initialize/tools-list')
  .option('--port <port>', 'ui only: loopback port; 0 chooses a free port', '0')
  .option('--no-open', 'ui only: print URL without opening the browser')
  .addHelpText('after', '\nExamples:\n  agent-sightline\n  agent-sightline examples/broken-agent-config --no-user\n  agent-sightline explain src/payments/refund.ts --client codex --trust trusted\n  agent-sightline diff src/payments/refund.ts --clients codex,claude,copilot\n  agent-sightline report --format html --output report.html\n  agent-sightline ci --no-user --fail-on warn --json\n  agent-sightline ui --no-open\n\nExit codes: 0 success; 1 finding threshold reached; 2 input/inspection error.\nInterruptions use 130 for SIGINT and 143 for SIGTERM.\nEnvironment values are redacted. No client, hook or MCP process runs unless doctor --probe is supplied.');

function options(target?: string, repository?: string): ScanOptions & { probe?: boolean } {
  const o = program.opts();
  if (!['auto', 'trusted', 'untrusted'].includes(o.trust)) throw new Error('--trust must be auto, trusted or untrusted.');
  if (o.client && o.clients) throw new Error('Use either --client or --clients.');
  const clients = o.client ? [o.client] : o.clients ? [...new Set(String(o.clients).split(',').map(x => client(x.trim())))] : undefined;
  return { repo: path.resolve(o.repo ?? repository ?? process.cwd()), target, clients, user: o.user, home: o.home ? path.resolve(o.home) : undefined, trust: o.trust, system: o.system, probe: o.probe };
}
async function atomic(file: string, content: string): Promise<void> {
  const destination = path.resolve(file);
  // Validate parent; do not create a tree on invalid output paths.
  const temporary = path.join(path.dirname(destination), `.sightline-${randomUUID()}.tmp`);
  try { await writeFile(temporary, content, { flag: 'wx', mode: 0o600 }); await rename(temporary, destination); }
  catch { await unlink(temporary).catch(() => {}); throw new Error('Cannot write report. Choose an existing writable parent directory.'); }
}
async function run(mode: string, target?: string, repository?: string): Promise<void> {
  const o = program.opts();
  if (o.probe && mode !== 'doctor') throw new Error('--probe is available only with doctor.');
  const format = o.json ? 'json' : o.format ?? (mode === 'ci' ? 'json' : 'terminal');
  if (!['terminal', 'json', 'html'].includes(format) || o.json && o.format && o.format !== 'json') throw new Error('Choose --format terminal, json or html; --json cannot be combined with another format.');
  const controller = new AbortController();
  let interrupted: 'SIGINT' | 'SIGTERM' | undefined;
  const interrupt = () => { interrupted = 'SIGINT'; controller.abort(); };
  const terminate = () => { interrupted = 'SIGTERM'; controller.abort(); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  let report: Report;
  try { report = await scan({ ...options(target, repository), signal: controller.signal }); }
  catch (error) {
    if (interrupted) { process.exitCode = interrupted === 'SIGINT' ? 130 : 143; return; }
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
  const outputReport = filter(report, o.severity);
  const content = format === 'html' ? html(outputReport) : format === 'json' ? json(outputReport) : terminal(outputReport, mode === 'ci' || mode === 'doctor' || mode === 'report' ? 'scan' : mode);
  if (o.output) await atomic(o.output, content); else process.stdout.write(content);
  process.exitCode = failed(report, o.failOn ?? (mode === 'ci' ? 'error' : 'none')) ? 1 : 0;
}
async function openInspector(scanOptions: ScanOptions): Promise<void> {
  const o = program.opts();
  if (o.probe) throw new Error('UI does not execute MCP probes. Use doctor --probe.');
  const port = Number(o.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be an integer from 0 to 65535.');
  const server = await serve(scanOptions, port);
  process.stdout.write(`Agent Sightline is listening at ${server.url}\nPress Ctrl+C to stop.\n`);
  if (o.open !== false) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open';
    const child = spawn(command, process.platform === 'win32' ? ['url.dll,FileProtocolHandler', server.url] : [server.url], { stdio: 'ignore', detached: true, shell: false });
    child.on('error', () => {}); child.unref();
  }
  const stop = () => { void server.close().then(() => { process.exitCode = 0; }); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
program.action(repository => run('scan', undefined, repository));
for (const mode of ['scan', 'doctor', 'ci', 'report']) program.command(mode).description(mode === 'doctor' ? 'Validate extensions and optionally probe local stdio MCP startup' : mode === 'ci' ? 'Machine-readable diagnostics with a finding exit threshold' : mode === 'report' ? 'Export terminal, JSON or a portable standalone HTML report' : 'Discover and diagnose configuration').action(() => run(mode));
program.command('explain <target>').description('Explain file-scoped loading, ignored sources and effective configuration').action(target => run('explain', target));
program.command('diff <target>').description('Compare instruction recipients and extension definitions').action(target => run('diff', target));
program.command('demo').description('Explore the bundled intentionally broken example').option('--ui', 'open the sample workspace in the browser inspector').action(commandOptions => {
  program.setOptionValue('user', false); program.setOptionValue('trust', 'trusted');
  const repository = fileURLToPath(new URL('../../examples/broken-agent-config', import.meta.url));
  program.setOptionValue('repo', repository);
  return commandOptions.ui ? openInspector(options('src/payments/refund.ts', repository)) : run('scan', 'src/payments/refund.ts', repository);
});
program.command('adapters').description('List rule versions, source links and known limitations').action(() => {
  const list = adapters.map(a => a.metadata); process.stdout.write(program.opts().json ? JSON.stringify(list, null, 2) + '\n' : list.map(m => `${m.id.padEnd(9)} ${m.maturity.padEnd(12)} ${m.ruleVersion}\n  Verified: ${m.verifiedOn}\n  ${m.evidence.join('\n  ')}\n  Limits: ${m.limitations.join(' ')}`).join('\n\n') + '\n');
});
program.command('version').description('Print package version').action(() => { process.stdout.write(VERSION + '\n'); });
program.command('ui').description('Open a read-only inspector on 127.0.0.1').action(() => openInspector(options()));
// Useful for shells and CI; never echo raw parser errors or environment values.
program.exitOverride().configureOutput({ outputError: str => process.stderr.write(redactText(str)) });
try { await program.parseAsync(); } catch (error) {
  if (error instanceof CommanderError && error.exitCode === 0) { process.exitCode = 0; }
  else {
  const message = error instanceof InvalidArgumentError ? error.message : (error as Error).message;
  process.stderr.write(`agent-sightline: ${redactText(message)}\nNext: run agent-sightline --help.\n`); process.exitCode = 2;
  }
}
