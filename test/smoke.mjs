// Offline smoke test for the sidebar Work/Chat switch client half.
//
// client.js installs a real DOM row into the shipped sidebar flow (there is no
// React seat between the brand row and the New Session button), so this test
// ships a tiny fake DOM: elements, class lists, attributes, event listeners, a
// window with localStorage + listeners, requestAnimationFrame, and a no-op
// MutationObserver. It then asserts placement, labels, state handling, and
// cleanup of the injected row.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, "..", "client.js"), "utf8");

/* ---------------------------------------------------------------- fake DOM */

class FakeElement {
	constructor(tag) {
		this.tagName = String(tag).toUpperCase();
		this.children = [];
		this.parentElement = null;
		this.className = "";
		this.attrs = new Map();
		this.dataset = {};
		this.listeners = {};
		this._text = "";
		this.innerHTML = "";
		this.hidden = false;
		this.style = {};
		this.type = "";
		this.title = "";
		this.classList = {
			add: (name) => {
				if (!this.classList.contains(name)) {
					this.className = (this.className + " " + name).trim();
				}
			},
			remove: (name) => {
				this.className = this.className.split(/\s+/).filter((part) => part !== name).join(" ");
			},
			toggle: (name, force) => {
				const on = force === undefined ? !this.classList.contains(name) : Boolean(force);
				if (on) this.classList.add(name); else this.classList.remove(name);
				return on;
			},
			contains: (name) => this.className.split(/\s+/).includes(name)
		};
	}

	/** Mirrors the browser: setting textContent detaches every child. */
	get textContent() {
		let text = this._text;
		for (const child of this.children) text += child.textContent;
		return text;
	}

	set textContent(value) {
		for (const child of this.children) child.parentElement = null;
		this.children = [];
		this._text = String(value);
	}

	appendChild(child) {
		if (child.parentElement !== null) {
			child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
		}
		child.parentElement = this;
		this.children.push(child);
		return child;
	}

	insertBefore(child, reference) {
		// Real DOM: inserting a node before itself is a no-op.
		if (child === reference) return child;
		if (child.parentElement !== null) {
			child.parentElement.children.splice(child.parentElement.children.indexOf(child), 1);
		}
		const index = reference === null ? -1 : this.children.indexOf(reference);
		child.parentElement = this;
		if (index === -1) {
			this.children.push(child);
		} else {
			this.children.splice(index, 0, child);
		}
		return child;
	}

	remove() {
		if (this.parentElement === null) return;
		const index = this.parentElement.children.indexOf(this);
		if (index >= 0) this.parentElement.children.splice(index, 1);
		this.parentElement = null;
	}

	get nextElementSibling() {
		if (this.parentElement === null) return null;
		const index = this.parentElement.children.indexOf(this);
		return this.parentElement.children[index + 1] || null;
	}

	setAttribute(name, value) { this.attrs.set(String(name), String(value)); }
	getAttribute(name) { return this.attrs.has(String(name)) ? this.attrs.get(String(name)) : null; }

	addEventListener(type, listener) {
		(this.listeners[type] = this.listeners[type] || []).push(listener);
	}

	dispatch(type, event = { stopPropagation() {}, preventDefault() {} }) {
		for (const listener of this.listeners[type] || []) listener(event);
	}

	click() { this.dispatch("click"); }

	getBoundingClientRect() { return this.rect || { width: 220, height: 32, top: 0, left: 0 }; }

	querySelectorAll(selector) {
		const matches = [];
		const walk = (node) => {
			for (const child of node.children) {
				if (matchesSelector(child, selector)) matches.push(child);
				walk(child);
			}
		};
		walk(this);
		return matches;
	}

	querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function matchesSelector(node, selector) {
	if (selector.startsWith(".")) return node.classList.contains(selector.slice(1));
	const attr = /^\[([^\]=]+)(?:="?([^"\]]*)"?)?\]$/.exec(selector);
	if (attr !== null) {
		const value = node.getAttribute(attr[1]);
		return value !== null && (attr[2] === undefined || value === attr[2]);
	}
	return node.tagName === selector.toUpperCase();
}

const head = new FakeElement("head");
const body = new FakeElement("body");
const storage = new Map();
const windowListeners = {};
const documentListeners = {};

const documentStub = {
	documentElement: { lang: "zh-CN" },
	head,
	body,
	createElement: (tag) => new FakeElement(tag),
	addEventListener: (type, listener) => {
		(documentListeners[type] = documentListeners[type] || []).push(listener);
	},
	removeEventListener: (type, listener) => {
		documentListeners[type] = (documentListeners[type] || []).filter((entry) => entry !== listener);
	},
	querySelector: (selector) => {
		// The style guard queries an injected <style> tag; nothing is there before apply.
		if (selector.startsWith("style[")) return null;
		return body.querySelector(selector);
	},
	querySelectorAll: (selector) => body.querySelectorAll(selector)
};

const windowStub = {
	__ModuleLoader__: { load: (registration) => { windowStub.loaded = registration; } },
	localStorage: {
		getItem: (key) => (storage.has(key) ? storage.get(key) : null),
		setItem: (key, value) => storage.set(key, String(value))
	},
	dispatchEvent: () => true,
	addEventListener: (type, listener) => { (windowListeners[type] = windowListeners[type] || []).push(listener); },
	removeEventListener: (type, listener) => {
		windowListeners[type] = (windowListeners[type] || []).filter((entry) => entry !== listener);
	}
};

class FakeMutationObserver {
	constructor(callback) { this.callback = callback; }
	observe() {}
	disconnect() {}
}

globalThis.window = windowStub;
globalThis.document = documentStub;
globalThis.MutationObserver = FakeMutationObserver;
globalThis.requestAnimationFrame = (fn) => { fn(); return 0; };
globalThis.CustomEvent = class CustomEvent {
	constructor(type, init) { this.type = type; this.detail = init?.detail; }
};
Object.defineProperty(globalThis, "navigator", {
	value: { language: "zh-CN" },
	configurable: true,
	writable: true
});

// The plugin reads its data from its own Host routes; this stub answers them.
const nowSeconds = () => Date.now() / 1000;
const fetchCalls = [];
/** "" | "expired": makes the sessions route report a broken web sign-in. */
let tokenFailure = "";
globalThis.fetch = async (url, options) => {
	const path = String(url);
	fetchCalls.push(path);
	const reply = (payload) => ({
		ok: true,
		status: 200,
		text: async () => JSON.stringify(payload),
		json: async () => payload
	});
	const fail = (status, payload) => ({
		ok: false,
		status,
		text: async () => JSON.stringify(payload),
		json: async () => payload
	});
	if (path.includes("/api/wcs/token")) {
		const method = String((options && options.method) || "GET").toUpperCase();
		if (method === "POST") {
			tokenFailure = "";
			return reply({ ok: true, source: "auto", length: 64 });
		}
		return reply({ ok: true, hasToken: tokenFailure === "", length: tokenFailure === "" ? 64 : 0 });
	}
	if (path.includes("/api/wcs/open")) {
		return reply({ ok: true, sessionId: "session-test", created: true });
	}
	if (path.includes("/api/wcs/sessions")) {
		if (tokenFailure === "expired") {
			return fail(401, { ok: false, error: "网页版登录已失效", tokenInvalid: true });
		}
		if (path.includes("beforeUpdatedAt")) {
			return reply({
				ok: true,
				sessions: [{ id: "s3", title: "更早的对话", pinned: false, updatedAt: nowSeconds() - 3 * 86400 }],
				hasMore: false,
				cursor: null
			});
		}
		return reply({
			ok: true,
			sessions: [
				{ id: "s1", title: "示例对话", pinned: true, updatedAt: nowSeconds() },
				{ id: "s2", title: "昨天的对话", pinned: false, updatedAt: nowSeconds() - 86400 }
			],
			hasMore: true,
			cursor: { pinned: false, updatedAt: nowSeconds() - 86400 }
		});
	}
	if (path.includes("/api/wcs/messages")) {
		return reply({
			ok: true,
			session: { id: "s1", title: "示例对话" },
			messages: [{ role: "USER", text: "你好" }, { role: "ASSISTANT", text: "你好，有什么可以帮你？" }]
		});
	}
	return reply({
		ok: true,
		sessions: [
			{ id: "s1", title: "示例对话", pinned: true, updatedAt: nowSeconds() },
			{ id: "s2", title: "昨天的对话", pinned: false, updatedAt: nowSeconds() - 86400 }
		],
		hasMore: false
	});
};

/* ------------------------------------------------------- shipped-like scene */

const container = documentStub.createElement("div");
container.className = "sidebarColumn";
const brandRow = documentStub.createElement("div");
brandRow.className = "brand";
const brandName = documentStub.createElement("span");
brandName.textContent = "deepseek HARNESS";
brandRow.appendChild(brandName);
const newSession = documentStub.createElement("button");
newSession.setAttribute("aria-label", "新会话");
const newSessionIcon = documentStub.createElement("svg");
newSession.appendChild(newSessionIcon);
const panelList = documentStub.createElement("nav");
const regionArea = documentStub.createElement("div");
regionArea.className = "wcs-test-region";
regionArea.textContent = "工作区";
container.appendChild(brandRow);
container.appendChild(newSession);
container.appendChild(panelList);
container.appendChild(regionArea);
body.appendChild(container);

/* --------------------------------------------------------------- load bundle */

new Function("window", "document", "navigator", "CustomEvent", "MutationObserver", "requestAnimationFrame", source)(
	windowStub, documentStub, globalThis.navigator, globalThis.CustomEvent, FakeMutationObserver, globalThis.requestAnimationFrame
);

const loaded = windowStub.loaded;
if (loaded === undefined) throw new Error("bundle never called window.__ModuleLoader__.load");

// The bundle registers itself under the package name; the development copy is
// `@local/...` while the published package uses the bare npm name.
const packageName = JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).name;
if (loaded.id !== packageName) throw new Error("unexpected module id: " + loaded.id + " (expected " + packageName + ")");

const exportsObj = loaded.factory(() => { throw new Error("client half must not require() anything"); });

const disposers = [];
const ctx = {
	effect: (run) => {
		const cleanup = run();
		disposers.push(cleanup);
		return cleanup;
	}
};

exportsObj.apply(ctx);

/* ------------------------------------------------------------------ checks */

const rows = body.querySelectorAll(".dsw-wcs-row");
const row = rows[0] || null;
const segments = row === null ? [] : row.querySelectorAll(".dsw-wcs-segment");
const labels = row === null ? [] : row.querySelectorAll(".dsw-wcs-label").map((node) => node.textContent);
const storedMode = () => (storage.has("dsh.sidebarWorkChatSwitch.mode") ? storage.get("dsh.sidebarWorkChatSwitch.mode") : null);

const checks = [
	["module id", loaded.id === packageName],
	["bundle exports apply", typeof exportsObj.apply === "function"],
	["style tag appended", head.querySelectorAll("style").length === 1 && String(head.children[0].textContent).includes(".dsw-wcs-root")],
	["one row inserted", rows.length === 1],
	["row sits in sidebar column", row !== null && row.parentElement === container],
	["row sits right before New Session", row !== null && container.children.indexOf(row) === container.children.indexOf(newSession) - 1],
	["brand row untouched", brandRow.children.length === 1 && brandName.textContent === "deepseek HARNESS" && row !== null && row.parentElement !== brandRow],
	["two segments", segments.length === 2],
	["chinese labels", labels.join("|") === "工作|对话"],
	["group role + aria label", row !== null && row.querySelectorAll(".dsw-wcs-root")[0].getAttribute("role") === "group" && row.querySelectorAll(".dsw-wcs-root")[0].getAttribute("aria-label") === "侧栏模式"],
	["work active by default", segments.length === 2 && segments[0].classList.contains("dsw-wcs-segment--active") && segments[0].getAttribute("aria-pressed") === "true"],
	["chat inactive by default", segments.length === 2 && !segments[1].classList.contains("dsw-wcs-segment--active") && segments[1].getAttribute("aria-pressed") === "false"],
	["two icons rendered", row !== null && row.querySelectorAll(".dsw-wcs-icon").length === 2],
	["click chat switches mode", (() => {
		if (segments.length !== 2) return false;
		segments[1].click();
		return segments[1].classList.contains("dsw-wcs-segment--active") &&
			segments[0].getAttribute("aria-pressed") === "false" &&
			storedMode() === "chat";
	})()],
	["narrow sidebar hides row", (() => {
		if (row === null) return false;
		newSession.getBoundingClientRect = () => ({ width: 56, height: 32, top: 0, left: 0 });
		for (const listener of windowListeners.resize || []) listener();
		return row.hidden === true;
	})()],
	["row is restored when removed", (() => {
		if (row === null) return false;
		row.remove();
		newSession.getBoundingClientRect = () => ({ width: 220, height: 32, top: 0, left: 0 });
		for (const listener of windowListeners.resize || []) listener();
		const restored = body.querySelectorAll(".dsw-wcs-row");
		return restored.length === 1 && restored[0].parentElement === container;
	})()]
];

/* -------------------------------------- chat mode: the web history panel */

// Switching to 对话 replaces the shipped 工作区 region with the web history list.
const liveRow = body.querySelectorAll(".dsw-wcs-row")[0];
const liveSegs = liveRow.querySelectorAll(".dsw-wcs-segment");
storage.set("dsh.sidebarWorkChatSwitch.mode", "work");
liveSegs[0].click();
await new Promise((resolve) => setTimeout(resolve, 25));
liveSegs[1].click();
await new Promise((resolve) => setTimeout(resolve, 25));
const firstItem = body.querySelectorAll(".dsw-wcs-history-item")[0];
if (firstItem !== undefined) firstItem.click();
await new Promise((resolve) => setTimeout(resolve, 25));
checks.push(
	["chat mode injects the history panel", body.querySelectorAll(".dsw-wcs-history").length === 1],
	["history list rendered from the host route", body.querySelectorAll(".dsw-wcs-history-item").length === 2],
	["history grouped like the web app", body.querySelectorAll(".dsw-wcs-history-group").map((node) => node.textContent).join("|") === "置顶|昨天"],
	["chat mode hides the shipped 工作区 region", regionArea.style.display === "none"],
	["history panel takes the region's place", (() => {
		const panels = body.querySelectorAll(".dsw-wcs-history");
		return panels.length === 1 && panels[0].parentElement === container &&
			container.children.indexOf(panels[0]) === container.children.indexOf(regionArea) - 1;
	})()],
	["opening a history item asks the host to seed a session", fetchCalls.some((url) => url.includes("/api/wcs/open?id=") || url.includes("/api/wcs/open%3Fid"))],
	["selected history item stays highlighted", body.querySelectorAll(".dsw-wcs-history-item--active").length === 1],
	["history panel offers markdown export", body.querySelectorAll(".dsw-wcs-history-export").length === 1],
	["opened conversation shows the continue hint beside the composer", body.querySelectorAll(".dsw-wcs-continue-badge").length === 1]
);
liveSegs[0].click();
await new Promise((resolve) => setTimeout(resolve, 25));
checks.push(
	["work mode restores the 工作区 region", regionArea.style.display !== "none"],
	["work mode hides the history panel", (() => {
		const panels = body.querySelectorAll(".dsw-wcs-history");
		return panels.length === 1 && panels[0].hidden === true;
	})()]
);

/* ------------------------------------------- pagination: append on scroll end */

liveSegs[1].click();
await new Promise((resolve) => setTimeout(resolve, 30));
const livePanel = body.querySelectorAll(".dsw-wcs-history")[0];
const liveList = livePanel.querySelector(".dsw-wcs-history-list");
const moreBefore = body.querySelectorAll(".dsw-wcs-history-more");
liveList.scrollTop = 1000;
liveList.scrollHeight = 1200;
liveList.clientHeight = 200;
liveList.dispatch("scroll");
await new Promise((resolve) => setTimeout(resolve, 40));
const moreAfter = body.querySelectorAll(".dsw-wcs-history-more");
checks.push(
	["list shows a load-more hint while more pages exist", moreBefore.length === 1 && moreBefore[0].textContent.includes("继续向下滚动加载更多")],
	["scrolling to the bottom requests the next page", fetchCalls.some((url) => url.includes("beforeUpdatedAt="))],
	["the next page merges into the list", body.querySelectorAll(".dsw-wcs-history-item").length === 3],
	["the load-more hint disappears on the last page", moreAfter.length === 0]
);

/* --------------------------------------- hover / selection styling parity */

// Hover and selection must always paint a visible highlight, and the hovered row
// is resolved from a document-level capture because the shipped sidebar masks
// :hover on injected content.
const styleTag = documentStub.head.children.find((node) => node.dataset !== undefined && String(node.dataset.pluginCss || "") !== "");
checks.push([
	"hover and selection paint a deterministic translucent highlight",
	String(styleTag === undefined ? "" : styleTag.textContent).includes(
		".dsw-wcs-history-item:hover,.dsw-wcs-history-item--hover,.dsw-wcs-history-item--active{background:rgba(255,255,255,.16);"
	)
]);
const hoverItems = body.querySelectorAll(".dsw-wcs-history-item");
for (let index = 0; index < hoverItems.length; index += 1) {
	hoverItems[index].rect = { left: 0, top: index * 40, width: 200, height: 24 };
}
checks.push(["pointermove hover capture is installed", (documentListeners.pointermove || []).length > 0]);
for (const listener of documentListeners.pointermove || []) listener({ clientX: 20, clientY: 10 });
checks.push(["pointermove highlights the hovered history item", (() => {
	const hovered = body.querySelectorAll(".dsw-wcs-history-item--hover");
	return hovered.length === 1 && hovered[0] === hoverItems[0];
})()]);
for (const listener of documentListeners.pointermove || []) listener({ clientX: 20, clientY: 400 });
checks.push(["moving the pointer away clears the hover highlight", body.querySelectorAll(".dsw-wcs-history-item--hover").length === 0]);

/* ------------------------------------------- scenario 2: window-drag brand row */

// The live sidebar marks its brand row as a window-drag header; that is the
// primary anchor, with the New Session button only as a fallback.
body.children = [];
const container2 = documentStub.createElement("div");
container2.className = "sidebarColumn";
const brandRow2 = documentStub.createElement("div");
brandRow2.className = "brand";
brandRow2.setAttribute("data-window-drag", "");
const brandName2 = documentStub.createElement("span");
brandName2.textContent = "deepseek HARNESS";
brandRow2.appendChild(brandName2);
const newSession2 = documentStub.createElement("button");
newSession2.setAttribute("aria-label", "新会话");
newSession2.textContent = "新会话";
newSession2.appendChild(documentStub.createElement("svg"));
const nav2 = documentStub.createElement("nav");
container2.appendChild(brandRow2);
container2.appendChild(newSession2);
container2.appendChild(nav2);
body.appendChild(container2);

const disposers2 = [];
exportsObj.apply({
	effect: (run) => {
		const cleanup = run();
		disposers2.push(cleanup);
		return cleanup;
	}
});
const row2 = body.querySelectorAll(".dsw-wcs-row")[0] || null;

checks.push(
	["drag-mark anchor: row inserted", row2 !== null],
	["drag-mark anchor: row right after brand row", row2 !== null && container2.children.indexOf(row2) === container2.children.indexOf(brandRow2) + 1],
	["drag-mark anchor: row right before New Session", row2 !== null && container2.children.indexOf(row2) === container2.children.indexOf(newSession2) - 1],
	["drag-mark anchor: brand row untouched", brandRow2.children.length === 1 && brandName2.textContent === "deepseek HARNESS"],
	["drag-mark anchor: labels localized", row2 !== null && row2.querySelectorAll(".dsw-wcs-label").map((node) => node.textContent).join("|") === "工作|对话"]
);

/* --------------------------------- scenario 3: a hot reload applies a new instance */

// Hot reload disposes the previous instance and applies a fresh one. The new
// instance must take over the DOM without leaving a second row behind.
const disposers3 = [];
exportsObj.apply({
	effect: (run) => {
		const cleanup = run();
		disposers3.push(cleanup);
		return cleanup;
	}
});
checks.push(
	["hot reload keeps exactly one row", body.querySelectorAll(".dsw-wcs-row").length === 1],
	["hot reload row still after brand row", (() => {
		const live = body.querySelectorAll(".dsw-wcs-row");
		return live.length === 1 && container2.children.indexOf(live[0]) === container2.children.indexOf(brandRow2) + 1;
	})()],
	["hot reload row still interactive", (() => {
		const live = body.querySelectorAll(".dsw-wcs-row");
		if (live.length !== 1) return false;
		const segs = live[0].querySelectorAll(".dsw-wcs-segment");
		segs[0].click();
		return segs[0].classList.contains("dsw-wcs-segment--active") && storage.get("dsh.sidebarWorkChatSwitch.mode") === "work";
	})()]
);

/* ------------- scenario 4: a broken web sign-in shows the guided connect card */

// A fresh install (or an expired login) must not leave the user with a dead
// list: the panel offers automatic detection plus a one-line manual paste.
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
body.children = [];
const container4 = documentStub.createElement("div");
container4.className = "sidebarColumn";
const brandRow4 = documentStub.createElement("div");
brandRow4.className = "brand";
brandRow4.setAttribute("data-window-drag", "");
const brandName4 = documentStub.createElement("span");
brandName4.textContent = "deepseek HARNESS";
brandRow4.appendChild(brandName4);
const newSession4 = documentStub.createElement("button");
newSession4.setAttribute("aria-label", "新会话");
newSession4.textContent = "新会话";
newSession4.appendChild(documentStub.createElement("svg"));
const region4 = documentStub.createElement("div");
region4.className = "wcs-test-region";
region4.textContent = "工作区";
container4.appendChild(brandRow4);
container4.appendChild(newSession4);
container4.appendChild(region4);
body.appendChild(container4);
storage.set("dsh.sidebarWorkChatSwitch.mode", "chat");
tokenFailure = "expired";

const disposers4 = [];
exportsObj.apply({
	effect: (run) => {
		const cleanup = run();
		disposers4.push(cleanup);
		return cleanup;
	}
});
await wait(30);
const card = body.querySelectorAll("[data-dsw-wcs-connect]")[0] || null;
const cardActions = card === null ? [] : card.querySelectorAll(".dsw-wcs-connect-action");
checks.push(
	["token problem renders the connect card", card !== null && card.getAttribute("data-dsw-wcs-connect") === "expired"],
	["connect card offers auto detection and manual paste", cardActions.length >= 3 && body.querySelectorAll(".dsw-wcs-connect-input").length === 1]
);
const autoButton = card === null ? null : card.querySelectorAll(".dsw-wcs-connect-action--primary")[0] || null;
if (autoButton !== null) {
	autoButton.click();
}
await wait(60);
checks.push(
	["automatic detection clears the card and loads the list", body.querySelectorAll("[data-dsw-wcs-connect]").length === 0 && body.querySelectorAll(".dsw-wcs-history-item").length >= 2]
);

/* ------------------------------------------------ cleanup of every instance */

for (const dispose of [...disposers, ...disposers2, ...disposers3, ...disposers4]) {
	if (typeof dispose === "function") dispose();
}
checks.push(
	["cleanup removes every row", body.querySelectorAll(".dsw-wcs-row").length === 0],
	["cleanup removes the history panel", body.querySelectorAll(".dsw-wcs-history").length === 0],
	["cleanup restores the 工作区 region", regionArea.style.display !== "none"],
	["cleanup restores the second 工作区 region", region4.style.display !== "none"],
	["cleanup leaves no hover repaint listeners", (documentListeners.pointermove || []).length === 0]
);

let failed = 0;
for (const [name, ok] of checks) {
	console.log((ok ? "PASS" : "FAIL") + "  " + name);
	if (!ok) failed += 1;
}
process.exitCode = failed === 0 ? 0 : 1;
console.log(failed === 0 ? "\nall checks passed" : "\n" + failed + " check(s) failed");
