# dsh-web-chat

A [DeepSeek Harness](https://github.com/deepseek-ai) plugin that adds a **Work / Chat** switch above the sidebar's *New Session* button and brings your DeepSeek **web** chat history into Harness.

- **Work** — the Harness workspace exactly as before.
- **Chat** — replaces the workspace area with your `chat.deepseek.com` history. Click any conversation and Harness renders every message of it as a real Harness session, ready to continue (billed through your Harness model / API key).

## Features

- A segmented `🖥 Work | 💬 Chat` pill injected right below the brand row, above *New Session*. The choice is remembered.
- In Chat mode:
  - history grouped as **Pinned / Today / Yesterday / Earlier**, refreshed every 20 s;
  - infinite scroll with a loading spinner (20 conversations per page);
  - a download button exports the selected conversation as Markdown;
  - the selected row stays highlighted, and rows show the same hover highlight as Harness' native session rows.
- Clicking a history item:
  - writes the web conversation as a **real Harness session log** inside the `网页对话同步` workspace, so the main transcript shows every message with reasoning folded into Harness' native `reasoning` blocks;
  - typing in that transcript simply continues the conversation;
  - if the web conversation gained new messages, the next click creates a fresh mirror session (the old one is kept).
- In Chat mode, *New Session* creates a blank session inside `网页对话同步` instead of opening the workspace new-session flow.
- Zero-config sign-in:
  - on first install the plugin reads the `chat.deepseek.com` `userToken` from the local Chrome / Edge / Brave / Chromium Local Storage and validates it;
  - when that fails, the panel shows a **Connect DeepSeek web** card: auto-detect, open the web app, or paste the token once.

## Requirements

- DeepSeek Harness `0.2.x` (verified on the desktop build)
- Node.js `>= 22` (the Host half uses ESM and the global `fetch`)

## Install

### Option 1 — install from npm (after publishing)

```text
plugin_manager install_bundle  target = dsh-web-chat
```

Harness pulls the package from the configured npm registry and enables it in the current profile.

### Option 2 — install from a local folder

Unpack this folder anywhere (for example `D:\plugins\dsh-web-chat`) and ask Harness to run:

```text
plugin_manager install_bundle  target = <absolute path to that folder>
```

### Option 3 — add it to the profile manually

1. Copy the folder somewhere permanent (keep `package.json` at its root).
2. Edit `%USERPROFILE%\.dsh\profiles\desktop\package.json`:
   - add `"dsh-web-chat": "file:<absolute path>"` to `dependencies`;
   - add `"dsh-web-chat"` to `dsh.profile.bundles`.
3. Run `pnpm install` inside that profile folder.
4. Restart Harness.

> After installing, **reload the window once (Ctrl + R)**: client modules are only assembled when the page loads.

## Data directory

Defaults to `%USERPROFILE%\.dsh\web-chat-sync` (override with `DSH_WCS_DATA_DIR` or `DSH_HOME`):

| File | Purpose |
| --- | --- |
| `deepseek-web-token.txt` | web sign-in token (written automatically, **never share it**) |
| `cache.json` | cached history list |
| `sessions-map.json` | web conversation ↔ Harness session mapping |
| `imported/` | event copies used to rebuild mirrors |
| `diagnostics/` | troubleshooting JSON, safe to delete |

During development (when a `web-chat-sync/` folder sits next to the bundle) the plugin keeps using that legacy folder.

## Sign-in and privacy

- Harness signs in to the **API platform** (`platform.deepseek.com`); that token is **not** valid for the web app (`chat.deepseek.com`), so the plugin needs your web sign-in once.
- Auto-detection only reads local browser storage, and each candidate token is validated against the history endpoint before it is stored.
- The token is **never uploaded**, and the plugin **never writes back** to the web app (DeepSeek's web API is protected by a PoW challenge, so mirroring is impractical and risky).
- Uninstalling the plugin lets you delete the data folder above.

## How it works

- The Host half (`index.js`) registers seven `/api/wcs/*` routes:
  `sessions` (paged history), `messages` (one conversation), `open` (import or mirror into a Harness session),
  `continue`, `new-chat`, `export` (Markdown), `token` (read / save / auto-detect the web sign-in).
- History is read through the web app's private API and then written as DSH v4 session logs
  (multi-frame zstd JSONL), so Harness itself renders and resumes them like native sessions.
- The Client half (`client.js`) injects the sidebar pill and the history panel with plain DOM; all styling uses theme tokens.

## Development and self-checks

```bash
node test/smoke.mjs         # 51 offline client checks (fake DOM)
node tools/test-host.mjs    # Host route registration self-check
node tools/test-detect.mjs  # local browser token detection (hits the real history endpoint)
```

All three should print `all checks passed` / `PASS`.

## Known limitations

- Depends on the web app's private endpoints; a DeepSeek frontend update may require an adjustment.
- Verified on Windows desktop; the macOS / Linux browser paths are implemented but untested.
- No Harness → web write-back.

## Publishing

```bash
git init
git add .
git commit -m "feat: sidebar work/chat switch with DeepSeek web history"
git remote add origin https://github.com/William-JT-Shen/dsh-web-chat.git
git push -u origin main

npm login
npm publish --access public
```

Before publishing, replace `author`, `repository`, `bugs` and `homepage` in `package.json` and bump `version` if needed.

## License

MIT
