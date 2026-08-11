export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileGlob(glob: string): RegExp {
  const g = normalizePath(glob.trim());
  if (!g) return new RegExp('^$', 'i');
  let re = '';
  let i = 0;
  while (i < g.length) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        if (g[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (c === '?') {
      re += '[^/]';
      i += 1;
    } else if (c === '{') {
      const end = g.indexOf('}', i);
      if (end === -1) {
        re += '\\{';
        i += 1;
      } else {
        const body = g
          .slice(i + 1, end)
          .split(',')
          .map((s) => escapeRegExp(s.trim()))
          .filter(Boolean)
          .join('|');
        re += `(?:${body})`;
        i = end + 1;
      }
    } else if (c === '[') {
      const end = g.indexOf(']', i + 1);
      if (end === -1) {
        re += '\\[';
        i += 1;
      } else {
        re += g.slice(i, end + 1);
        i = end + 1;
      }
    } else {
      re += escapeRegExp(c);
      i += 1;
    }
  }
  return new RegExp(`^${re}$`, 'i');
}

export function matchesAny(patterns: RegExp[], path: string): boolean {
  const p = normalizePath(path);
  return patterns.some((r) => r.test(p));
}

export function isMatch(patterns: RegExp[], path: string): boolean {
  return matchesAny(patterns, path);
}

export interface DirGlob {
  test(dir: string): boolean;
}

export function compileDirGlob(glob: string): DirGlob {
  const g = normalizePath(glob.trim());
  const full = compileGlob(g);
  let prefix: RegExp | null = null;
  if (g.endsWith('/**')) {
    const p = g.slice(0, -3);
    if (p) prefix = compileGlob(p);
  }
  return {
    test(dir: string): boolean {
      const d = normalizePath(dir);
      if (full.test(d)) return true;
      return prefix ? prefix.test(d) : false;
    },
  };
}

export function anyDirMatch(globs: DirGlob[], dir: string): boolean {
  return globs.some((x) => x.test(dir));
}