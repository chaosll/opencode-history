import * as vscode from 'vscode';
import { fmtK, relTime } from '../format';
import { getConfig } from '../opencode';
import { esc } from '../render/renderDetail';
import { groupByDir, runSearch } from '../search/searchEngine';
import type { SessionRow } from '../types';

export type ViewMode = 'tree' | 'list';

export interface MainViewActions {
  openDetail(id: string): Promise<void>;
  copyExport(id: string): Promise<void>;
  continueSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;
  openFolder(id: string): Promise<void>;
}

interface PersistedFilters {
  keyword: string;
  include: string;
  exclude: string;
}

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function buildUserCss(): string {
  const size = getConfig<string>('itemFontSize', '').trim();
  const color = getConfig<string>('itemFontColor', '').trim();
  const subSize = getConfig<string>('subFontSize', '').trim();
  const subColor = getConfig<string>('subFontColor', '').trim();
  const activeBg = getConfig<string>('activeItemBackground', '').trim();
  const activeColor = getConfig<string>('activeItemFontColor', '').trim();
  const activeSize = getConfig<string>('activeItemFontSize', '').trim();
  const rules: string[] = [];
  if (size) rules.push(`.sess .sess-title{font-size:${size}!important}`);
  if (color) rules.push(`.sess .sess-title{color:${color}!important}`);
  if (subSize) rules.push(`.sess .sess-sub{font-size:${subSize}!important}`);
  if (subColor) rules.push(`.sess .sess-sub{color:${subColor}!important}`);
  if (activeBg) rules.push(`.sess.active{background:${activeBg}!important}`);
  if (activeColor) rules.push(`.sess.active .sess-title{color:${activeColor}!important}`);
  if (activeSize) rules.push(`.sess.active .sess-title{font-size:${activeSize}!important}`);
  return rules.join('');
}

export class MainViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private filters: PersistedFilters;
  private mode: ViewMode;
  private itemsRaw: SessionRow[] = [];
  private activeId = '';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly actions: MainViewActions
  ) {
    this.filters = context.workspaceState.get<PersistedFilters>('opencodeHistory.filters', {
      keyword: '',
      include: '',
      exclude: '',
    });
    this.mode = context.workspaceState.get<ViewMode>('opencodeHistory.viewMode', 'tree');
  }

  get itemCount(): number {
    return this.itemsRaw.length;
  }

  get items(): SessionRow[] {
    return this.itemsRaw;
  }

  findRow(id: string): SessionRow | undefined {
    return this.itemsRaw.find((r) => r.id === id);
  }

  private postRender(html: string): void {
    this.view?.webview.postMessage({
      cmd: 'render',
      html,
      count: this.itemsRaw.length,
      mode: this.mode,
      css: buildUserCss(),
    });
  }

  setActive(id: string | undefined): void {
    const next = id ?? '';
    if (next === this.activeId) return;
    this.activeId = next;
    if (!this.view) return;
    this.postRender(this.renderResults(this.itemsRaw));
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.renderShell(getNonce(), view.webview.cspSource);
    view.webview.onDidReceiveMessage((msg) => {
      void this.onMessage(msg);
    }, undefined, this.context.subscriptions);
    void this.runSearchAndRender();
  }

  async refresh(): Promise<void> {
    if (!this.view) return;
    await this.runSearchAndRender();
  }

  private async runSearchAndRender(): Promise<void> {
    if (!this.view) return;
    try {
      const { items } = await runSearch({
        keyword: this.filters.keyword,
        include: this.filters.include.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
        exclude: this.filters.exclude.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
      });
      this.itemsRaw = items;
      this.postRender(this.renderResults(items));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.view.webview.postMessage({ cmd: 'error', text: esc(msg) });
    }
  }

  private async onMessage(msg: { cmd?: string; [k: string]: unknown }): Promise<void> {
    switch (msg?.cmd) {
      case 'filters': {
        const f = (msg.filters ?? {}) as Partial<PersistedFilters>;
        this.filters = {
          keyword: String(f.keyword ?? ''),
          include: String(f.include ?? ''),
          exclude: String(f.exclude ?? ''),
        };
        await this.context.workspaceState.update('opencodeHistory.filters', this.filters);
        await this.runSearchAndRender();
        break;
      }
      case 'toggle': {
        this.mode = msg.mode === 'list' ? 'list' : 'tree';
        await this.context.workspaceState.update('opencodeHistory.viewMode', this.mode);
        this.postRender(this.renderResults(this.itemsRaw));
        break;
      }
      case 'refresh':
        await this.runSearchAndRender();
        break;
      case 'settings':
        await vscode.commands.executeCommand('workbench.action.openSettings', 'opencodeHistory');
        break;
      case 'open': {
        const id = String(msg.id ?? '');
        if (id) await this.actions.openDetail(id);
        break;
      }
      case 'copy': {
        const id = String(msg.id ?? '');
        if (id) await this.actions.copyExport(id);
        break;
      }
      case 'continue': {
        const id = String(msg.id ?? '');
        if (id) await this.actions.continueSession(id);
        break;
      }
      case 'delete': {
        const id = String(msg.id ?? '');
        if (id) await this.actions.deleteSession(id);
        break;
      }
      case 'folder': {
        const id = String(msg.id ?? '');
        if (id) await this.actions.openFolder(id);
        break;
      }
    }
  }

  private renderResults(items: SessionRow[]): string {
    if (items.length === 0) {
      return '<div class="empty">没有匹配的会话</div>';
    }
    const rowHtml = (r: SessionRow) => this.rowHtml(r);
    if (this.mode === 'tree') {
      const groups = groupByDir(items);
      return groups
        .map(
          (g) =>
            `<div class="grp">▸ <span class="grp-name" title="${esc(g.dir)}">${esc(g.dir)}</span> <span class="grp-count">${g.rows.length}</span></div>` +
            `<div class="grp-items">${g.rows.map(rowHtml).join('')}</div>`
        )
        .join('');
    }
    return items.map(rowHtml).join('');
  }

  private rowHtml(r: SessionRow): string {
    const title = esc(r.title || r.slug || r.id);
    const dir = esc(r.directory || r.projectId || '全局');
    const model = r.model ? esc(r.model.replace(/^\{.*?"id":"([^"]+)".*$/, '$1')) : '';
    const badge = `<span class="badge">${fmtK(r.tokensInput + r.tokensOutput)}</span>`;
    return `<div class="sess${r.id === this.activeId ? ' active' : ''}" data-id="${esc(r.id)}">
      <div class="sess-top">
        <span class="sess-title" title="打开会话">${title}</span>
        <span class="sess-meta">${badge} ${relTime(r.updatedAt)}</span>
      </div>
      <div class="sess-sub">${dir}${model ? ` · ${model}` : ''}</div>
      <div class="sess-actions">
        <button data-action="open">打开</button>
        <button data-action="copy">复制</button>
        <button data-action="continue">继续</button>
        <button data-action="folder">目录</button>
        <button data-action="delete" class="danger">删除</button>
      </div>
    </div>`;
  }

  private renderShell(nonce: string, cspSource: string): string {
    const kw = esc(this.filters.keyword);
    const inc = esc(this.filters.include);
    const exc = esc(this.filters.exclude);
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; script-src 'nonce-${nonce}';">
<style>
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 8px; margin: 0; }
input { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; padding: 4px 8px; font-size: var(--vscode-font-size); }
input:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
.search-row { display: flex; align-items: center; gap: 4px; }
.filter-toggle { cursor: pointer; background: none; border: none; color: var(--vscode-descriptionForeground); font-size: 1em; padding: 0 4px; flex: none; align-self: stretch; display: inline-flex; align-items: center; justify-content: center; line-height: 1; }
.filters { display: none; margin: 6px 0; }
.filters.open { display: block; }
.filters label { display: block; font-size: 0.75em; color: var(--vscode-descriptionForeground); margin: 6px 0 2px; }
.toolbar { display: flex; align-items: center; gap: 6px; margin: 8px 0 4px; font-size: 0.82em; }
.count { color: var(--vscode-descriptionForeground); flex: 1; }
.mode-btn { background: none; border: 1px solid var(--vscode-input-border, #444); border-radius: 4px; color: var(--vscode-foreground); padding: 2px 8px; cursor: pointer; font-size: 0.9em; }
.mode-btn.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: transparent; }
#results { margin-top: 4px; }
.grp { cursor: pointer; padding: 4px 6px; color: var(--vscode-descriptionForeground); font-size: 0.82em; user-select: none; border-radius: 3px; }
.grp-name { font-size: calc(0.82em + 2px); }
.grp:hover { background: var(--vscode-list-hoverBackground); }
.grp.collapsed + .grp-items { display: none; }
.grp-count { opacity: .7; }
.grp-items { border-left: 3px solid var(--vscode-input-background); margin: 2px 0 6px 10px; }
.sess { padding: 6px 8px; border-radius: 4px; cursor: pointer; }
.sess:hover { background: var(--vscode-list-hoverBackground); }
.sess:hover .sess-title { color: #d35e1e; }
.sess.active { background: var(--vscode-list-activeSelectionBackground); }
.sess.active .sess-title { color: #d35e1e; }
.sess-top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
.sess-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sess-meta { flex: none; font-size: 0.75em; color: var(--vscode-descriptionForeground); }
.badge { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); border-radius: 8px; padding: 0 6px; font-size: 0.8em; }
.sess-sub { font-size: 0.75em; color: var(--vscode-descriptionForeground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.sess-actions { display: none; margin-top: 4px; gap: 4px; }
.sess:hover .sess-actions { display: flex; }
.sess-actions button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; border-radius: 3px; padding: 2px 8px; font-size: 0.72em; cursor: pointer; }
.sess-actions button:hover { background: var(--vscode-button-secondaryHoverBackground); }
.sess-actions button.danger { background: var(--vscode-errorForeground); color: #fff; }
.empty { color: var(--vscode-descriptionForeground); padding: 16px 4px; text-align: center; }
.err { color: #ff8a8a; padding: 8px; }
</style>
<style id="user-style">${buildUserCss()}</style>
</head>
<body>
<div class="search-row">
  <input id="keyword" type="text" placeholder="搜索关键词…" value="${kw}" spellcheck="false">
  <button id="filter-toggle" class="filter-toggle" title="过滤选项">⏷</button>
  <button id="btn-refresh" class="filter-toggle" title="刷新">⟳</button>
  <button id="btn-settings" class="filter-toggle" title="打开设置">⚙</button>
</div>
<div id="filters" class="filters">
  <label>包含的文件(目录 glob,逗号分隔)</label>
  <input id="include" type="text" placeholder="E:/bkms/git-share/**" value="${inc}" spellcheck="false">
  <label>排除的文件(目录 glob,逗号分隔)</label>
  <input id="exclude" type="text" placeholder="**/dist/**" value="${exc}" spellcheck="false">
</div>
<div class="toolbar">
  <span id="count" class="count"></span>
  <button id="mode-tree" class="mode-btn" data-mode="tree" title="以树形查看">☰</button>
  <button id="mode-list" class="mode-btn" data-mode="list" title="以列表查看">≡</button>
</div>
<div id="results"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const kw = document.getElementById('keyword');
  const inc = document.getElementById('include');
  const exc = document.getElementById('exclude');
  const filtersEl = document.getElementById('filters');
  let timer;
  function push() {
    clearTimeout(timer);
    timer = setTimeout(function () {
      vscode.postMessage({ cmd: 'filters', filters: { keyword: kw.value, include: inc.value, exclude: exc.value } });
    }, 400);
  }
  kw.addEventListener('input', push);
  inc.addEventListener('input', push);
  exc.addEventListener('input', push);
  document.getElementById('filter-toggle').addEventListener('click', function () {
    filtersEl.classList.toggle('open');
  });
  document.getElementById('btn-refresh').addEventListener('click', function () {
    vscode.postMessage({ cmd: 'refresh' });
  });
  document.getElementById('btn-settings').addEventListener('click', function () {
    vscode.postMessage({ cmd: 'settings' });
  });
  document.querySelectorAll('.mode-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      vscode.postMessage({ cmd: 'toggle', mode: b.dataset.mode });
    });
  });
  document.getElementById('results').addEventListener('click', function (e) {
    const btn = e.target.closest('.sess-actions button');
    if (btn) {
      const sess = btn.closest('[data-id]');
      if (sess) vscode.postMessage({ cmd: btn.dataset.action, id: sess.dataset.id });
      return;
    }
    const grp = e.target.closest('.grp');
    if (grp) {
      grp.classList.toggle('collapsed');
      return;
    }
    const sess = e.target.closest('[data-id]');
    if (sess) vscode.postMessage({ cmd: 'open', id: sess.dataset.id });
  });
  window.addEventListener('message', function (e) {
    const m = e.data;
    if (m.cmd === 'render') {
      document.getElementById('count').textContent = m.count + ' 个会话';
      document.getElementById('results').innerHTML = m.html;
      document.getElementById('mode-tree').classList.toggle('active', m.mode === 'tree');
      document.getElementById('mode-list').classList.toggle('active', m.mode === 'list');
      if (m.css) document.getElementById('user-style').textContent = m.css;
    } else if (m.cmd === 'error') {
      document.getElementById('results').innerHTML = '<div class="err">' + m.text + '</div>';
    }
  });
})();
</script>
</body>
</html>`;
  }
}