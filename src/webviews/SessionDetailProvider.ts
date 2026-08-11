import * as vscode from 'vscode';
import { getConfig, continueSessionInTerminal, exportSession } from '../opencode';
import { esc, renderSessionDetail } from '../render/renderDetail';
import type { SessionExport } from '../types';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export async function openDir(dir: string): Promise<void> {
  const uri = vscode.Uri.file(dir);
  try {
    await vscode.commands.executeCommand('revealFileInOS', uri);
  } catch {
    try {
      await vscode.env.openExternal(uri);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`无法打开目录 ${dir}: ${msg}`);
    }
  }
}

export class SessionDetailProvider {
  private panel: vscode.WebviewPanel | undefined;
  private sessionId = '';
  private lastData: SessionExport | undefined;
  onActiveChange?: (id: string | undefined) => void;

  constructor(private readonly context: vscode.ExtensionContext) {}

  async open(id: string): Promise<void> {
    this.sessionId = id;
    if (this.panel) {
      this.panel.reveal();
    } else {
      this.panel = vscode.window.createWebviewPanel(
        'opencodeHistory.sessionDetail',
        '会话详情',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
        }
      );
      this.panel.onDidChangeViewState(
        (e) => {
          if (e.webviewPanel.active) this.onActiveChange?.(this.sessionId);
        },
        null,
        this.context.subscriptions
      );
      this.panel.onDidDispose(
        () => {
          this.panel = undefined;
          this.lastData = undefined;
          this.onActiveChange?.(undefined);
        },
        null,
        this.context.subscriptions
      );
      this.panel.webview.onDidReceiveMessage(
        (msg) => {
          void this.onMessage(msg);
        },
        null,
        this.context.subscriptions
      );
    }
    this.onActiveChange?.(this.sessionId);
    await this.render(true);
  }

  private async render(force: boolean): Promise<void> {
    if (!this.panel) return;
    if (!force && this.lastData) return;
    this.panel.webview.html =
      '<!DOCTYPE html><html><body style="color:var(--vscode-foreground);font-family:var(--vscode-font-family)"><p>加载中…</p></body></html>';
    try {
      const data = await exportSession(this.sessionId);
      this.lastData = data;
      if (!this.panel) return;
      this.panel.title = data.info.title || data.info.slug || data.info.id || '会话详情';
      this.panel.webview.html = renderSessionDetail(data, {
        nonce: getNonce(),
        cspSource: this.panel.webview.cspSource,
        toolOutputLimit: getConfig<number>('toolOutputLimit', 4000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!this.panel) return;
      this.panel.webview.html = `<!DOCTYPE html><html><body style="color:var(--vscode-foreground);font-family:var(--vscode-font-family);padding:16px"><p style="color:#ff8a8a">加载会话失败</p><p>${esc(msg)}</p><button id="btn-back" style="margin-top:8px;padding:6px 14px">返回会话列表</button>
<script>document.getElementById('btn-back').addEventListener('click', function(){ window.close(); });</script>
</body></html>`;
    }
  }

  private async onMessage(msg: { cmd?: string }): Promise<void> {
    switch (msg?.cmd) {
      case 'refresh':
        await this.render(true);
        break;
      case 'copy': {
        if (!this.lastData) return;
        await vscode.env.clipboard.writeText(JSON.stringify(this.lastData, null, 2));
        vscode.window.setStatusBarMessage('已复制导出 JSON', 2000);
        break;
      }
      case 'continue':
        await continueSessionInTerminal(this.sessionId);
        break;
      case 'folder': {
        const dir = this.lastData?.info?.directory;
        if (dir) await openDir(dir);
        break;
      }
    }
  }
}