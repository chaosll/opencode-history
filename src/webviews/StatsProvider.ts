import * as vscode from 'vscode';
import { fmtCost, fmtK } from '../format';
import { fetchStats } from '../opencode';
import { esc } from '../render/renderDetail';
import type { Stats } from '../types';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function bars(rows: { label: string; value: number; sub?: string }[], fmt: (n: number) => string): string {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows
    .map((r) => {
      const pct = Math.max(1, Math.round((r.value / max) * 100));
      return `<div class="bar">
        <div class="bar-top"><span class="bar-label" title="${esc(r.label)}">${esc(r.label)}</span><span class="bar-val">${fmt(r.value)}${r.sub ? `<span class="bar-sub"> · ${esc(r.sub)}</span>` : ''}</span></div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    })
    .join('');
}

function card(title: string, body: string): string {
  return `<section class="card"><h2>${esc(title)}</h2>${body}</section>`;
}

function emptyCard(title: string): string {
  return card(title, '<div class="empty">暂无数据</div>');
}

export function renderStatsHtml(stats: Stats, cspSource: string, nonce: string): string {
  const o = stats.overview;
  const overview = `<div class="ov-grid">
    <div class="ov"><span class="ov-num">${o.sessions}</span><span class="ov-label">会话</span></div>
    <div class="ov"><span class="ov-num">${fmtK(o.tokensInput)}</span><span class="ov-label">输入 token</span></div>
    <div class="ov"><span class="ov-num">${fmtK(o.tokensOutput)}</span><span class="ov-label">输出 token</span></div>
    <div class="ov"><span class="ov-num">${fmtK(o.tokensReasoning)}</span><span class="ov-label">推理 token</span></div>
    <div class="ov"><span class="ov-num">${fmtCost(o.cost)}</span><span class="ov-label">成本</span></div>
  </div>`;

  const byDay =
    stats.byDay.length > 0
      ? bars(
          stats.byDay.map((d) => ({
            label: d.day,
            value: d.tokens,
            sub: `${d.sessions} 会话`,
          })),
          fmtK
        )
      : '<div class="empty">近 30 天暂无数据</div>';

  const byProject =
    stats.byProject.length > 0
      ? bars(
          stats.byProject.map((p) => ({
            label: p.directory || p.projectId || '未知',
            value: p.tokens,
            sub: `${p.sessions} 会话 · ${fmtCost(p.cost)}`,
          })),
          fmtK
        )
      : '<div class="empty">暂无数据</div>';

  const byModel =
    stats.byModel.length > 0
      ? bars(
          stats.byModel.map((m) => ({
            label: m.model || '未知',
            value: m.tokens,
            sub: `${m.sessions} 会话 · ${fmtCost(m.cost)}`,
          })),
          fmtK
        )
      : '<div class="empty">暂无数据</div>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; script-src 'nonce-${nonce}';">
<style>
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 20px; max-width: 860px; margin: 0 auto; }
h1 { font-size: 1.15em; margin: 0 0 4px; }
.id { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-bottom: 14px; }
.actions { margin-bottom: 16px; }
.actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.85em; }
.actions button:hover { background: var(--vscode-button-hoverBackground); }
.card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 12px 14px; margin-bottom: 16px; }
.card h2 { font-size: 0.9em; margin: 0 0 10px; color: var(--vscode-foreground); }
.ov-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
.ov { background: var(--vscode-input-background); border-radius: 6px; padding: 10px; text-align: center; }
.ov-num { display: block; font-size: 1.25em; font-weight: 600; }
.ov-label { font-size: 0.78em; color: var(--vscode-descriptionForeground); }
.bar { margin-bottom: 8px; }
.bar-top { display: flex; justify-content: space-between; gap: 8px; font-size: 0.82em; margin-bottom: 3px; }
.bar-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bar-sub { color: var(--vscode-descriptionForeground); font-size: 0.85em; }
.bar-track { background: var(--vscode-input-background); border-radius: 3px; height: 10px; overflow: hidden; }
.bar-fill { background: var(--vscode-focusBorder); height: 100%; border-radius: 3px; }
.empty { color: var(--vscode-descriptionForeground); padding: 8px 0; }
</style>
</head>
<body>
<h1>OpenCode 统计</h1>
<div class="id">数据来自 opencode 本地数据库</div>
<div class="actions"><button id="btn-refresh">刷新</button></div>
${card('总览', overview)}
${card('近 30 天 Token 走势', byDay)}
${card('按项目', byProject)}
${card('按模型', byModel)}
<script nonce="${nonce}">
document.getElementById('btn-refresh').addEventListener('click', function(){
  const vscode = acquireVsCodeApi();
  vscode.postMessage({ cmd: 'refresh' });
});
</script>
</body>
</html>`;
}

export class StatsProvider {
  private panel: vscode.WebviewPanel | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'opencodeHistory.stats',
        'OpenCode 统计',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        }
      );
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      }, null, this.context.subscriptions);
      this.panel.webview.onDidReceiveMessage(
        (msg) => {
          if (msg?.cmd === 'refresh') void this.render();
        },
        null,
        this.context.subscriptions
      );
    }
    await this.render();
  }

  async refresh(): Promise<void> {
    await this.render();
  }

  private async render(): Promise<void> {
    if (!this.panel) return;
    try {
      const stats = await fetchStats();
      if (!this.panel) return;
      this.panel.webview.html = renderStatsHtml(stats, this.panel.webview.cspSource, getNonce());
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.panel) return;
      this.panel.webview.html = `<!DOCTYPE html><html><body style="color:var(--vscode-foreground);font-family:var(--vscode-font-family);padding:16px"><p style="color:#ff8a8a">加载统计失败</p><p>${esc(msg)}</p></body></html>`;
    }
  }
}