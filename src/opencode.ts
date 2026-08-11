import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type {
  DayStat,
  ModelStat,
  ProjectStat,
  SessionExport,
  SessionRow,
  Stats,
  StatsOverview,
} from './types';

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const EXE = process.platform === 'win32' ? '.exe' : '';
let binaryCache: string | undefined;

export function getConfig<T>(key: string, def: T): T {
  return vscode.workspace.getConfiguration('opencodeHistory').get<T>(key, def);
}

export function resetBinaryCache(): void {
  binaryCache = undefined;
}

export function getDataDir(): string {
  const cfg = getConfig<string>('dataPath', '').trim();
  if (cfg) return cfg;
  return path.join(os.homedir(), '.local', 'share', 'opencode');
}

export function getDbFile(): string {
  return path.join(getDataDir(), 'opencode.db');
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function listCandidates(): string[] {
  const out: string[] = [];
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    if (process.platform === 'win32') {
      out.push(path.join(dir, 'opencode.cmd'));
      out.push(path.join(dir, 'opencode.exe'));
      out.push(path.join(dir, 'opencode.bat'));
    } else {
      out.push(path.join(dir, 'opencode'));
    }
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    out.push(path.join(home, 'AppData', 'Roaming', 'npm', 'opencode.cmd'));
    out.push(path.join(home, 'AppData', 'Roaming', 'npm', 'opencode.exe'));
  } else {
    out.push(path.join(home, '.opencode', 'bin', 'opencode'));
    out.push(path.join(home, '.local', 'bin', 'opencode'));
  }
  return out;
}

function deriveRealBinary(cmdPath: string): string {
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(cmdPath)) return cmdPath;
  const base = path.dirname(cmdPath);
  const candidates = [
    path.join(base, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(base, 'node_modules', 'opencode-ai', 'bin', 'opencode'),
    path.join(base, 'opencode.exe'),
  ];
  const real = candidates.find(isFile);
  return real || cmdPath;
}

export async function resolveBinary(): Promise<string> {
  if (binaryCache) return binaryCache;
  const cfg = getConfig<string>('opencodePath', '').trim();
  if (cfg) {
    const looksLikePath = cfg.includes('/') || cfg.includes('\\');
    if (looksLikePath) {
      if (isFile(cfg)) {
        binaryCache = deriveRealBinary(cfg);
        return binaryCache;
      }
      throw new Error(`opencodeHistory.opencodePath 配置的路径不存在: ${cfg}`);
    }
  }
  for (const c of listCandidates()) {
    if (isFile(c)) {
      binaryCache = deriveRealBinary(c);
      return binaryCache;
    }
  }
  throw new Error(
    '未找到 opencode 可执行文件。请在设置 opencodeHistory.opencodePath 中指定其绝对路径。'
  );
}

function findNodeBin(): string | undefined {
  const cfg = getConfig<string>('nodePath', '').trim();
  if (cfg && isFile(cfg)) return cfg;
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const dir of paths) {
    const candidates =
      process.platform === 'win32'
        ? [path.join(dir, 'node.exe'), path.join(dir, 'node.cmd')]
        : [path.join(dir, 'node')];
    for (const p of candidates) {
      if (isFile(p)) return p;
    }
  }
  return undefined;
}

function run(bin: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    const nodeBin = findNodeBin();
    if (nodeBin) env.PATH = path.dirname(nodeBin) + path.delimiter + (env.PATH || '');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.homedir();
    let child;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
      child = spawn(bin, args, { env, cwd, shell: true, windowsHide: true });
    } else {
      child = spawn(bin, args, { env, cwd, windowsHide: true });
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* noop */
      }
      reject(new Error(`opencode 执行超时(${timeoutMs}ms): ${args[0] ?? bin}`));
    }, timeoutMs);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`无法启动 opencode: ${err.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

export async function opencodeJson<T>(args: string[], opts?: { timeoutMs?: number }): Promise<T> {
  const bin = await resolveBinary();
  const res = await run(bin, args, opts?.timeoutMs ?? 30_000);
  const text = res.stdout.trim();
  if (!text) {
    const hint = res.stderr.trim().slice(0, 300);
    throw new Error(`opencode ${args[0]} 无输出${hint ? ' (stderr: ' + hint + ')' : ''}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`无法解析 opencode 输出为 JSON (${args[0]}): ${text.slice(0, 200)}`);
  }
}

export async function queryDb<T>(sql: string): Promise<T> {
  return opencodeJson<T>(['db', sql, '--format', 'json'], { timeoutMs: 60_000 });
}

const SESSION_COLS =
  'id, slug, title, project_id AS projectId, directory, path, agent, model, cost, ' +
  'tokens_input AS tokensInput, tokens_output AS tokensOutput, tokens_reasoning AS tokensReasoning, ' +
  'tokens_cache_read AS tokensCacheRead, tokens_cache_write AS tokensCacheWrite, ' +
  'time_created AS createdAt, time_updated AS updatedAt';

function normalizeSessionRow(r: Partial<SessionRow>): SessionRow {
  return {
    id: String(r.id ?? ''),
    slug: r.slug ?? null,
    title: r.title ?? null,
    projectId: r.projectId ?? null,
    directory: r.directory ?? null,
    path: r.path ?? null,
    agent: r.agent ?? null,
    model: r.model ?? null,
    cost: Number(r.cost) || 0,
    tokensInput: Number(r.tokensInput) || 0,
    tokensOutput: Number(r.tokensOutput) || 0,
    tokensReasoning: Number(r.tokensReasoning) || 0,
    tokensCacheRead: Number(r.tokensCacheRead) || 0,
    tokensCacheWrite: Number(r.tokensCacheWrite) || 0,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}

export async function listSessions(): Promise<SessionRow[]> {
  try {
    const rows = await queryDb<Partial<SessionRow>[]>(
      `SELECT ${SESSION_COLS} FROM session ORDER BY time_updated DESC`
    );
    return rows.map(normalizeSessionRow).filter((r) => r.id.startsWith('ses_'));
  } catch (err) {
    const fallback = await opencodeJson<SessionRow[]>(['session', 'list', '--format', 'json']);
    return fallback
      .map((r) => ({
        ...r,
        createdAt: Number((r as unknown as { created?: number }).created) || 0,
        updatedAt: Number((r as unknown as { updated?: number }).updated) || 0,
      }))
      .map(normalizeSessionRow);
  }
}

export async function exportSession(id: string): Promise<SessionExport> {
  const data = await opencodeJson<SessionExport>(['export', id], { timeoutMs: 60_000 });
  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
    throw new Error(`导出结果无效(session: ${id})`);
  }
  return data;
}

export async function deleteSession(id: string): Promise<void> {
  const bin = await resolveBinary();
  const res = await run(bin, ['session', 'delete', id], 30_000);
  if (res.code !== 0) {
    throw new Error(res.stderr.trim() || `删除失败(code=${res.code})`);
  }
}

function sqlQuote(s: string): string {
  return s.replace(/'/g, "''");
}

export async function keywordSessionIds(keyword: string): Promise<string[]> {
  const kw = sqlQuote(keyword);
  const rows = await queryDb<{ session_id: string }[]>(
    `SELECT DISTINCT session_id AS session_id FROM part WHERE instr(lower(data), lower('${kw}')) > 0
     UNION
     SELECT DISTINCT session_id AS session_id FROM message WHERE instr(lower(data), lower('${kw}')) > 0`
  );
  return rows.map((r) => String(r.session_id)).filter(Boolean);
}

export async function continueSessionInTerminal(id: string, sessionDir?: string): Promise<void> {
  const name = `opencode ${id.slice(0, 8)}`;
  const cwd = sessionDir || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const term = vscode.window.createTerminal({
    name,
    cwd,
    location: {
      viewColumn: vscode.ViewColumn.Beside,
      preserveFocus: false,
    },
    env: {
      OPENCODE_CALLER: 'vscode',
    },
  });
  term.show();
  term.sendText(`opencode --session "${id}"`);
}

export async function fetchStats(): Promise<Stats> {
  const num = (v: unknown) => Number(v) || 0;
  const [overviewRaw, byProjectRaw, byDayRaw, byModelRaw] = await Promise.all([
    queryDb<StatsOverview[]>(
      'SELECT count(*) AS sessions, sum(tokens_input) AS tokensInput, sum(tokens_output) AS tokensOutput, sum(tokens_reasoning) AS tokensReasoning, sum(cost) AS cost FROM session'
    ),
    queryDb<ProjectStat[]>(
      'SELECT project_id AS projectId, directory, count(*) AS sessions, sum(tokens_input)+sum(tokens_output) AS tokens, sum(cost) AS cost FROM session GROUP BY project_id ORDER BY count(*) DESC LIMIT 15'
    ),
    queryDb<DayStat[]>(
      "SELECT date(time_updated/1000, 'unixepoch') AS day, count(*) AS sessions, sum(tokens_input)+sum(tokens_output) AS tokens, sum(cost) AS cost FROM session GROUP BY day ORDER BY day DESC LIMIT 30"
    ),
    queryDb<ModelStat[]>(
      'SELECT model, count(*) AS sessions, sum(tokens_input)+sum(tokens_output) AS tokens, sum(cost) AS cost FROM session GROUP BY model ORDER BY count(*) DESC LIMIT 10'
    ),
  ]);
  const overview = (overviewRaw[0] ?? {}) as Partial<StatsOverview>;
  return {
    overview: {
      sessions: num(overview.sessions),
      tokensInput: num(overview.tokensInput),
      tokensOutput: num(overview.tokensOutput),
      tokensReasoning: num(overview.tokensReasoning),
      cost: num(overview.cost),
    },
    byProject: byProjectRaw.map((r) => ({ ...r, sessions: num(r.sessions), tokens: num(r.tokens), cost: num(r.cost) })),
    byDay: byDayRaw.reverse().map((r) => ({ ...r, sessions: num(r.sessions), tokens: num(r.tokens), cost: num(r.cost) })),
    byModel: byModelRaw.map((r) => ({ ...r, sessions: num(r.sessions), tokens: num(r.tokens), cost: num(r.cost) })),
  };
}
