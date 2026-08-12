# OpenCode History

在 VS Code 侧边栏中浏览、搜索、统计和管理 [opencode](https://opencode.ai) 的会话历史。

## 功能特性

- **会话列表**：侧边栏「搜索」视图展示所有会话，支持树形（按目录分组、可折叠）与列表两种模式。
- **关键词搜索**：匹配会话元数据（标题、slug、目录、模型等）以及消息正文内容。
- **目录过滤**：按包含/排除的目录 glob 过滤会话（如 `E:/bkms/git-share/**`、`**/dist/**`）。
- **会话详情**：在独立面板查看完整对话，支持 Markdown、代码块与工具输出渲染，超长输出自动截断。
- **统计面板**：总览（会话数、输入/输出/推理 token、成本）、近 30 天 token 走势、按项目统计、按模型统计。
- **条目操作**：打开详情、复制导出 JSON、在终端继续会话（`opencode --session <id>`）、打开会话所在目录、删除会话（需二次确认）。
- **自动刷新**：轮询数据库文件变化自动刷新列表与统计（可配置间隔或关闭）。

## 数据来源

扩展通过 `opencode db <sql> --format json` 读取 opencode 的本地 SQLite 数据库（默认 `~/.local/share/opencode/opencode.db`），查询失败时回退到 `opencode session list`。opencode 可执行文件与数据目录均支持自动探测，也可手动指定。

## 配置项

在设置中搜索 `opencodeHistory` 即可查看全部配置：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `opencodeHistory.opencodePath` | 空 | opencode 可执行文件的绝对路径。留空自动探测（PATH + 常见安装位置），Windows 下接受 `opencode.cmd` |
| `opencodeHistory.nodePath` | 空 | node 可执行文件的绝对路径，用于 prepend 到 PATH（VSCode 从 GUI 启动未继承 shell PATH 时） |
| `opencodeHistory.dataPath` | 空 | opencode 数据目录绝对路径（含 `opencode.db`）。留空自动探测 `~/.local/share/opencode` |
| `opencodeHistory.autoRefreshSeconds` | `10` | 轮询数据库变化的间隔秒数；设为 `0` 关闭自动刷新 |
| `opencodeHistory.toolOutputLimit` | `4000` | 详情视图中单个工具输出的最大渲染字符数，超出部分截断 |
| `opencodeHistory.itemFontSize` | 空 | 侧边栏条目标题字体大小（CSS 值，如 `13px`、`1.1em`），留空用默认 |
| `opencodeHistory.itemFontColor` | 空 | 侧边栏条目标题字体颜色（CSS 颜色），留空用默认 |
| `opencodeHistory.subFontSize` | 空 | 侧边栏条目副标题（目录/模型）字体大小，留空用默认 |
| `opencodeHistory.subFontColor` | 空 | 侧边栏条目副标题字体颜色，留空用默认 |
| `opencodeHistory.activeItemBackground` | 空 | 当前激活条目的背景色，留空用默认 |
| `opencodeHistory.activeItemFontColor` | 空 | 当前激活条目标题字体颜色，留空用默认（hover/active 默认 `#d35e1e`） |
| `opencodeHistory.activeItemFontSize` | 空 | 当前激活条目标题字体大小，留空用默认 |

> 侧边栏工具栏右上角齿轮图标 ⚙ 可直接打开本扩展的设置页。

## 命令

| 命令 | ID | 说明 |
|---|---|---|
| 刷新 | `opencodeHistory.refresh` | 刷新会话列表与统计 |
| 打开统计面板 | `opencodeHistory.openStats` | 打开统计面板 |
| 打开会话 | `opencodeHistory.openSession` | 打开指定会话的详情 |
| 复制导出 JSON | `opencodeHistory.copyExport` | 复制会话导出 JSON 到剪贴板 |
| 在终端继续该会话 | `opencodeHistory.continueSession` | 在终端中以 `opencode --session <id>` 继续会话 |
| 打开会话所在目录 | `opencodeHistory.openSessionDir` | 打开会话对应的工作目录 |
| 删除会话 | `opencodeHistory.deleteSession` | 删除会话（二次确认） |

## 开发与构建

前置要求：Node.js 18+、npm。

```bash
npm install        # 安装依赖
npm run typecheck  # 类型检查
npm run compile    # 类型检查 + esbuild 构建
npm run esbuild-watch  # 监听模式构建（开发调试）
```

调试：在 VS Code 中打开本项目按 `F5` 启动扩展开发宿主。

打包为 `.vsix` 安装包：

```bash
npx @vscode/vsce package
```

产物为 `opencode-history-<version>.vsix`，可在 VS Code 的扩展面板「从 VSIX 安装…」安装。
