import { keywordSessionIds, listSessions } from '../opencode';
import type { SessionRow } from '../types';
import { anyDirMatch, compileDirGlob, normalizePath } from './glob';

export interface SearchFilters {
  keyword: string;
  include: string[];
  exclude: string[];
}

export interface SearchOutput {
  items: SessionRow[];
  keywordHit: number;
}

export function parseGlobInput(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runSearch(filters: SearchFilters): Promise<SearchOutput> {
  const keyword = filters.keyword.trim();
  const includeGlob = filters.include.map(compileDirGlob);
  const excludeGlob = filters.exclude.map(compileDirGlob);
  const hasInclude = filters.include.length > 0;
  const hasExclude = filters.exclude.length > 0;

  const [rows, contentHits] = await Promise.all([
    listSessions(),
    keyword ? keywordSessionIds(keyword) : Promise.resolve<string[] | null>(null),
  ]);
  const kw = keyword.toLowerCase();
  const hitSet = contentHits ? new Set(contentHits) : null;

  const items: SessionRow[] = [];
  for (const row of rows) {
    if (hasInclude || hasExclude) {
      const dir = normalizePath(row.directory || row.projectId || '');
      if (hasInclude && !anyDirMatch(includeGlob, dir)) continue;
      if (hasExclude && anyDirMatch(excludeGlob, dir)) continue;
    }
    if (kw) {
      if (hitSet && hitSet.has(row.id)) {
        items.push(row);
        continue;
      }
      const meta = [row.id, row.slug, row.title, row.directory, row.projectId, row.model]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      if (meta.includes(kw)) items.push(row);
    } else {
      items.push(row);
    }
  }
  return { items, keywordHit: hitSet ? hitSet.size : 0 };
}

export interface DirGroup {
  key: string;
  dir: string;
  rows: SessionRow[];
}

export function groupByDir(items: SessionRow[]): DirGroup[] {
  const groups = new Map<string, DirGroup>();
  for (const row of items) {
    const dir = normalizePath(row.directory || row.projectId || '');
    const key = dir ? dir.toLowerCase() : 'global';
    const label = dir || '全局';
    let g = groups.get(key);
    if (!g) {
      g = { key, dir: label, rows: [] };
      groups.set(key, g);
    }
    g.rows.push(row);
  }
  return Array.from(groups.values()).sort((a, b) => a.dir.localeCompare(b.dir, 'zh-Hans-CN'));
}