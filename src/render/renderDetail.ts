import { fmtCost, fmtDuration, fmtTime, fmtTimeShort, fmtK, modelLabel } from '../format';
import type { Part, SessionExport, SessionMessage } from '../types';

export interface RenderOptions {
  nonce: string;
  cspSource: string;
  toolOutputLimit: number;
}

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMd(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function paragraphs(s: string): string {
  const blocks = s.split(/\n{2,}/);
  return blocks
    .map((p) => {
      const withBr = p.replace(/\n/g, '<br>');
      return `<p>${inlineMd(withBr)}</p>`;
    })
    .join('');
}

export function md(t: unknown): string {
  const e = esc(t);
  const blocks = e.split(/(```[\s\S]*?```)/g);
  return blocks
    .map((b) => {
      if (b.startsWith('```')) {
        const inner = b.slice(3, -3);
        const nl = inner.indexOf('\n');
        const lang = nl === -1 ? '' : inner.slice(0, nl).trim();
        const code = nl === -1 ? inner : inner.slice(nl + 1);
        const head = lang ? `<div class="code-lang">${esc(lang)}</div>` : '';
        return `<div class="code-block">${head}<pre>${code}</pre></div>`;
      }
      return paragraphs(b);
    })
    .join('');
}

function prettyValue(v: unknown, limit: number): string {
  let value = v;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t.startsWith('{') || t.startsWith('[') || t === 'null' || t === 'true' || t === 'false' || /^-?\d/.test(t)) {
      try {
        value = JSON.parse(t);
      } catch {
        value = v;
      }
    }
  }
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, null, 2);
    } catch {
      text = String(value);
    }
  }
  if (text.length > limit) {
    text = text.slice(0, limit) + `\n… (已截断,共 ${text.length} 字符)`;
  }
  return esc(text);
}

function renderPart(p: Part, limit: number): string {
  switch (p.type) {
    case 'text':
      return `<div class="msg-text">${md(p.text)}</div>`;
    case 'reasoning':
      return `<details class="reasoning"><summary>推理过程</summary><pre>${esc(p.text)}</pre></details>`;
    case 'step-start': {
      const mode = p.mode ? ` · ${esc(p.mode)}` : '';
      return `<div class="step start"><span class="step-badge">STEP</span>${mode}</div>`;
    }
    case 'step-finish': {
      const tokens = p.tokens ? ` · ${fmtK(Number((p.tokens as { input?: number }).input) || 0)}→${fmtK(Number((p.tokens as { output?: number }).output) || 0)} tokens` : '';
      return `<div class="step finish"><span class="step-badge">DONE</span>${tokens}</div>`;
    }
    case 'tool': {
      const name = esc(p.tool);
      const st = (p.state ?? {}) as Record<string, unknown>;
      const status = String(st.status ?? '');
      const isError = /error|failed/i.test(status);
      const stateClass = isError ? ' error' : status ? ' success' : '';
      const stateLabel = isError ? `错误 (${status})` : status ? status : '';
      const title = st.title ? ` · ${esc(st.title)}` : '';
      const inputVal = st.input ?? p.input;
      const outputRaw = st.output ?? (st.metadata as { output?: unknown } | undefined)?.output ?? p.output;
      const input = inputVal != null ? `<details class="tool-block open"><summary>输入</summary><pre>${prettyValue(inputVal, limit)}</pre></details>` : '';
      const output =
        outputRaw != null
          ? `<details class="tool-block${isError ? ' error' : ''}"><summary>${isError ? '错误' : '输出'}</summary><pre>${prettyValue(outputRaw, limit)}</pre></details>`
          : '';
      return `<div class="tool">
        <div class="tool-head"><span class="tool-name">⚙ ${name}${title}</span><span class="tool-state${stateClass}">${esc(stateLabel)}</span></div>
        ${input}${output}
      </div>`;
    }
    case 'file': {
      const filePath = esc(p.filePath);
      const content = p.content != null ? `<pre class="file-content">${esc(p.content)}</pre>` : '';
      return `<div class="file"><div class="file-head">📄 ${filePath}</div>${content}</div>`;
    }
    default:
      return '';
  }
}

function renderMessage(m: SessionMessage, limit: number): string {
  const info = m.info ?? {};
  const role = info.role === 'user' ? 'user' : 'assistant';
  const created = info.time?.created;
  const partsHtml = (m.parts ?? []).map((p) => renderPart(p, limit)).join('');
  return `<section class="msg ${role}">
    <div class="msg-head">
      <span class="role ${role}">${role === 'user' ? '你' : 'assistant'}</span>
      ${created ? `<span class="time">${fmtTimeShort(created)}</span>` : ''}
    </div>
    <div class="msg-body">${partsHtml}</div>
  </section>`;
}

export function renderSessionDetail(data: SessionExport, opts: RenderOptions): string {
  const info = data.info ?? {};
  const model = info.model;
  const tokens = info.tokens;
  const summary = info.summary;
  const limit = opts.toolOutputLimit;
  const messagesHtml = (data.messages ?? []).map((m) => renderMessage(m, limit)).join('');

  const headerRows: string[] = [];
  headerRows.push(
    `<span class="kv"><span class="k">会话</span><span class="v">${esc(info.slug || info.id)}</span></span>`
  );
  if (info.directory) headerRows.push(`<span class="kv"><span class="k">目录</span><span class="v">${esc(info.directory)}</span></span>`);
  headerRows.push(`<span class="kv"><span class="k">模型</span><span class="v">${esc(modelLabel(undefined, model))}</span></span>`);
  if (info.agent) headerRows.push(`<span class="kv"><span class="k">Agent</span><span class="v">${esc(info.agent)}</span></span>`);
  if (tokens) {
    headerRows.push(
      `<span class="kv"><span class="k">Token</span><span class="v">${fmtK(tokens.input)} / ${fmtK(tokens.output)} (r:${fmtK(tokens.reasoning)})</span></span>`
    );
  }
  headerRows.push(`<span class="kv"><span class="k">成本</span><span class="v">${fmtCost(info.cost)}</span></span>`);
  if (info.time) {
    const dur = fmtDuration(info.time.created, info.time.updated);
    headerRows.push(
      `<span class="kv"><span class="k">时间</span><span class="v">${fmtTime(info.time.created)}${dur ? ` · 用时 ${dur}` : ''}</span></span>`
    );
  }
  if (summary) {
    headerRows.push(
      `<span class="kv"><span class="k">改动</span><span class="v">+${summary.additions ?? 0} −${summary.deletions ?? 0} · ${summary.files ?? 0} 文件</span></span>`
    );
  }

  const title = info.title || info.slug || info.id;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${opts.cspSource} 'unsafe-inline'; img-src ${opts.cspSource} data:; script-src 'nonce-${opts.nonce}';">
<style>
:root { color-scheme: light dark; }
body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 20px; max-width: 900px; margin: 0 auto; }
h1 { font-size: 1.15em; margin: 0 0 4px; word-break: break-all; }
.id { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-bottom: 12px; word-break: break-all; }
.header { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; padding: 10px 12px; margin-bottom: 16px; display: flex; flex-wrap: wrap; gap: 4px 18px; }
.kv { font-size: 0.82em; }
.k { color: var(--vscode-descriptionForeground); margin-right: 4px; }
.actions { margin-bottom: 16px; display: flex; gap: 8px; }
.actions button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 4px 12px; cursor: pointer; font-size: 0.85em; }
.actions button:hover { background: var(--vscode-button-hoverBackground); }
.msg { margin: 0 0 16px; }
.msg-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.role { font-size: 0.78em; font-weight: 600; padding: 1px 8px; border-radius: 10px; }
.role.user { background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
.role.assistant { background: var(--vscode-input-background); border: 1px solid var(--vscode-widget-border, #444); color: var(--vscode-foreground); }
.time { color: var(--vscode-descriptionForeground); font-size: 0.75em; }
.msg-body { color: var(--vscode-editor-foreground); }
.msg-body p { margin: 4px 0; line-height: 1.55; }
.code-block { background: var(--vscode-textCodeBlock-background); border: 1px solid var(--vscode-widget-border, #333); border-radius: 4px; margin: 8px 0; }
.code-lang { font-size: 0.72em; color: var(--vscode-descriptionForeground); padding: 2px 8px; border-bottom: 1px solid var(--vscode-widget-border, #333); }
.code-block pre { margin: 0; padding: 8px 10px; overflow-x: auto; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); white-space: pre-wrap; word-break: break-word; }
code { font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
details.reasoning { margin: 8px 0; font-size: 0.85em; }
details.reasoning summary { cursor: pointer; color: var(--vscode-descriptionForeground); }
details.reasoning pre { background: var(--vscode-textCodeBlock-background); border-left: 3px solid var(--vscode-widget-border, #333); padding: 8px 10px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; }
.tool { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; margin: 8px 0; overflow: hidden; }
.tool-head { display: flex; justify-content: space-between; align-items: center; padding: 5px 10px; background: var(--vscode-editorWidget-background); }
.tool-name { font-weight: 600; font-size: 0.85em; }
.tool-state { font-size: 0.72em; padding: 1px 8px; border-radius: 10px; }
.tool-state.success { background: #2e7d3240; color: var(--vscode-foreground); }
.tool-state.error { background: #c6282830; color: #ff8a8a; }
.tool-block { margin: 0; font-size: 0.85em; }
.tool-block summary { cursor: pointer; padding: 4px 10px; color: var(--vscode-descriptionForeground); }
.tool-block pre { margin: 0; padding: 6px 10px 10px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
.tool-block.error pre { color: #ff8a8a; }
.step { margin: 6px 0; font-size: 0.78em; color: var(--vscode-descriptionForeground); display: flex; align-items: center; gap: 6px; }
.step-badge { font-weight: 700; border: 1px solid var(--vscode-widget-border, #444); border-radius: 4px; padding: 0 6px; }
.file { border: 1px solid var(--vscode-widget-border, #444); border-radius: 6px; margin: 8px 0; }
.file-head { padding: 4px 10px; font-size: 0.82em; background: var(--vscode-editorWidget-background); }
.file-content { margin: 0; padding: 8px 10px; overflow-x: auto; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size); }
.empty { color: var(--vscode-descriptionForeground); padding: 24px 0; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
<div class="id">${esc(info.id)}</div>
<div class="actions">
  <button id="btn-refresh">刷新</button>
  <button id="btn-copy">复制导出 JSON</button>
  <button id="btn-continue">终端继续</button>
  <button id="btn-folder">打开目录</button>
</div>
<div class="header">${headerRows.join('')}</div>
${messagesHtml || '<div class="empty">该会话暂无消息。</div>'}
<script nonce="${opts.nonce}">
(function(){
  const vscode = acquireVsCodeApi();
  document.getElementById('btn-refresh').addEventListener('click', function(){ vscode.postMessage({ cmd: 'refresh' }); });
  document.getElementById('btn-copy').addEventListener('click', function(){ vscode.postMessage({ cmd: 'copy' }); });
  document.getElementById('btn-continue').addEventListener('click', function(){ vscode.postMessage({ cmd: 'continue' }); });
  document.getElementById('btn-folder').addEventListener('click', function(){ vscode.postMessage({ cmd: 'folder' }); });
})();
</script>
</body>
</html>`;
}
