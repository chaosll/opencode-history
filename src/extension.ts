import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { fmtTime } from './format';
import { getConfig, deleteSession, exportSession, getDbFile, resetBinaryCache } from './opencode';
import { openDir, SessionDetailProvider } from './webviews/SessionDetailProvider';
import { StatsProvider } from './webviews/StatsProvider';
import { MainViewProvider } from './webviews/MainViewProvider';
import type { SessionRow } from './types';

export function activate(context: vscode.ExtensionContext): void {
  const detailProvider = new SessionDetailProvider(context);
  const statsProvider = new StatsProvider(context);

  async function copyExport(id: string): Promise<void> {
    try {
      const data = await exportSession(id);
      await vscode.env.clipboard.writeText(JSON.stringify(data, null, 2));
      vscode.window.setStatusBarMessage('已复制导出 JSON 到剪贴板', 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`导出失败: ${msg}`);
    }
  }

  async function continueInTerminal(id: string): Promise<void> {
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const term = vscode.window.createTerminal({ name: `opencode ${id.slice(0, 8)}`, cwd });
    term.show(true);
    term.sendText(`opencode --session "${id}"`);
  }

  async function deleteSessionAction(id: string): Promise<void> {
    const row = mainView.findRow(id);
    const label = row?.title || row?.slug || id;
    const pick = await vscode.window.showWarningMessage(
      `确定删除会话「${label}」?该操作不可恢复。`,
      { modal: true },
      '删除'
    );
    if (pick !== '删除') return;
    try {
      await deleteSession(id);
      vscode.window.showInformationMessage(`已删除会话: ${label}`);
      await mainView.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`删除失败: ${msg}`);
    }
  }

  async function openFolderAction(id: string): Promise<void> {
    const row = mainView.findRow(id);
    if (row?.directory) await openDir(row.directory);
  }

  const mainView = new MainViewProvider(context, {
    openDetail: (id) => detailProvider.open(id),
    copyExport,
    continueSession: continueInTerminal,
    deleteSession: deleteSessionAction,
    openFolder: openFolderAction,
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('opencodeHistory.main', mainView, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  async function requireSessionId(arg: unknown): Promise<string | undefined> {
    if (typeof arg === 'string') return arg;
    const a = arg as { id?: unknown; row?: SessionRow } | undefined;
    if (a?.row?.id) return a.row.id;
    const id = a?.id;
    if (typeof id === 'string' && id.startsWith('ses_')) return id;
    const picked = await vscode.window.showQuickPick(
      mainView.items.map((r) => ({
        label: r.title || r.slug || r.id,
        description: `${fmtTime(r.updatedAt)} · ${r.directory || ''}`,
        row: r,
      })),
      { placeHolder: '选择会话', matchOnDescription: true }
    );
    return picked?.row.id;
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('opencodeHistory.refresh', () => {
      void mainView.refresh();
      void statsProvider.refresh();
    }),
    vscode.commands.registerCommand('opencodeHistory.openStats', () => statsProvider.open()),
    vscode.commands.registerCommand('opencodeHistory.openSession', async (arg?: unknown) => {
      const id = await requireSessionId(arg);
      if (id) await detailProvider.open(id);
    }),
    vscode.commands.registerCommand('opencodeHistory.copyExport', async (arg?: unknown) => {
      const id = await requireSessionId(arg);
      if (id) await copyExport(id);
    }),
    vscode.commands.registerCommand('opencodeHistory.continueSession', async (arg?: unknown) => {
      const id = await requireSessionId(arg);
      if (id) await continueInTerminal(id);
    }),
    vscode.commands.registerCommand('opencodeHistory.openSessionDir', async (arg?: unknown) => {
      const id = await requireSessionId(arg);
      if (id) await openFolderAction(id);
    }),
    vscode.commands.registerCommand('opencodeHistory.deleteSession', async (arg?: unknown) => {
      const id = await requireSessionId(arg);
      if (id) await deleteSessionAction(id);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('opencodeHistory')) {
        resetBinaryCache();
        void mainView.refresh();
      }
    })
  );

  startAutoRefresh(mainView, statsProvider, context);
}

function startAutoRefresh(
  mainView: MainViewProvider,
  statsProvider: StatsProvider,
  context: vscode.ExtensionContext
): void {
  const seconds = getConfig<number>('autoRefreshSeconds', 10);
  if (seconds <= 0) return;
  let last = mtime();
  const timer = setInterval(() => {
    const cur = mtime();
    if (cur !== last) {
      last = cur;
      void mainView.refresh();
      void statsProvider.refresh();
    }
  }, seconds * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
}

function mtime(): number {
  try {
    return fs.statSync(getDbFile()).mtimeMs;
  } catch {
    return -1;
  }
}

export function deactivate(): void {
  /* noop */
}