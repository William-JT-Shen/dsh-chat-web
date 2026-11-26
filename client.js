/**
 * Client half of the sidebar Work/Chat switch bundle.
 *
 * The shipped sidebar renders, top to bottom: the brand row (fish mark plus the
 * "deepseek HARNESS" wordmark), then the New Session button, then the panel
 * rows. There is no declared slot between the brand row and New Session, so this
 * bundle mounts its own row into that position at runtime: it inserts
 * `div.dsw-wcs-row` right after the brand row (located through its window-drag
 * marker, with the New Session button as a fallback anchor) and keeps it there
 * across sidebar re-renders, remounts, and collapse/expand.
 *
 * The brand row is left untouched: the fish mark and the wordmark keep rendering
 * exactly as shipped.
 */
window.__ModuleLoader__.load({
	id: "dsh-chat-web",
	factory: (require) => {
		/** Dictionary namespace owned by this bundle. */
		const NS = "sidebar-work-chat-switch";
		/** Persisted choice key. */
		const STORAGE_KEY = "dsh.sidebarWorkChatSwitch.mode";
		/** Custom event other client code can listen for. */
		const MODE_EVENT = "dsh:work-chat-mode";
		/** DOM style id, mirroring the shipped client-style convention. */
		const CSS_ID = "dsh-chat-web/WorkChatSwitch.css";
		/** Marker attribute on the injected row. */
		const ROW_ATTR = "data-dsw-work-chat-switch";
		/** Owner marker: only the newest module instance may own the row. */
		const OWNER_ATTR = "data-dsw-work-chat-switch-owner";
		/** Global slot holding the instance that currently owns the DOM. */
		const TOKEN_KEY = "__dswWorkChatSwitchInstance";
		/** Unique token of this module instance (a hot reload makes a new one). */
		const INSTANCE = "wcs-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
		/** Set by apply(): notified whenever the user switches the row's mode. */
		let modeListener = null;
		/** Matches the New Session control of the shipped sidebar (zh + en). */
		const NEW_SESSION_LABEL = /(新建会话|新会话|新建对话|新对话|new session)/i;
		/** Host data route serving the DeepSeek web chat session list. */
		const SESSIONS_ROUTE = "/api/wcs/sessions";
		/** Host data route serving one web chat's transcript. */
		const MESSAGES_ROUTE = "/api/wcs/messages";
		/** Host data route opening a 网页对话同步 Harness session from a web chat. */
		const OPEN_ROUTE = "/api/wcs/open";
		/** Host data route opening a 网页对话同步 Harness session from a web chat. */
		const CONTINUE_ROUTE = "/api/wcs/continue";
		/** Host data route creating a blank 网页对话同步 Harness session. */
		const NEW_CHAT_ROUTE = "/api/wcs/new-chat";
		/** Host data route rendering one web chat as Markdown for export. */
		const EXPORT_ROUTE = "/api/wcs/export";
		/** Temporary diagnostic sink used while tuning the hover highlight. */
		/** Host data route reading / saving / auto-detecting the web token. */
		const TOKEN_ROUTE = "/api/wcs/token";
		/** Marker attribute on the injected history panel. */
		const PANEL_ATTR = "data-dsw-wcs-history";

		const zh = {
			"label": "侧栏模式",
			"work": "工作",
			"chat": "对话",
			"continue": "接着聊（Harness 计费）",
			"continuing": "正在准备会话…",
			"newChat": "已创建新对话，正在打开…",
			"continueFailed": "无法创建会话：",
			"newChatFailed": "无法创建新对话：",
			"tokenExpired": "网页版登录已失效，请更新 web-chat-sync\\deepseek-web-token.txt 中的 token",
			"tokenMissing": "还没有配置网页版 token：请把 token 放进 web-chat-sync\\deepseek-web-token.txt",
			"connectTitle": "连接 DeepSeek 网页版",
			"connectMissing": "还没有读到网页版的登录信息。点下面的按钮自动读取，或粘贴一次 token。",
			"connectExpired": "网页版登录已失效。点下面的按钮自动重新读取，或粘贴新的 token。",
			"connectAuto": "自动读取登录态",
			"connectOpen": "打开网页版",
			"connectSave": "保存并连接",
			"connectTokenLabel": "网页版 token",
			"connectTokenPlaceholder": "粘贴网页版 token（可选）",
			"connectSearching": "正在本机浏览器里查找登录信息…",
			"connectSaving": "正在校验 token…",
			"connectOk": "连接成功，正在刷新…",
			"connectNeedToken": "请先粘贴 token",
			"connectAutoFailed": "自动读取失败：",
			"connectSaveFailed": "保存失败："
		};
		const en = {
			"label": "Sidebar mode",
			"work": "Work",
			"chat": "Chat",
			"continue": "Continue (Harness billing)",
			"continuing": "Preparing the session…",
			"newChat": "New conversation created, opening…",
			"continueFailed": "Could not create the session: ",
			"newChatFailed": "Could not create a new conversation: ",
			"tokenExpired": "DeepSeek web sign-in expired — update the token in web-chat-sync\\deepseek-web-token.txt",
			"tokenMissing": "No DeepSeek web token yet — put one into web-chat-sync\\deepseek-web-token.txt",
			"connectTitle": "Connect DeepSeek web",
			"connectMissing": "No web sign-in was found yet. Read it automatically below, or paste a token once.",
			"connectExpired": "The web sign-in expired. Read it again automatically below, or paste a fresh token.",
			"connectAuto": "Read sign-in automatically",
			"connectOpen": "Open DeepSeek web",
			"connectSave": "Save and connect",
			"connectTokenLabel": "Web token",
			"connectTokenPlaceholder": "Paste the web token (optional)",
			"connectSearching": "Looking for a sign-in in the local browsers…",
			"connectSaving": "Checking the token…",
			"connectOk": "Connected, refreshing…",
			"connectNeedToken": "Paste a token first",
			"connectAutoFailed": "Automatic detection failed: ",
			"connectSaveFailed": "Could not save: "
		};

		const css = [
			".dsw-wcs-row{display:block;padding:8px 0 0;-webkit-app-region:no-drag;}",
			".dsw-wcs-row[hidden]{display:none;}",
			".dsw-wcs-root{display:flex;align-items:center;gap:2px;width:100%;box-sizing:border-box;",
			"height:30px;padding:2px;border-radius:999px;",
			"background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);}",
			".dsw-wcs-segment{appearance:none;border:1px solid transparent;background:transparent;",
			"color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;",
			"height:100%;flex:1 1 0;min-width:0;display:inline-flex;align-items:center;justify-content:center;",
			"gap:6px;padding:0 10px;border-radius:999px;cursor:pointer;overflow:hidden;white-space:nowrap;}",
			".dsw-wcs-segment:hover{color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-segment:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-segment--active{background:var(--dsw-alias-bg-layer-2);",
			"border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-icon{display:inline-flex;flex:none;align-items:center;justify-content:center;}",
			".dsw-wcs-icon svg{display:block;}",
			".dsw-wcs-label{overflow:hidden;text-overflow:ellipsis;}",
			".dsw-wcs-history{display:flex;flex-direction:column;flex:1 1 auto;min-height:0;overflow:hidden;",
			"pointer-events:auto;-webkit-app-region:no-drag;}",
			// The shipped sidebar column disables pointer events around its own
			// content; without re-enabling them the injected rows never enter :hover
			// and pointer events only reach us through the document capture.
			".dsw-wcs-history *{pointer-events:auto;}",
			".dsw-wcs-history[hidden]{display:none;}",
			".dsw-wcs-history-head{display:flex;align-items:center;justify-content:space-between;",
			"gap:6px;padding:10px 4px 4px 8px;}",
			".dsw-wcs-history-heading{font-size:12px;color:var(--dsw-alias-label-secondary);}",
			".dsw-wcs-history-refresh{appearance:none;border:none;background:transparent;",
			"color:var(--dsw-alias-label-secondary);width:22px;height:22px;border-radius:6px;",
			"display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}",
			".dsw-wcs-history-refresh:hover{background:var(--dsw-alias-bg-layer-1);",
			"color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-history-refresh:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-history-tools{display:inline-flex;align-items:center;gap:2px;}",
			".dsw-wcs-history-export{appearance:none;border:none;background:transparent;",
			"color:var(--dsw-alias-label-secondary);width:22px;height:22px;border-radius:6px;",
			"display:inline-flex;align-items:center;justify-content:center;cursor:pointer;}",
			".dsw-wcs-history-export:hover{background:var(--dsw-alias-bg-layer-1);",
			"color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-history-export:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-history-list{flex:1 1 auto;min-height:0;overflow-y:auto;padding:0 4px 12px;}",
			".dsw-wcs-history-group{font-size:11px;color:var(--dsw-alias-label-secondary);padding:10px 8px 4px;}",
			".dsw-wcs-history-item{display:block;width:100%;box-sizing:border-box;text-align:left;",
			"appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-primary);",
			"font:inherit;font-size:13px;line-height:1.5;padding:6px 8px;border-radius:var(--dsw-radius-md, 8px);",
			"cursor:pointer;}",
			// Hover and selection mirror the shipped session rows (their CSS paints
			// both states with --dsw-alias-interactive-bg-hover). The token is
			// resolved at runtime by the script; the CSS here uses a neutral
			// translucent grey so the state is always visible even when the token is
			// missing or expands to a construct this engine cannot parse.
			".dsw-wcs-history-item:hover,.dsw-wcs-history-item--hover,",
			".dsw-wcs-history-item--active{background:rgba(255,255,255,.16);",
			"box-shadow:inset 3px 0 0 var(--dsw-alias-brand-primary,#4d6bfe),",
			"inset 0 0 0 1px rgba(255,255,255,.10);}",
			".dsw-wcs-history-item--active:hover,",
			".dsw-wcs-history-item--active.dsw-wcs-history-item--hover{background:rgba(255,255,255,.22);}",
			".dsw-wcs-history-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-history-title{display:block;overflow:hidden;",
			"text-overflow:ellipsis;white-space:nowrap;}",
			".dsw-wcs-history-empty{font-size:12px;color:var(--dsw-alias-label-secondary);padding:10px 8px;line-height:1.6;}",
			// Guided sign-in card: shown instead of the list while the web token is
			// missing or expired, so a fresh install needs at most one paste.
			".dsw-wcs-connect{display:flex;flex-direction:column;gap:8px;padding:8px 8px 12px;}",
			".dsw-wcs-connect-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-connect-text{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);}",
			".dsw-wcs-connect-actions{display:flex;flex-wrap:wrap;gap:6px;}",
			".dsw-wcs-connect-action{appearance:none;border:1px solid var(--dsw-alias-border-l1);",
			"background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);",
			"font:inherit;font-size:12px;line-height:1;padding:7px 10px;border-radius:8px;cursor:pointer;}",
			".dsw-wcs-connect-action:hover{background:var(--dsw-alias-bg-layer-2);}",
			".dsw-wcs-connect-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-connect-action--primary{border-color:transparent;",
			"background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}",
			".dsw-wcs-connect-action:disabled{opacity:.6;cursor:progress;}",
			".dsw-wcs-connect-row{display:flex;gap:6px;}",
			".dsw-wcs-connect-input{flex:1 1 auto;min-width:0;box-sizing:border-box;appearance:none;",
			"border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);",
			"color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;padding:6px 8px;border-radius:8px;}",
			".dsw-wcs-connect-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}",
			".dsw-wcs-connect-status{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary);}",
			".dsw-wcs-history-more{display:flex;align-items:center;justify-content:center;gap:6px;",
			"padding:10px 8px 4px;font-size:11px;color:var(--dsw-alias-label-secondary);}",
			".dsw-wcs-spinner{width:13px;height:13px;border-radius:50%;flex:none;",
			"border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);",
			"animation:dsw-wcs-spin .8s linear infinite;}",
			"@keyframes dsw-wcs-spin{to{transform:rotate(360deg);}}",
			".dsw-wcs-backdrop{position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.45);",
			"display:flex;align-items:center;justify-content:center;padding:24px;-webkit-app-region:no-drag;}",
			".dsw-wcs-dialog{width:min(760px,100%);max-height:82vh;display:flex;flex-direction:column;",
			"background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);",
			"border-radius:12px;box-shadow:0 18px 48px rgba(0,0,0,.32);overflow:hidden;}",
			".dsw-wcs-dialog-head{display:flex;align-items:center;justify-content:space-between;",
			"gap:12px;padding:12px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}",
			".dsw-wcs-dialog-title{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}",
			".dsw-wcs-dialog-close{appearance:none;border:none;background:transparent;color:var(--dsw-alias-label-secondary);",
			"width:26px;height:26px;border-radius:6px;font-size:16px;line-height:1;cursor:pointer;}",
			".dsw-wcs-dialog-close:hover{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-dialog-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:14px 16px 18px;}",
			".dsw-wcs-msg{margin:0 0 14px;}",
			".dsw-wcs-msg-role{font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:4px;}",
			".dsw-wcs-msg-text{font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word;",
			"color:var(--dsw-alias-label-primary);}",
			".dsw-wcs-dialog-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;",
			"padding:12px 16px;border-top:1px solid var(--dsw-alias-border-l1);}",
			".dsw-wcs-dialog-note{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.5;}",
			".dsw-wcs-continue{appearance:none;border:1px solid transparent;border-radius:999px;font:inherit;",
			"font-size:12px;line-height:1;padding:9px 14px;cursor:pointer;flex:none;",
			"background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}",
			".dsw-wcs-continue:hover{filter:brightness(1.06);}",
			".dsw-wcs-continue:disabled{opacity:.6;cursor:progress;}",
			".dsw-wcs-continue:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}",
			// Small label pinned beside the composer's send arrow while a 对话-mode
			// web conversation is open (it must never swallow pointer events).
			".dsw-wcs-continue-badge{position:fixed;z-index:55;pointer-events:none;",
			"font-size:11px;line-height:1.4;white-space:nowrap;padding:2px 8px;max-width:200px;",
			"overflow:hidden;text-overflow:ellipsis;",
			"border-radius:999px;border:1px solid var(--dsw-alias-border-l1);",
			"background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);",
			"transform:translate(-100%,-50%);}",
			"[data-dsw-wcs-badge-hidden]{display:none;}"
		].join("");

		/**
		 * Keep exactly one stylesheet for this plugin alive.
		 *
		 * A hot-reloaded module gets disposed while the next instance is already
		 * running; the disposed instance removes the <style> element it created,
		 * which silently drops every rule (hover states included) for the live
		 * instance. Therefore the tag is re-created on demand instead of being
		 * owned by one instance's cleanup.
		 */
		let styleTag = null;
		function ensureStyle() {
			if (styleTag !== null && styleTag.isConnected !== false) {
				return;
			}
			let existing = null;
			try {
				existing = document.querySelector(
					"style[data-plugin-css=" + JSON.stringify(CSS_ID) + "]"
				);
			} catch {
				existing = null;
			}
			if (existing !== null) {
				existing.textContent = css;
				styleTag = existing;
				return;
			}
			try {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-chat-web";
				tag.dataset.pluginCss = CSS_ID;
				tag.textContent = css;
				document.head.appendChild(tag);
				styleTag = tag;
			} catch (error) {
				warn("style injection failed", error);
			}
		}

		/** Log a diagnostic without ever failing the plugin. */
		function warn(detail, error) {
			try {
				console.error("[sidebar-work-chat-switch] " + detail, error);
			} catch {
				/* no-op */
			}
		}

		/** Read the persisted mode, defaulting to `work`. */
		function readMode() {
			try {
				return window.localStorage.getItem(STORAGE_KEY) === "chat" ? "chat" : "work";
			} catch {
				return "work";
			}
		}

		/** Persist the chosen mode and broadcast it for other client features. */
		function writeMode(mode) {
			try {
				window.localStorage.setItem(STORAGE_KEY, mode);
			} catch {
				return;
			}
			try {
				window.dispatchEvent(new CustomEvent(MODE_EVENT, { detail: { mode } }));
			} catch {
				/* no-op when CustomEvent is missing */
			}
		}

		/** Pick the dictionary that matches the page language. */
		function dictionary() {
			let lang = "";
			try {
				lang = String(
					(document.documentElement && document.documentElement.lang) ||
						(navigator.language || "en")
				).toLowerCase();
			} catch {
				lang = "";
			}
			return lang.indexOf("zh") === 0 ? zh : en;
		}

		/** Vertical position helper shared by both anchors. */
		function distanceOf(node) {
			try {
				const rect = node.getBoundingClientRect();
				return rect.top * 10000 + rect.left;
			} catch {
				return 0;
			}
		}

		/**
		 * Prefer a token-specific message over the raw HTTP/detail text: an expired
		 * or missing web token is the one failure a non-technical user can fix.
		 */
		function failureMessage(dict, error, fallback) {
			if (error && error.tokenMissing === true) {
				return dict.tokenMissing;
			}
			if (error && error.tokenInvalid === true) {
				return dict.tokenExpired;
			}
			return fallback + String(error && error.message ? error.message : error);
		}

		/** Same choice, but for a non-2xx JSON payload instead of a thrown error. */
		function payloadFailureMessage(dict, payload, fallback) {
			if (payload && payload.tokenMissing === true) {
				return dict.tokenMissing;
			}
			if (payload && payload.tokenInvalid === true) {
				return dict.tokenExpired;
			}
			return fallback + String((payload && payload.error) || "未知错误");
		}

		/**
		 * Locate the brand row of the shipped sidebar: the window-drag header that
		 * sits directly above New Session.
		 */
		function findLogoRow() {
			const candidates = [];
			for (const node of document.querySelectorAll("[data-window-drag]")) {
				const parent = node.parentElement;
				if (parent === null) {
					continue;
				}
				if (!NEW_SESSION_LABEL.test(String(parent.textContent || ""))) {
					continue;
				}
				candidates.push({ node, distance: distanceOf(node) });
			}
			candidates.sort((left, right) => left.distance - right.distance);
			return candidates.length === 0 ? null : candidates[0].node;
		}

		/** Fallback anchor: the New Session button itself. */
		function findNewSessionButton() {
			const candidates = [];
			for (const button of document.querySelectorAll("button")) {
				let label = "";
				try {
					label = String(button.getAttribute("aria-label") || "");
				} catch {
					label = "";
				}
				const text = String(button.textContent || "").replace(/\s+/g, " ").trim();
				if (!NEW_SESSION_LABEL.test(label + " " + text)) {
					continue;
				}
				// The brand button also starts a new session; skip the wordmark.
				if (/deepseek|harness/i.test(label + " " + text)) {
					continue;
				}
				if (button.querySelector("svg") === null) {
					continue;
				}
				// The sidebar's own New Session control is the topmost/leftmost match;
				// session-list items and command entries sit further down the page.
				candidates.push({ button, distance: distanceOf(button) });
			}
			candidates.sort((left, right) => left.distance - right.distance);
			return candidates.length === 0 ? null : candidates[0].button;
		}

		function iconMarkup(which) {
			if (which === "work") {
				return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><rect x="1.75" y="2.5" width="12.5" height="8.75" rx="1.75" stroke="currentColor" stroke-width="1.4"></rect><path d="M6 14h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>';
			}
			return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M13.5 7.75a3.75 3.75 0 0 1-3.75 3.75H6.9L3.2 14v-2.86A3.75 3.75 0 0 1 2.5 7.75v-.5A3.75 3.75 0 0 1 6.25 3.5h3.5a3.75 3.75 0 0 1 3.75 3.75z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"></path><circle cx="5.6" cy="7.5" r="0.85" fill="currentColor"></circle><circle cx="8.1" cy="7.5" r="0.85" fill="currentColor"></circle><circle cx="10.6" cy="7.5" r="0.85" fill="currentColor"></circle></svg>';
		}

		/**
		 * Build the two-segment mode row. The row owns its own DOM so it can slot
		 * into the shipped sidebar flow, which has no React extension point there.
		 */
		function buildRow() {
			const dict = dictionary();
			const mode = readMode();

			const row = document.createElement("div");
			row.className = "dsw-wcs-row";
			row.setAttribute(ROW_ATTR, "");
			row.setAttribute(OWNER_ATTR, INSTANCE);

			const group = document.createElement("div");
			group.className = "dsw-wcs-root";
			group.setAttribute("role", "group");
			group.setAttribute("aria-label", dict.label);
			row.appendChild(group);

			const segs = {};
			/**
			 * Apply a mode to this row. Guarded so a click and the pointer fallback
			 * below cannot toggle twice, and so a repeat click is a no-op.
			 */
			const switchTo = (value) => {
				if (value !== "work" && value !== "chat") {
					return;
				}
				if (value === row.dataset.mode) {
					return;
				}
				row.dataset.mode = value;
				writeMode(value);
				if (typeof modeListener === "function") {
					try {
						modeListener(value);
					} catch (error) {
						warn("mode listener failed", error);
					}
				}
				for (const [name, node] of Object.entries(segs)) {
					const active = name === value;
					node.classList.toggle("dsw-wcs-segment--active", active);
					node.setAttribute("aria-pressed", active ? "true" : "false");
				}
			};
			// The sidebar owns this subtree's hit testing; a pointer fallback can
			// address the row even when something swallows the click event.
			row.dswSwitchTo = switchTo;
			for (const value of ["work", "chat"]) {
				const seg = document.createElement("button");
				seg.type = "button";
				seg.className = "dsw-wcs-segment";
				seg.dataset.mode = value;
				seg.setAttribute("aria-pressed", value === mode ? "true" : "false");
				seg.title = dict[value];
				const icon = document.createElement("span");
				icon.className = "dsw-wcs-icon";
				icon.innerHTML = iconMarkup(value);
				seg.appendChild(icon);
				const label = document.createElement("span");
				label.className = "dsw-wcs-label";
				label.textContent = dict[value];
				seg.appendChild(label);
				if (value === mode) {
					seg.classList.add("dsw-wcs-segment--active");
				}
				seg.addEventListener("click", (event) => {
					event.stopPropagation();
					switchTo(value);
				});
				segs[value] = seg;
				group.appendChild(seg);
			}
			row.dataset.mode = mode;
			return row;
		}

		/** Install the row into the shipped sidebar flow and keep it there. */
		function apply(ctx) {
			// A hot reload disposes the previous instance, but callbacks it already
			// queued may still run once. Whoever claims the token last owns the DOM,
			// so a stale instance can never insert a second row.
			try {
				window[TOKEN_KEY] = INSTANCE;
			} catch {
				/* no-op */
			}
			const isCurrent = () => {
				try {
					return window[TOKEN_KEY] === INSTANCE;
				} catch {
					return true;
				}
			};

			const effect = typeof ctx.effect === "function"
				? ctx.effect
				: (run) => {
					const cleanup = run();
					if (typeof ctx.on === "function" && typeof cleanup === "function") {
						ctx.on("dispose", cleanup);
					}
					return cleanup;
				};

			effect(() => {
				ensureStyle();
				const dict = dictionary();
				// Drop rows left behind by an earlier instance (hot reload).
				for (const stale of document.querySelectorAll("[" + ROW_ATTR + "]")) {
					if (stale.getAttribute(OWNER_ATTR) !== INSTANCE) {
						stale.remove();
					}
				}
				let row = null;
				let observer = null;
				let frame = 0;
				let panel = null;
				let region = null;
				let regionDisplay = "";
				let modal = null;
				let pollTimer = 0;
				let sessions = null;
				let sessionsError = "";
				let sessionsLoading = false;
				/** "" | "missing" | "expired": the web login needs (re)connecting. */
				let tokenIssue = "";
				let fetchSeq = 0;
				let hasMore = false;
				let nextCursor = null;
				let loadingMore = false;
				let loadMoreError = "";
				const PAGE_SIZE = 20;

				/** Reuse the row this instance already built, else build one. */
				const adoptRow = () => {
					for (const node of document.querySelectorAll("[" + ROW_ATTR + "]")) {
						if (node.getAttribute(OWNER_ATTR) === INSTANCE) {
							return node;
						}
					}
					return buildRow();
				};

				/** Read JSON from one of the plugin's own Host routes. */
				const fetchJson = (url) => fetch(url, {
					credentials: "same-origin",
					headers: { accept: "application/json" }
				}).then((response) => response.text().then((text) => {
					let payload = null;
					try {
						payload = text ? JSON.parse(text) : null;
					} catch {
						payload = null;
					}
					if (!response.ok) {
						const detail = payload && typeof payload === "object" && payload.error
							? String(payload.error)
							: "HTTP " + response.status;
						const failure = new Error(detail);
						if (payload && typeof payload === "object") {
							failure.tokenInvalid = payload.tokenInvalid === true;
							failure.tokenMissing = payload.tokenMissing === true;
						}
						throw failure;
					}
					return payload;
				}));

				/** POST JSON to one of the plugin's own Host routes. */
				const postJson = (url, body) => fetch(url, {
					method: "POST",
					credentials: "same-origin",
					headers: { accept: "application/json", "content-type": "application/json" },
					body: JSON.stringify(body || {})
				}).then((response) => response.text().then((text) => {
					let payload = null;
					try {
						payload = text ? JSON.parse(text) : null;
					} catch {
						payload = null;
					}
					if (!response.ok) {
						const detail = payload && typeof payload === "object" && payload.error
							? String(payload.error)
							: "HTTP " + response.status;
						const failure = new Error(detail);
						if (payload && typeof payload === "object") {
							failure.tokenInvalid = payload.tokenInvalid === true;
							failure.tokenMissing = payload.tokenMissing === true;
						}
						throw failure;
					}
					return payload;
				}));

				/** Bucket the web history the way the DeepSeek web sidebar does. */
				const groupLabel = (session) => {
					if (session && session.pinned) {
						return "置顶";
					}
					const seconds = Number(session && session.updatedAt ? session.updatedAt : 0);
					const offset = 8 * 3600;
					const today = Math.floor((Date.now() / 1000 + offset) / 86400);
					const day = Math.floor((seconds + offset) / 86400);
					if (day >= today) {
						return "今天";
					}
					if (day === today - 1) {
						return "昨天";
					}
					return "更早";
				};

				/** Mirror the collapsed rail: a narrow header means no room. */
				const syncVisibility = (anchor) => {
					if (row === null) {
						return;
					}
					let narrow = false;
					try {
						narrow = anchor.getBoundingClientRect().width < 140;
					} catch {
						narrow = false;
					}
					row.hidden = narrow;
					if (panel !== null) {
						panel.hidden = narrow || row.dataset.mode !== "chat";
					}
				};

				/** The shipped 工作区 region: the column child that owns the heading. */
				const findRegion = (column) => {
					if (column === null) {
						return null;
					}
					for (const child of column.children) {
						if (child === row) {
							continue;
						}
						if (typeof child.getAttribute === "function" && child.getAttribute(ROW_ATTR) !== null) {
							continue;
						}
						if (!String(child.textContent || "").includes("工作区")) {
							continue;
						}
						return child;
					}
					return null;
				};

				/** Guided sign-in card: lets a fresh install connect in one step. */
				const renderConnectCard = (list) => {
					const card = document.createElement("div");
					card.className = "dsw-wcs-connect";
					card.setAttribute("data-dsw-wcs-connect", tokenIssue);
					card.addEventListener("click", (event) => event.stopPropagation());

					const title = document.createElement("div");
					title.className = "dsw-wcs-connect-title";
					title.textContent = dict.connectTitle;
					card.appendChild(title);

					const text = document.createElement("div");
					text.className = "dsw-wcs-connect-text";
					text.textContent = tokenIssue === "missing" ? dict.connectMissing : dict.connectExpired;
					card.appendChild(text);

					const status = document.createElement("div");
					status.className = "dsw-wcs-connect-status";
					const succeed = () => {
						tokenIssue = "";
						sessionsError = "";
						status.textContent = dict.connectOk;
						loadSessions();
					};

					const actions = document.createElement("div");
					actions.className = "dsw-wcs-connect-actions";

					const auto = document.createElement("button");
					auto.type = "button";
					auto.className = "dsw-wcs-connect-action dsw-wcs-connect-action--primary";
					auto.textContent = dict.connectAuto;
					auto.addEventListener("click", (event) => {
						event.stopPropagation();
						auto.disabled = true;
						status.textContent = dict.connectSearching;
						postJson(TOKEN_ROUTE, { action: "auto" })
							.then((payload) => {
								auto.disabled = false;
								if (!payload || payload.ok === false) {
									throw new Error(payload && payload.error ? String(payload.error) : "unknown");
								}
								succeed();
							})
							.catch((error) => {
								auto.disabled = false;
								status.textContent = failureMessage(dict, error, dict.connectAutoFailed);
							});
					});
					actions.appendChild(auto);

					const open = document.createElement("button");
					open.type = "button";
					open.className = "dsw-wcs-connect-action";
					open.textContent = dict.connectOpen;
					open.addEventListener("click", (event) => {
						event.stopPropagation();
						try {
							window.open("https://chat.deepseek.com/", "_blank", "noopener");
						} catch {
							/* opening a tab is best effort */
						}
					});
					actions.appendChild(open);
					card.appendChild(actions);

					const row = document.createElement("div");
					row.className = "dsw-wcs-connect-row";
					const input = document.createElement("input");
					input.type = "text";
					input.className = "dsw-wcs-connect-input";
					input.placeholder = dict.connectTokenPlaceholder;
					input.setAttribute("aria-label", dict.connectTokenLabel);
					const save = document.createElement("button");
					save.type = "button";
					save.className = "dsw-wcs-connect-action";
					save.textContent = dict.connectSave;
					save.addEventListener("click", (event) => {
						event.stopPropagation();
						const value = String(input.value || "").trim();
						if (value === "") {
							status.textContent = dict.connectNeedToken;
							return;
						}
						save.disabled = true;
						status.textContent = dict.connectSaving;
						postJson(TOKEN_ROUTE, { token: value })
							.then((payload) => {
								save.disabled = false;
								if (!payload || payload.ok === false) {
									throw new Error(payload && payload.error ? String(payload.error) : "unknown");
								}
								succeed();
							})
							.catch((error) => {
								save.disabled = false;
								status.textContent = failureMessage(dict, error, dict.connectSaveFailed);
							});
					});
					row.appendChild(input);
					row.appendChild(save);
					card.appendChild(row);
					card.appendChild(status);
					list.appendChild(card);
				};

				const renderSessions = () => {
					if (panel === null) {
						return;
					}
					const list = panel.querySelector(".dsw-wcs-history-list");
					if (list === null) {
						return;
					}
					list.textContent = "";
					const message = (text) => {
						const node = document.createElement("div");
						node.className = "dsw-wcs-history-empty";
						node.textContent = text;
						list.appendChild(node);
					};
					if (tokenIssue !== "") {
						renderConnectCard(list);
						return;
					}
					if (sessionsError !== "") {
						message(sessionsError);
						return;
					}
					if (sessions === null) {
						message(sessionsLoading ? "正在读取网页对话…" : "暂无对话");
						return;
					}
					if (sessions.length === 0) {
						message("网页版还没有对话记录。");
						return;
					}
					const groups = new Map();
					for (const session of sessions) {
						const label = groupLabel(session);
						if (!groups.has(label)) {
							groups.set(label, []);
						}
						groups.get(label).push(session);
					}
					for (const label of ["置顶", "今天", "昨天", "更早"]) {
						const items = groups.get(label);
						if (items === undefined || items.length === 0) {
							continue;
						}
						const heading = document.createElement("div");
						heading.className = "dsw-wcs-history-group";
						heading.textContent = label;
						list.appendChild(heading);
						for (const session of items) {
							const item = document.createElement("button");
							item.type = "button";
							item.className = "dsw-wcs-history-item";
							if (activeWebId !== "" && String(session.id || "") === activeWebId) {
								item.className = "dsw-wcs-history-item dsw-wcs-history-item--active";
								item.setAttribute("data-active", "true");
							}
							// aria-label keeps the full title accessible without the
							// native hover tooltip covering the list.
							item.setAttribute("aria-label", String(session.title || "未命名对话"));
							const title = document.createElement("span");
							title.className = "dsw-wcs-history-title";
							title.textContent = String(session.title || "未命名对话");
							item.appendChild(title);
							item.setAttribute("data-session-id", String(session.id || ""));
							item.addEventListener("click", (event) => {
								event.stopPropagation();
								openSession(session);
							});
							list.appendChild(item);
						}
					}
					if (hasMore || loadingMore) {
						const foot = document.createElement("div");
						foot.className = "dsw-wcs-history-more";
						if (loadingMore) {
							const spinner = document.createElement("span");
							spinner.className = "dsw-wcs-spinner";
							foot.appendChild(spinner);
						}
						const hint = document.createElement("span");
						hint.textContent = loadingMore ? "正在加载更多…" : "继续向下滚动加载更多";
						foot.appendChild(hint);
						list.appendChild(foot);
					}
					if (loadMoreError !== "") {
						message(loadMoreError);
					}
				};

				const loadSessions = () => {
					if (sessionsLoading || panel === null) {
						return;
					}
					sessionsLoading = true;
					sessionsError = "";
					loadMoreError = "";
					renderSessions();
					const seq = ++fetchSeq;
					fetchJson(SESSIONS_ROUTE + "?count=" + PAGE_SIZE)
						.then((payload) => {
							if (seq !== fetchSeq) {
								return;
							}
							sessionsLoading = false;
							if (payload && payload.ok === false) {
								sessions = null;
								hasMore = false;
								nextCursor = null;
								tokenIssue = payload.tokenMissing === true
									? "missing"
									: payload.tokenInvalid === true ? "expired" : "";
								sessionsError = payloadFailureMessage(dict, payload, "无法读取网页对话：");
							} else {
								tokenIssue = "";
								sessions = Array.isArray(payload && payload.sessions) ? payload.sessions : [];
								hasMore = Boolean(payload && payload.hasMore);
								nextCursor = payload && payload.cursor ? payload.cursor : null;
							}
							renderSessions();
						})
						.catch((error) => {
							if (seq !== fetchSeq) {
								return;
							}
							sessionsLoading = false;
							sessions = null;
							hasMore = false;
							nextCursor = null;
							if (error && error.tokenMissing === true) {
								tokenIssue = "missing";
							} else if (error && error.tokenInvalid === true) {
								tokenIssue = "expired";
							}
							sessionsError = failureMessage(dict, error, "无法连接插件后台：");
							renderSessions();
						});
				};

				/** Append the next page of web sessions when the list is scrolled down. */
				const loadMore = () => {
					if (loadingMore || !hasMore || nextCursor === null || sessions === null || panel === null) {
						return;
					}
					loadingMore = true;
					loadMoreError = "";
					renderSessions();
					const seq = fetchSeq;
					const query = "?count=" + PAGE_SIZE
						+ "&beforePinned=" + (nextCursor.pinned === true ? "true" : "false")
						+ "&beforeUpdatedAt=" + encodeURIComponent(String(nextCursor.updatedAt));
					fetchJson(SESSIONS_ROUTE + query)
						.then((payload) => {
							if (seq !== fetchSeq) {
								loadingMore = false;
								return;
							}
							loadingMore = false;
							if (payload && payload.ok === false) {
								loadMoreError = payloadFailureMessage(dict, payload, "加载更多失败：");
								renderSessions();
								return;
							}
							const incoming = Array.isArray(payload && payload.sessions) ? payload.sessions : [];
							const known = new Set((sessions || []).map((session) => String(session.id || "")));
							// The web cursor row repeats the previous last item, so merge by id.
							for (const session of incoming) {
								const id = String(session.id || "");
								if (id !== "" && !known.has(id)) {
									known.add(id);
									sessions.push(session);
								}
							}
							hasMore = Boolean(payload && payload.hasMore);
							nextCursor = payload && payload.cursor ? payload.cursor : null;
							renderSessions();
						})
						.catch((error) => {
							if (seq !== fetchSeq) {
								loadingMore = false;
								return;
							}
							loadingMore = false;
							loadMoreError = failureMessage(dict, error, "加载更多失败：");
							renderSessions();
						});
				};

				const startPoll = () => {
					if (pollTimer !== 0) {
						return;
					}
					pollTimer = setInterval(() => {
						if (row !== null && row.dataset.mode === "chat") {
							// A background refresh would reset the scrolled list, so only
							// refresh while the panel is at the top.
							const list = panel === null ? null : panel.querySelector(".dsw-wcs-history-list");
							if (list === null || list.scrollTop <= 4) {
								loadSessions();
							}
						}
					}, 20000);
				};

				const stopPoll = () => {
					if (pollTimer !== 0) {
						clearInterval(pollTimer);
						pollTimer = 0;
					}
				};

				const ensurePanel = () => {
					if (panel !== null && panel.parentElement !== null) {
						return panel;
					}
					panel = document.createElement("div");
					panel.className = "dsw-wcs-history";
					panel.setAttribute(PANEL_ATTR, "");
					const head = document.createElement("div");
					head.className = "dsw-wcs-history-head";
					const heading = document.createElement("span");
					heading.className = "dsw-wcs-history-heading";
					heading.textContent = "网页对话";
					head.appendChild(heading);
					const tools = document.createElement("div");
					tools.className = "dsw-wcs-history-tools";
					const exportButton = document.createElement("button");
					exportButton.type = "button";
					exportButton.className = "dsw-wcs-history-export";
					exportButton.title = "导出当前对话（Markdown）";
					exportButton.setAttribute("aria-label", "导出当前对话");
					exportButton.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M8 2v7.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M4.8 6.4 8 9.6l3.2-3.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path><path d="M2.8 11.4v1.4a1 1 0 0 0 1 1h8.4a1 1 0 0 0 1-1v-1.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path></svg>';
					exportButton.addEventListener("click", (event) => {
						event.stopPropagation();
						exportActive();
					});
					tools.appendChild(exportButton);
					const refresh = document.createElement("button");
					refresh.type = "button";
					refresh.className = "dsw-wcs-history-refresh";
					refresh.title = "刷新";
					refresh.setAttribute("aria-label", "刷新网页对话");
					refresh.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false"><path d="M13 8a5 5 0 1 1-1.46-3.54" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"></path><path d="M13 2.6V5.4H10.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
					refresh.addEventListener("click", (event) => {
						event.stopPropagation();
						loadSessions();
					});
					tools.appendChild(refresh);
					head.appendChild(tools);
					panel.appendChild(head);
					const list = document.createElement("div");
					list.className = "dsw-wcs-history-list";
					list.addEventListener("scroll", () => {
						if (list.scrollTop + list.clientHeight >= list.scrollHeight - 32) {
							loadMore();
						}
					});
					panel.appendChild(list);
					renderSessions();
					loadSessions();
					return panel;
				};

				const showChat = (column) => {
					if (column === null) {
						return;
					}
					const found = findRegion(column);
					const node = ensurePanel();
					if (found !== null) {
						if (found !== region) {
							if (region !== null && region.style !== undefined) {
								region.style.display = regionDisplay;
							}
							region = found;
							regionDisplay = found.style ? found.style.display : "";
						}
						if (node.parentElement !== column || node.nextElementSibling !== found) {
							column.insertBefore(node, found);
						}
						if (found.style !== undefined) {
							found.style.display = "none";
						}
					} else if (node.parentElement !== column) {
						column.appendChild(node);
					}
					node.hidden = !!(row && row.hidden);
					startPoll();
				};

				const showWork = () => {
					if (panel !== null) {
						panel.hidden = true;
					}
					if (region !== null && region.style !== undefined) {
						region.style.display = regionDisplay;
					}
					stopPoll();
				};

				const closeModal = () => {
					if (modal !== null && modal.parentElement !== null) {
						modal.remove();
					}
					modal = null;
				};

				/**
				 * Open a Harness session in the conversation area.
				 *
				 * The imported session lives only in durable storage (never in the Host
				 * live store, or `resume` would collide with it), so the Client must pull
				 * a fresh session list before `sessions.retain` can accept the id. The
				 * public refresh entry point is `sessions.refresh()`.
				 */
				const openHarnessSession = async (sessionId) => {
					try {
						const sessionsService = typeof ctx.get === "function" ? ctx.get("sessions") : undefined;
						if (sessionsService && typeof sessionsService.refresh === "function") {
							await sessionsService.refresh();
						} else if (sessionsService && typeof sessionsService.refreshList === "function") {
							await sessionsService.refreshList();
						}
					} catch (error) {
						warn("session list refresh failed", error);
					}
					try {
						const service = typeof ctx.get === "function" ? ctx.get("uiWorkspace") : undefined;
						if (!service || typeof service.openSession !== "function") {
							return { ok: false, error: "uiWorkspace service unavailable" };
						}
						service.openSession(sessionId);
						return { ok: true, error: "" };
					} catch (error) {
						warn("openSession failed", error);
						return { ok: false, error: String((error && error.message) || error) };
					}
				};

				let badge = null;
				/** The composer's send arrow, found structurally (class names are hashed). */
				const findComposerSendButton = () => {
					let fields = [];
					try {
						fields = document.querySelectorAll("textarea, [contenteditable='true']");
					} catch {
						fields = [];
					}
					for (const field of fields) {
						let node = field.parentElement;
						for (let depth = 0; node !== null && depth < 6; depth += 1) {
							let buttons = [];
							try {
								buttons = Array.from(node.querySelectorAll("button"));
							} catch {
								buttons = [];
							}
							for (let index = buttons.length - 1; index >= 0; index -= 1) {
								const button = buttons[index];
								const label = `${String(button.getAttribute("aria-label") || "")} ${String(button.title || "")}`;
								if (/发送|send/i.test(label) || (label.trim() === "" && button.querySelector("svg") !== null)) {
									return button;
								}
							}
							node = node.parentElement;
						}
					}
					return null;
				};
				/**
				 * The model label sitting just left of the send arrow. The composer is
				 * laid out with hashed classes, so the label is found by scanning the
				 * composer band for a short text node that reads like a model name and
				 * is the right-most one left of the arrow.
				 */
				const findComposerModelLabel = (sendButton) => {
					if (sendButton === null) {
						return null;
					}
					let sendRect = null;
					try {
						sendRect = sendButton.getBoundingClientRect();
					} catch {
						return null;
					}
					if (sendRect === null || sendRect.width === 0) {
						return null;
					}
					const centerY = sendRect.top + sendRect.height / 2;
					let scope = sendButton.parentElement;
					for (let depth = 0; scope !== null && depth < 5; depth += 1) {
						let nodes = [];
						try {
							nodes = Array.from(scope.querySelectorAll("*"));
						} catch {
							nodes = [];
						}
						let best = null;
						let bestLeft = -Infinity;
						for (const node of nodes) {
							const text = String(node.textContent || "").trim();
							if (text === "" || text.length > 40) continue;
							if (!/deepseek|v4|flash|模型/i.test(text)) continue;
							let rect = null;
							try {
								rect = node.getBoundingClientRect();
							} catch {
								continue;
							}
							if (rect.width === 0) continue;
							if (Math.abs(rect.top + rect.height / 2 - centerY) > Math.max(26, sendRect.height)) continue;
							if (rect.left > sendRect.left - 4) continue;
							if (rect.left > bestLeft) {
								best = node;
								bestLeft = rect.left;
							}
						}
						if (best !== null) {
							return best;
						}
						scope = scope.parentElement;
					}
					return null;
				};
				/** Keeps the "接着聊（Harness 计费）" label beside the send arrow in 对话 mode. */
				const syncBadge = () => {
					const dict = dictionary();
					const visible = row !== null && row.dataset.mode === "chat" && importedSession !== "";
					if (!visible) {
						if (badge !== null) {
							try {
								badge.remove();
							} catch {
								/* no-op */
							}
						}
						badge = null;
						return;
					}
					if (badge === null) {
						badge = document.createElement("div");
						badge.className = "dsw-wcs-continue-badge";
						badge.textContent = dict.continue;
						document.body.appendChild(badge);
					}
					const button = findComposerSendButton();
					// Prefer the model label left of the arrow; the arrow itself would
					// overlap the model name when the window is narrow.
					const label = findComposerModelLabel(button);
					const anchor = label !== null ? label : button;
					let rect = null;
					if (anchor !== null) {
						try {
							rect = anchor.getBoundingClientRect();
						} catch {
							rect = null;
						}
					}
					if (rect === null || rect.width === 0) {
						badge.style.left = "";
						badge.style.top = "";
						badge.style.transform = "none";
						badge.style.right = "28px";
						badge.style.bottom = "110px";
						return;
					}
					badge.style.right = "";
					badge.style.bottom = "";
					if (label !== null) {
						// Anchor the right edge a little left of the model name, in the
						// empty stretch between the permission chip and the model label.
						const viewWidth = Number(window.innerWidth);
						badge.style.top = `${Math.round(rect.top + rect.height / 2)}px`;
						if (Number.isFinite(viewWidth) && viewWidth > 0) {
							badge.style.left = "";
							badge.style.right = `${Math.max(8, Math.round(viewWidth - rect.left + 10))}px`;
							badge.style.transform = "translate(0,-50%)";
						} else {
							badge.style.left = `${Math.round(rect.left - 10)}px`;
							badge.style.transform = "translate(-100%,-50%)";
						}
					} else {
						// No label found: sit above the arrow so nothing overlaps it.
						badge.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
						badge.style.top = `${Math.round(rect.top - 6)}px`;
						badge.style.transform = "translate(-50%,-100%)";
					}
				};

				const showPreview = (session, messages, failure) => {
					closeModal();
					const dict = dictionary();
					const backdrop = document.createElement("div");
					backdrop.className = "dsw-wcs-backdrop";
					const dialog = document.createElement("div");
					dialog.className = "dsw-wcs-dialog";
					const head = document.createElement("div");
					head.className = "dsw-wcs-dialog-head";
					const title = document.createElement("span");
					title.className = "dsw-wcs-dialog-title";
					title.textContent = String((session && session.title) || "网页对话");
					head.appendChild(title);
					const close = document.createElement("button");
					close.type = "button";
					close.className = "dsw-wcs-dialog-close";
					close.setAttribute("aria-label", "关闭");
					close.textContent = "×";
					close.addEventListener("click", (event) => {
						event.stopPropagation();
						closeModal();
					});
					head.appendChild(close);
					dialog.appendChild(head);
					const body = document.createElement("div");
					body.className = "dsw-wcs-dialog-body";
					if (failure !== "") {
						const node = document.createElement("div");
						node.className = "dsw-wcs-history-empty";
						node.textContent = failure;
						body.appendChild(node);
					} else {
						for (const message of messages) {
							const block = document.createElement("div");
							block.className = "dsw-wcs-msg";
							const role = document.createElement("div");
							role.className = "dsw-wcs-msg-role";
							role.textContent = String(message.role || "").toUpperCase() === "USER" ? "你" : "DeepSeek";
							const text = document.createElement("div");
							text.className = "dsw-wcs-msg-text";
							text.textContent = String(message.text || "");
							block.appendChild(role);
							block.appendChild(text);
							body.appendChild(block);
						}
					}
					dialog.appendChild(body);
					if (failure === "" && session && session.id) {
						const foot = document.createElement("div");
						foot.className = "dsw-wcs-dialog-foot";
						const note = document.createElement("div");
						note.className = "dsw-wcs-dialog-note";
						note.textContent = "继续聊会在「网页对话同步」工作区新建一场 Harness 会话，按 Harness 默认 API 计费。";
						const continueButton = document.createElement("button");
						continueButton.type = "button";
						continueButton.className = "dsw-wcs-continue";
						continueButton.textContent = dict.continue;
						continueButton.addEventListener("click", (event) => {
							event.stopPropagation();
							if (continueButton.disabled) {
								return;
							}
							continueButton.disabled = true;
							continueButton.textContent = dict.continuing;
							note.textContent = dict.continuing;
							fetchJson(CONTINUE_ROUTE + "?id=" + encodeURIComponent(String(session.id)))
								.then((payload) => {
									if (!payload || payload.ok === false || !payload.sessionId) {
										throw new Error(String((payload && payload.error) || "unknown"));
									}
									closeModal();
									openHarnessSession(payload.sessionId);
								})
								.catch((error) => {
									continueButton.disabled = false;
									continueButton.textContent = dict.continue;
									note.textContent = failureMessage(dict, error, dict.continueFailed);
								});
						});
						foot.appendChild(note);
						foot.appendChild(continueButton);
						dialog.appendChild(foot);
					}
					backdrop.appendChild(dialog);
					backdrop.addEventListener("pointerdown", (event) => {
						if (event.target === backdrop) {
							closeModal();
						}
					});
					document.body.appendChild(backdrop);
					modal = backdrop;
				};

				let lastOpenId = "";
				let lastOpenAt = 0;
				let importedSession = "";
				// Web conversation currently open as a Harness session; the history
				// list keeps this item highlighted so the user always knows which
				// conversation the transcript belongs to.
				let activeWebId = "";
				const setPanelError = (text) => {
					try {
						const heading = panel === null ? null : panel.querySelector(".dsw-wcs-history-heading");
						if (heading !== null && heading !== undefined) {
							heading.textContent = text;
						}
					} catch {
						/* heading is advisory only */
					}
				};
				const revealActive = () => {
					try {
						if (panel === null) {
							return;
						}
						const active = panel.querySelector(".dsw-wcs-history-item--active");
						if (active !== null && active !== undefined && typeof active.scrollIntoView === "function") {
							active.scrollIntoView({ block: "nearest" });
						}
					} catch {
						/* scrolling is advisory only */
					}
				};
				const downloadMarkdown = (filename, text) => {
					try {
						const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
						const url = URL.createObjectURL(blob);
						const link = document.createElement("a");
						link.href = url;
						link.download = filename;
						link.style.display = "none";
						document.body.appendChild(link);
						link.click();
						link.remove();
						setTimeout(() => {
							try {
								URL.revokeObjectURL(url);
							} catch {
								/* best effort */
							}
						}, 4000);
						return true;
					} catch (error) {
						warn("markdown download failed", error);
						return false;
					}
				};
				const exportActive = () => {
					if (activeWebId === "") {
						setPanelError("先选一条对话，再导出");
						return;
					}
					fetchJson(EXPORT_ROUTE + "?id=" + encodeURIComponent(activeWebId))
						.then((payload) => {
							if (!payload || payload.ok === false || typeof payload.markdown !== "string") {
								throw new Error(String((payload && payload.error) || "unknown"));
							}
							const name = String(payload.filename || "网页对话.md");
							if (downloadMarkdown(name, payload.markdown)) {
								setPanelError("已导出：" + name);
							} else {
								setPanelError("导出失败：浏览器拒绝下载");
							}
						})
						.catch((error) => {
							setPanelError(failureMessage(dict, error, "导出失败："));
						});
				};
				const openSession = (session) => {
					const id = String((session && session.id) || "");
					const now = Date.now();
					// A click and the pointerup fallback can both address one item.
					if (id === lastOpenId && now - lastOpenAt < 800) {
						return;
					}
					lastOpenId = id;
					lastOpenAt = now;
					fetchJson(OPEN_ROUTE + "?id=" + encodeURIComponent(id))
						.then(async (payload) => {
							if (!payload || payload.ok === false || !payload.sessionId) {
								throw new Error(String((payload && payload.error) || "unknown"));
							}
							importedSession = String(payload.sessionId);
							activeWebId = id;
							if (row !== null) {
								row.dataset.imported = importedSession;
							}
							const opened = await openHarnessSession(importedSession);
							if (!opened.ok) {
								setPanelError("打开会话失败：" + opened.error);
							} else if (payload.updated === true) {
								setPanelError("网页版有新内容，已同步最新镜像");
							} else {
								setPanelError("网页对话");
							}
							renderSessions();
							revealActive();
							schedule();
						})
						.catch((error) => {
							warn("open history failed", error);
							setPanelError(failureMessage(dict, error, "打开历史对话失败："));
						});
				};

				/** Keep the row right after the brand row (or before New Session). */
				const ensure = () => {
					if (!isCurrent()) {
						return;
					}
					ensureStyle();
					if (row === null || row.parentElement === null) {
						row = adoptRow();
					}
					// Enforce a single row: remove anything another pass may have left.
					for (const extra of document.querySelectorAll("[" + ROW_ATTR + "]")) {
						if (extra !== row) {
							extra.remove();
						}
					}
					let column = null;
					const logo = findLogoRow();
					if (logo !== null && logo.parentElement !== null) {
						const parent = logo.parentElement;
						const before = logo.nextElementSibling;
						if (row.parentElement !== parent || row.nextElementSibling !== before) {
							parent.insertBefore(row, before);
						}
						syncVisibility(logo);
						column = parent;
					} else {
						const button = findNewSessionButton();
						if (button === null || button.parentElement === null) {
							return;
						}
						if (row.parentElement !== button.parentElement || row.nextElementSibling !== button) {
							button.parentElement.insertBefore(row, button);
						}
						syncVisibility(button);
						column = button.parentElement;
					}
					if (column === null) {
						return;
					}
					if (row.dataset.mode === "chat") {
						showChat(column);
					} else {
						showWork();
					}
					syncBadge();
				};

				/** Coalesce DOM churn into one pass per animation frame. */
				const schedule = () => {
					if (frame !== 0) {
						return;
					}
					const raf = typeof requestAnimationFrame === "function"
						? requestAnimationFrame
						: (fn) => setTimeout(fn, 16);
					frame = raf(() => {
						frame = 0;
						try {
							ensure();
						} catch (error) {
							warn("row placement failed", error);
						}
					});
				};

				observer = new MutationObserver((records) => {
					// Our own insertions (row, panel, refreshed rows) must not feed the
					// observer back into another placement pass: that loop rebuilt the
					// history rows on every frame, which made hover paint vanish before
					// it could be seen and swallowed row clicks.
					for (const record of records) {
						const target = record.target;
						if (row !== null && (row === target || row.contains(target))) {
							continue;
						}
						if (panel !== null && (panel === target || panel.contains(target))) {
							continue;
						}
						schedule();
						return;
					}
				});
				observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
				if (typeof window.addEventListener === "function") {
					window.addEventListener("resize", schedule);
				}

				// Fallback hit testing: the sidebar column's own event plumbing may
				// swallow click events aimed at an injected row, so pointer events are
				// captured at the document and mapped back onto this row.
				const insideRow = (target) => {
					if (row === null || target === null || typeof target !== "object") {
						return false;
					}
					try {
						return row.contains(target);
					} catch {
						return false;
					}
				};
				const modeOf = (target) => {
					try {
						const seg = typeof target.closest === "function" ? target.closest("[data-mode]") : null;
						return seg === null ? "" : String(seg.getAttribute("data-mode") || "");
					} catch {
						return "";
					}
				};
				const onPointerUp = (event) => {
					if (!insideRow(event.target)) {
						return;
					}
					if (row !== null && typeof row.dswSwitchTo === "function") {
						row.dswSwitchTo(modeOf(event.target));
					}
				};
				document.addEventListener("pointerup", onPointerUp, true);

				// Same fallback for the history list: the sidebar column may swallow
				// click events aimed at injected content, so pointerup is mapped too.
				const onHistoryPointerUp = (event) => {
					if (panel === null) {
						return;
					}
					const target = event.target;
					let node = null;
					try {
						node = target && typeof target.closest === "function" ? target.closest("[data-session-id]") : null;
					} catch {
						node = null;
					}
					if (node === null) {
						return;
					}
					try {
						if (!panel.contains(node)) {
							return;
						}
					} catch {
						return;
					}
					const id = String(node.getAttribute("data-session-id") || "");
					if (id === "") {
						return;
					}
					const list = Array.isArray(sessions) ? sessions : [];
					for (const session of list) {
						if (String(session.id) === id) {
							openSession(session);
							return;
						}
					}
				};
				document.addEventListener("pointerup", onHistoryPointerUp, true);

				// The shipped sidebar masks :hover for content injected beside its own
				// rows, so the hovered row is resolved from a document-level capture.
				// The class is toggled only when the hovered row changes, which keeps
				// the highlight steady (no per-frame repaint, no flicker).
				let hoveredItem = null;
				const hoverItemAt = (x, y) => {
					if (panel === null) {
						return null;
					}
					let items = [];
					try {
						items = Array.from(panel.querySelectorAll(".dsw-wcs-history-item"));
					} catch {
						items = [];
					}
					for (const item of items) {
						let rect = null;
						try {
							rect = item.getBoundingClientRect();
						} catch {
							rect = null;
						}
						if (rect === null || rect.width === 0) {
							continue;
						}
						if (x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height) {
							return item;
						}
					}
					return null;
				};
				const paintHover = (next) => {
					if (next === hoveredItem) {
						return;
					}
					if (hoveredItem !== null) {
						hoveredItem.classList.remove("dsw-wcs-history-item--hover");
					}
					hoveredItem = next;
					if (hoveredItem !== null) {
						// The stylesheet owns the paint (translucent fill plus an accent
						// bar); setting an inline colour here would silently override it.
						hoveredItem.classList.add("dsw-wcs-history-item--hover");
					}
				};
				const clearHoverPaint = () => paintHover(null);
				const onHoverMove = (event) => {
					const x = Number(event.clientX);
					const y = Number(event.clientY);
					if (!Number.isFinite(x) || !Number.isFinite(y)) {
						return;
					}
					let next = null;
					const target = event.target;
					if (target !== null && target !== undefined && typeof target.closest === "function") {
						try {
							next = target.closest(".dsw-wcs-history-item");
						} catch {
							next = null;
						}
					}
					if (next !== null && panel !== null && !panel.contains(next)) {
						next = null;
					}
					if (next === null) {
						next = hoverItemAt(x, y);
					}
					paintHover(next);
				};
				document.addEventListener("pointermove", onHoverMove, true);
				document.addEventListener("pointerleave", clearHoverPaint, true);

				/** In 对话 mode, "新会话" creates a conversation in 网页对话同步. */
				const startNewChat = (button) => {
					importedSession = "";
					activeWebId = "";
					renderSessions();
					if (row !== null) {
						delete row.dataset.imported;
					}
					syncBadge();
					const dict = dictionary();
					let original = "";
					try {
						original = String(button.textContent || "");
						button.disabled = true;
					} catch {
						/* no-op */
					}
					fetchJson(NEW_CHAT_ROUTE)
						.then(async (payload) => {
							if (!payload || payload.ok === false || !payload.sessionId) {
								throw new Error(String((payload && payload.error) || "unknown"));
							}
							const opened = await openHarnessSession(payload.sessionId);
							if (!opened.ok) {
								warn("open new chat failed", opened.error);
							}
						})
						.catch((error) => {
							warn("new chat failed", error);
							try {
								button.textContent = failureMessage(dict, error, dict.newChatFailed);
							} catch {
								/* no-op */
							}
							setTimeout(() => {
								try {
									button.textContent = original;
									button.disabled = false;
								} catch {
									/* no-op */
								}
							}, 1800);
						});
				};
				const onNewSessionClick = (event) => {
					if (row === null || row.dataset.mode !== "chat") {
						return;
					}
					const target = event.target;
					let button = null;
					try {
						button = target && typeof target.closest === "function" ? target.closest("button") : null;
					} catch {
						button = null;
					}
					if (button === null) {
						let node = target;
						while (node && node !== document.body) {
							if (node.tagName === "BUTTON") {
								button = node;
								break;
							}
							node = node.parentElement;
						}
					}
					if (button === null) {
						return;
					}
					try {
						if (row.contains(button)) {
							return;
						}
					} catch {
						/* no-op */
					}
					let label = "";
					try {
						label = String(button.getAttribute("aria-label") || "") + " " + String(button.textContent || "");
					} catch {
						return;
					}
					if (!NEW_SESSION_LABEL.test(label)) {
						return;
					}
					// The brand button also starts a new session; leave it alone.
					if (/deepseek|harness/i.test(label)) {
						return;
					}
					event.preventDefault();
					event.stopPropagation();
					startNewChat(button);
				};
				document.addEventListener("click", onNewSessionClick, true);
				const onKeyDown = (event) => {
					if (event.key === "Escape") {
						closeModal();
					}
				};
				document.addEventListener("keydown", onKeyDown, true);
				modeListener = schedule;

				schedule();

				return () => {
					modeListener = null;
					stopPoll();
					closeModal();
					if (badge !== null && badge.parentElement !== null) {
						badge.remove();
					}
					badge = null;
					observer.disconnect();
					if (typeof window.removeEventListener === "function") {
						window.removeEventListener("resize", schedule);
					}
					document.removeEventListener("pointerup", onPointerUp, true);
					document.removeEventListener("pointerup", onHistoryPointerUp, true);
					document.removeEventListener("pointermove", onHoverMove, true);
					document.removeEventListener("pointerleave", clearHoverPaint, true);
					paintHover(null);
					document.removeEventListener("click", onNewSessionClick, true);
					document.removeEventListener("keydown", onKeyDown, true);
					if (region !== null && region.style !== undefined) {
						region.style.display = regionDisplay;
					}
					region = null;
					if (panel !== null && panel.parentElement !== null) {
						panel.remove();
					}
					panel = null;
					if (row !== null && row.parentElement !== null) {
						row.remove();
					}
					row = null;
					try {
						if (window[TOKEN_KEY] === INSTANCE) {
							window[TOKEN_KEY] = null;
						}
					} catch {
						/* no-op */
					}
				};
			}, "work-chat-row");
		}

		const module = { exports: {} };
		module.exports = {
			apply,
			inject: ["slots", "locale"]
		};
		return module.exports;
	}
});
