# dsh-web-chat

DeepSeek Harness 插件：在侧栏「新会话」上方加入「**工作 / 对话**」切换，并把网页版 DeepSeek 的历史对话接进 Harness。

- 「工作」= 原汁原味的 Harness 工作区；
- 「对话」= 把工作区替换成 `chat.deepseek.com` 的历史对话列表，点开任意一条即可在 Harness 主对话区**逐条还原**该网页对话，并**直接继续聊**（按 Harness 默认 API 计费）。

## 功能

- 侧栏「新会话」按钮正上方注入胶囊：`🖥 工作 ｜ 💬 对话`，选择会被记住。
- 对话模式：
  - 历史列表按「置顶 / 今天 / 昨天 / 更早」分组，20 秒轮询保持（近似）实时；
  - 滚动到底部自动加载下一页（每页 20 条，带加载动画）；
  - 头部「下载」按钮把当前对话导出为 Markdown；
  - 选中项常驻高亮；鼠标悬停有与 Harness 原生会话行一致的灰底高亮。
- 点击历史记录：
  - 把该网页对话写成一份**真实 Harness 会话日志**（在「网页对话同步」工作区），主对话区逐条显示，思考过程折叠为 Harness 原生 `reasoning` 块；
  - 在 Harness 里直接发消息即是「接着原来的内容继续聊」；
  - 网页版之后又有新消息时，再次点开会自动生成新的镜像会话并打开（旧会话保留）。
- 对话模式下点「新会话」→ 在「网页对话同步」工作区新建空白会话，而不是跳到工作区新建流程。
- 登录态零配置：
  - 首次安装自动从本机 Chrome / Edge / Brave / Chromium 的 Local Storage 读取 `chat.deepseek.com` 的 `userToken` 并校验；
  - 读不到或已失效时，面板显示「连接 DeepSeek 网页版」卡片：自动读取 / 打开网页版 / 粘贴 token 一次即可。

## 环境要求

- DeepSeek Harness `0.2.x`（桌面端已验证）
- Node.js `>= 22`（宿主半使用 ESM 与全局 `fetch`）

## 安装

### 方式一：让 Harness 自己装（推荐）

把本目录放到任意位置（例如 `D:\plugins\dsh-web-chat`），然后在 Harness 会话里让 Agent 执行：

```text
plugin_manager install_bundle  target = <该目录的绝对路径>
```

安装会写入当前 profile（`%USERPROFILE%\.dsh\profiles\desktop`）并启用插件。

### 方式二：手动加入 profile

1. 复制本目录到任意位置（保持 `package.json` 在根）；
2. 编辑 `%USERPROFILE%\.dsh\profiles\desktop\package.json`：
   - `dependencies` 增加 `"dsh-web-chat": "file:<绝对路径>"`
   - `dsh.profile.bundles` 数组加入 `"dsh-web-chat"`
3. 在 profile 目录执行 `pnpm install`；
4. 重启 Harness。

### 方式三：npm（发布之后）

发布到 npm 后可以按包名安装，不用把目录拷来拷去：

```text
plugin_manager install_bundle  target = dsh-web-chat
```

Harness 会通过当前的 npm registry 拉取该包并装进 profile。

> 安装后请**重新加载窗口一次（Ctrl + R）**：客户端模块只在页面加载时装配。

## 数据目录

默认位于 `%USERPROFILE%\.dsh\web-chat-sync`（可用 `DSH_WCS_DATA_DIR` 或 `DSH_HOME` 覆盖）：

| 文件 | 说明 |
| --- | --- |
| `deepseek-web-token.txt` | 网页版登录 token（自动写入，**不要外传**） |
| `cache.json` | 历史列表缓存 |
| `sessions-map.json` | 网页对话 ↔ Harness 会话映射 |
| `imported/` | 导入会话的事件副本（用于镜像重建） |
| `diagnostics/` | 排障 JSON，可随时删除 |

在开发态（插件目录旁边存在 `web-chat-sync/`）时会继续使用那个旧目录，保证向后兼容。

## 登录态与隐私

- Harness 登录的是 **API 平台**（`platform.deepseek.com`），与网页版（`chat.deepseek.com`）的 `userToken` **不通用**，所以插件需要网页版登录态；
- 自动读取只在本机文件系统里进行，候选 token 会先请求一次历史列表接口校验，通过才落盘；
- 插件**不会上传** token，也**不会回写**网页版（DeepSeek 网页接口有 PoW 反爬，回写不可行且风险高）；
- 卸载插件后可直接删除上述数据目录。

## 工作原理（简述）

- Host 半（`index.js`）注册 7 条 `/api/wcs/*` 路由：
  `sessions`（分页历史）、`messages`（单条对话）、`open`（打开/镜像为 Harness 会话）、
  `continue`、`new-chat`、`export`（Markdown）、`token`（读取/保存/自动发现登录态）；
- 历史通过网页私有接口读取，再按 DSH v4 会话日志格式（多帧 zstd JSONL）写入，
  由 Harness 自行渲染为真实会话；
- Client 半（`client.js`）以纯 DOM 注入侧栏胶囊与历史面板，样式全部使用主题 token。

## 开发与自测

```bash
node test/smoke.mjs         # 客户端 51 项离线测试（伪 DOM）
node tools/test-host.mjs    # Host 半路由注册自检
node tools/test-detect.mjs  # 本机浏览器 token 自动读取自检（会真实请求一次列表接口）
```

三项都应输出 `all checks passed` / `PASS`。

## 已知限制

- 依赖网页版私有接口，DeepSeek 前端更新后可能需要同步调整；
- Windows 桌面端实测通过；macOS / Linux 的浏览器目录已适配但未实测；
- 不做 Harness → 网页版回写。

## 发布到 GitHub / npm

```bash
# GitHub
git init
git add .
git commit -m "feat: sidebar work/chat switch with DeepSeek web history"
git remote add origin https://github.com/William-JT-Shen/dsh-web-chat.git
git push -u origin main

# npm
npm login
npm publish --access public
```

发布前请把 `package.json` 里的 `author`、`repository`、`bugs`、`homepage` 改成你自己的地址，并按需升级 `version`。

## License

MIT
