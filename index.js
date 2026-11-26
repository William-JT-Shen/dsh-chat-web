/**
 * Host half of the sidebar Work/Chat switch bundle.
 *
 * The Client half (`client.js`) renders the sidebar mode switch and the web-chat
 * history panel. This Host half owns the network side: it reads the user's
 * chat.deepseek.com token from the data directory (`deepseek-web-token.txt`),
 * fetches the web chat history (list + per-session messages) and publishes it to
 * the Client half through two authenticated data routes registered on the Host
 * connection service. The token value itself never leaves this module.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectBrowserToken,
  normaliseToken,
  readStoredTokenFile,
  writeStoredTokenFile,
} from "./token-store.mjs";

/** Diagnostics marker; bump when the Host behaviour changes. */
const MARK = "sync-v2";
/** DeepSeek web origin. */
const ORIGIN = "https://chat.deepseek.com";
const BUNDLE_DIR = dirname(fileURLToPath(import.meta.url));
/** Development layout: `web-chat-sync` sits next to the bundle directory. */
const LEGACY_DATA_DIR = resolve(BUNDLE_DIR, "..", "web-chat-sync");
/**
 * Data home (token, cache, imported transcripts, diagnostics). A published
 * package must never write inside `node_modules`, so the default is a folder in
 * the user's DSH home; `DSH_WCS_DATA_DIR` overrides it explicitly, and the
 * legacy sibling folder still wins when it already exists (development copy).
 */
const USER_DATA_DIR = resolve(
  process.env.DSH_HOME || resolve(process.env.USERPROFILE || process.env.HOME || ".", ".dsh"),
  "web-chat-sync",
);
const DATA_DIR = resolve(
  process.env.DSH_WCS_DATA_DIR || (existsSync(LEGACY_DATA_DIR) ? LEGACY_DATA_DIR : USER_DATA_DIR),
);
const OUT_DIR = resolve(DATA_DIR, "diagnostics");
const TOKEN_FILE = resolve(DATA_DIR, "deepseek-web-token.txt");
const CACHE_FILE = resolve(DATA_DIR, "cache.json");
/** Data routes consumed by the Client half (document-relative form). */
const SESSIONS_ROUTE = "/api/wcs/sessions";
const MESSAGES_ROUTE = "/api/wcs/messages";
const CONTINUE_ROUTE = "/api/wcs/continue";
const NEW_CHAT_ROUTE = "/api/wcs/new-chat";
const EXPORT_ROUTE = "/api/wcs/export";
/** Opens (and, the first time, seeds) the Harness twin of one web chat. */
const OPEN_ROUTE = "/api/wcs/open";
/** Read / save / auto-detect the chat.deepseek.com token. */
const TOKEN_ROUTE = "/api/wcs/token";
/** Stored session-log format version understood by this release. */
const SESSION_FORMAT_VERSION = 4;
/**
 * Version of the transcript rendering written into imported session logs.
 * 1: THINK fragments were flattened into the visible message text.
 * 2: THINK fragments become collapsed `reasoning` parts (web-page-like).
 */
const IMPORTED_FORMAT = 2;
/** Harness workspace that owns the imported web conversations. */
const WORKSPACE_TITLE = "网页对话同步";
const MAP_FILE = resolve(DATA_DIR, "sessions-map.json");
const IMPORTED_DIR = resolve(DATA_DIR, "imported");
/** Upper bound on transcript characters seeded into a Harness session. */
const SEED_LIMIT = 60000;

/** Headers the DeepSeek web app sends along with its API calls. */
const WEB_HEADERS = {
  "x-app-version": "20241129.1",
  "x-client-platform": "web",
  "x-client-version": "1.0.0",
  "x-client-locale": "zh_CN",
  "x-client-bundle-id": "com.deepseek.chat",
  origin: ORIGIN,
  referer: `${ORIGIN}/`,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

function writeReport(name, payload) {
  try {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(resolve(OUT_DIR, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  } catch {
    /* diagnostics must never break the Host half */
  }
}

function failureText(error) {
  return String((error && error.message) || error);
}

/** True when chat.deepseek.com rejected the token (signed out or expired). */
function tokenRejected(result) {
  if (!result || typeof result !== "object") {
    return false;
  }
  return result.status === 401 || result.code === 40003;
}

/**
 * The one response every data route uses when the web token no longer works,
 * so the Client can show a single actionable message instead of a raw code.
 */
function tokenExpiredPayload() {
  return {
    ok: false,
    tokenInvalid: true,
    error: `网页版登录已失效，请更新 ${TOKEN_FILE} 中的 token`,
  };
}

/** The one response every data route uses when the web token no longer works. */
function tokenExpiredResponse() {
  return jsonResponse(401, tokenExpiredPayload());
}

/** The one response used when no token file value exists at all. */
function tokenMissingResponse() {
  return jsonResponse(401, {
    ok: false,
    tokenInvalid: true,
    tokenMissing: true,
    error: `还没有配置网页版 token：请把 token 放进 ${TOKEN_FILE}`,
  });
}

/** Reads the stored web token. Returns "" when unavailable. */
function readToken() {
  return readStoredTokenFile(TOKEN_FILE);
}

function headersFor(token) {
  return { ...WEB_HEADERS, authorization: `Bearer ${token}` };
}

/** JSON response helper for the data routes. */
function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** Fetch a DeepSeek web endpoint and decode its JSON envelope. */
async function fetchJson(url, token) {
  const response = await fetch(url, {
    method: "GET",
    headers: headersFor(token),
    signal: AbortSignal.timeout(25000),
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: response.status, body, textLength: text.length };
}

function bizData(body) {
  const data = body && typeof body === "object" ? body.data : undefined;
  return data && typeof data === "object" ? data.biz_data : undefined;
}

/** Validate one candidate token against the real web API (cheap list call). */
async function validateToken(token) {
  const value = normaliseToken(token);
  if (value === "") {
    return { ok: false, status: 0, code: null };
  }
  try {
    const result = await fetchJson(`${ORIGIN}/api/v0/chat_session/fetch_page?count=1`, value);
    const code = result.body && typeof result.body.code === "number" ? result.body.code : null;
    return { ok: result.status === 200 && code === 0, status: result.status, code };
  } catch {
    return { ok: false, status: 0, code: null };
  }
}

/** Persist a token the user pasted or that discovery found. */
function writeTokenValue(token) {
  const value = normaliseToken(token);
  if (value === "" || !writeStoredTokenFile(TOKEN_FILE, value)) {
    return false;
  }
  writeReport("token.json", {
    mark: MARK,
    at: new Date().toISOString(),
    length: value.length,
  });
  return true;
}

/** Try to recover the session from the local browsers; saves it on success. */
async function autoDetectToken() {
  try {
    const found = await detectBrowserToken(async (candidate) => {
      const checked = await validateToken(candidate);
      return checked.ok;
    });
    if (!found) {
      writeReport("auto-token.json", {
        mark: MARK,
        at: new Date().toISOString(),
        found: false,
      });
      return null;
    }
    const saved = writeTokenValue(found.token);
    writeReport("auto-token.json", {
      mark: MARK,
      at: new Date().toISOString(),
      found: true,
      saved,
      source: found.source,
      scanned: found.scanned,
      tried: found.tried,
      length: found.token.length,
    });
    return saved ? found : null;
  } catch (error) {
    writeReport("auto-token.json", {
      mark: MARK,
      at: new Date().toISOString(),
      found: false,
      error: failureText(error),
    });
    return null;
  }
}

/** Render a web conversation as Markdown, keeping thinking collapsible. */
function markdownFor(title, messages) {
  const lines = [`# ${title || "网页对话"}`, ""];
  for (const message of messages) {
    const who = message.role === "USER" ? "我" : "DeepSeek";
    lines.push(`## ${who}`, "");
    const think = String(message.think || "").trim();
    if (think !== "") {
      lines.push("<details>", "<summary>思考过程</summary>", "", think, "", "</details>", "");
    }
    const text = String(message.text || "").trim();
    if (text !== "") {
      lines.push(text, "");
    }
  }
  return lines.join("\n");
}

function safeFileName(title) {
  const cleaned = String(title || "网页对话")
    .replace(/[\\/:*?"<>|\r\n]+/g, "_")
    .trim();
  return (cleaned === "" ? "网页对话" : cleaned).slice(0, 60);
}

/**
 * Load one page of the web chat session list (pinned first, then most recent).
 * `cursor` follows the web app's own protocol: the server pages with
 * `lte_cursor.pinned` / `lte_cursor.updated_at` anchored on the last item the
 * caller already has, and the anchor row itself is included again.
 */
async function loadSessions(token, options) {
  const count = Math.max(1, Math.min(50, Number((options && options.count) || 20)));
  const cursor = options && options.cursor;
  const params = new URLSearchParams();
  params.set("count", String(count));
  if (cursor && typeof cursor.updatedAt === "number") {
    params.set("lte_cursor.pinned", cursor.pinned === true ? "true" : "false");
    params.set("lte_cursor.updated_at", String(cursor.updatedAt));
  }
  const result = await fetchJson(`${ORIGIN}/api/v0/chat_session/fetch_page?${params.toString()}`, token);
  const biz = bizData(result.body);
  const raw = biz && Array.isArray(biz.chat_sessions) ? biz.chat_sessions : [];
  const sessions = raw.map((session) => ({
    id: typeof session.id === "string" ? session.id : "",
    title: typeof session.title === "string" ? session.title : "",
    pinned: session.pinned === true,
    modelType: session.model_type ?? null,
    updatedAt: typeof session.updated_at === "number" ? session.updated_at : null,
  }));
  const last = sessions.length > 0 ? sessions[sessions.length - 1] : null;
  return {
    status: result.status,
    code: result.body ? result.body.code : null,
    sessions,
    hasMore: Boolean(biz && biz.has_more),
    cursor: last !== null && typeof last.updatedAt === "number" ? { pinned: last.pinned, updatedAt: last.updatedAt } : null,
  };
}

/** Load one web chat session's full message history. */
async function loadMessages(token, sessionId) {
  const result = await fetchJson(
    `${ORIGIN}/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(sessionId)}`,
    token,
  );
  const biz = bizData(result.body);
  const raw = biz && Array.isArray(biz.chat_messages) ? biz.chat_messages : [];
  const session = biz && typeof biz === "object" && biz.chat_session && typeof biz.chat_session === "object"
    ? {
        id: typeof biz.chat_session.id === "string" ? biz.chat_session.id : sessionId,
        title: typeof biz.chat_session.title === "string" ? biz.chat_session.title : "",
      }
    : { id: sessionId, title: "" };
  const messages = raw.map((message) => {
    const fragments = Array.isArray(message.fragments) ? message.fragments : [];
    const typed = fragments.filter((fragment) => fragment && typeof fragment === "object");
    const byType = (wanted) => typed
      .filter((fragment) => String(fragment.type || "").toUpperCase() === wanted)
      .map((fragment) => String(fragment.content ?? ""))
      .join("")
      .trim();
    // THINK fragments are the web page's collapsed reasoning; RESPONSE is the
    // visible answer and REQUEST is the user's own text. TIP/FILE carry no
    // transcript body.
    const text = [byType("RESPONSE"), byType("REQUEST")].filter(Boolean).join("\n\n").trim();
    const think = byType("THINK");
    return {
      role: typeof message.role === "string" ? message.role : "",
      text,
      think,
      insertedAt: typeof message.inserted_at === "number" ? message.inserted_at : null,
    };
  });
  return { status: result.status, code: result.body ? result.body.code : null, session, messages };
}

/** Web session id → Harness session id, so "继续聊" never duplicates a chat. */
function readMap() {
  try {
    const parsed = JSON.parse(readFileSync(MAP_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  } catch {
    /* mapping is best effort */
  }
}

function serviceOf(inner, name) {
  try {
    if (inner && typeof inner.get === "function") {
      return inner.get(name);
    }
    return inner ? inner[name] : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve (or create) the Harness workspace that holds imported chats. */
async function ensureWorkspace(registry) {
  if (!registry) {
    return null;
  }
  try {
    if (typeof registry.resolveByPath === "function") {
      const found = await registry.resolveByPath(DATA_DIR);
      if (found) {
        writeReport("workspace.json", { mark: MARK, at: new Date().toISOString(), stage: "resolved", id: found.id || null });
        return typeof found === "string" ? found : found.id || found.workspaceId || null;
      }
    }
    if (typeof registry.create === "function") {
      const created = await registry.create(DATA_DIR, WORKSPACE_TITLE);
      writeReport("workspace.json", {
        mark: MARK,
        at: new Date().toISOString(),
        stage: "created",
        id: created && (created.id || created.workspaceId) || null,
        keys: created && typeof created === "object" ? Object.keys(created) : [],
      });
      return typeof created === "string" ? created : (created && (created.id || created.workspaceId)) || null;
    }
  } catch (error) {
    writeReport("workspace.json", { mark: MARK, at: new Date().toISOString(), stage: "error", error: failureText(error) });
  }
  return null;
}

/** Create a fresh Harness session in the imported-chat workspace. */
async function createHarnessSession(controller, workspaceId) {
  const request = workspaceId ? { workspaceId } : { cwd: DATA_DIR };
  const created = await controller.create(request);
  const sessionId = typeof created === "string"
    ? created
    : created && (created.sessionId || created.id || created.session || null);
  return typeof sessionId === "string" ? sessionId : null;
}

/** Render the web transcript into the context text seeded into a session. */
function buildSeedText(title, messages) {
  const lines = [];
  for (const message of messages) {
    const text = String((message && message.text) || "").trim();
    if (!text) continue;
    const role = String(message.role || "").toUpperCase() === "USER" ? "我" : "DeepSeek";
    lines.push(`${role}：${text}`);
  }
  let transcript = lines.join("\n\n");
  if (transcript.length > SEED_LIMIT) {
    transcript = `…（更早的内容已省略）\n\n${transcript.slice(transcript.length - SEED_LIMIT)}`;
  }
  return [
    `以下是我和 DeepSeek 网页版之间已有的对话记录（标题：${title || "未命名对话"}）。`,
    "请把它当作我们已经发生过的上下文，不需要复述、总结或评价；等我提出下一个问题时直接接着聊。",
    "",
    "----- 既有对话记录开始 -----",
    transcript,
    "----- 既有对话记录结束 -----",
  ].join("\n");
}

/**
 * Rebuilds a DeepSeek web transcript as a contiguous Harness session event log.
 *
 * The stored session log is the UI's source of truth: writing real
 * `user/message` + `assistant/message` events makes the imported conversation
 * render exactly like a local one (and keeps it resumable afterwards).
 */
function seedEvents(messages) {
  const events = [];
  let seq = 0;
  let turn = 0;
  let step = 1;
  let open = false;
  const time = () => Date.now();
  const push = (type, data, surfaceOp) => {
    const event = { type, seq: seq++, time: time(), data };
    if (surfaceOp) event.surfaceOp = surfaceOp;
    events.push(event);
  };
  const startTurn = () => {
    turn += 1;
    step = 1;
    push("turn/start", { turn });
    push("step/start", { turn, step });
    open = true;
  };
  const endTurn = () => {
    push("step/end", { turn, step });
    push("turn/end", { turn, reason: { kind: "completed" } });
    open = false;
  };
  for (const message of Array.isArray(messages) ? messages : []) {
    const text = String((message && message.text) || "").trim();
    const think = String((message && message.think) || "").trim();
    if (!text && !think) continue;
    const role = String((message && message.role) || "").toUpperCase();
    if (role === "USER") {
      if (!text) continue;
      if (open) endTurn();
      startTurn();
      push("user/message", {
        content: [{ type: "text", text }],
        source: { kind: "user" },
        role: "user",
        id: randomUUID(),
      }, "append");
    } else if (role === "ASSISTANT") {
      if (!open) startTurn();
      // The web page stores its collapsed reasoning as THINK fragments; the
      // Harness transcript renders `reasoning` parts as the same collapsed
      // "思考过程" disclosure, so keep the two channels apart.
      const content = [];
      if (think) content.push({ type: "reasoning", text: think });
      if (text) content.push({ type: "text", text });
      push("assistant/message", {
        turn,
        step,
        message: {
          role: "assistant",
          content,
          source: { kind: "model", provider: "deepseek-account", model: "deepseek-flash" },
          id: randomUUID(),
        },
        stream: [],
      }, "append");
    }
  }
  if (open) endTurn();
  // Closing marker: the live Session that adopts this seed must not append a
  // second marker, which would shift every later seq past the stored log.
  push("session/end-seed", {});
  return events;
}

/** Remembers the replay events so a touched-again chat can be re-registered. */
function writeImported(record) {
  try {
    mkdirSync(IMPORTED_DIR, { recursive: true });
    writeFileSync(resolve(IMPORTED_DIR, `${record.header.id}.json`), `${JSON.stringify(record)}\n`, "utf8");
  } catch {
    /* the seed copy is a convenience, not a requirement */
  }
}

function readImported(sessionId) {
  try {
    return JSON.parse(readFileSync(resolve(IMPORTED_DIR, `${sessionId}.json`), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * Deletes one stored session directory this bundle created, plus its imported
 * replay copy. Used when a transcript is rebuilt in a newer rendering format so
 * the superseded twin does not linger in the session list.
 */
function removeStoredSession(sessionId) {
  try {
    rmSync(resolve(IMPORTED_DIR, `${sessionId}.json`), { force: true });
  } catch {
    /* no replay copy */
  }
  const home = process.env.DSH_HOME || resolve(process.env.USERPROFILE || process.env.HOME || "", ".dsh");
  const root = resolve(home, "sessions");
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = resolve(root, entry.name, sessionId);
      try {
        if (!existsSync(candidate) || !statSync(candidate).isDirectory()) continue;
        rmSync(candidate, { recursive: true, force: true });
        return true;
      } catch {
        /* try the next workspace directory */
      }
    }
  } catch {
    /* no sessions tree under this home */
  }
  return false;
}

/**
 * Imported sessions must stay OUT of the live session store.
 *
 * `sessions.retain` only needs the id to appear in the session list, and the
 * list is persistence-backed; a store entry, on the other hand, makes the
 * agent's `resume` fail with "session ... already exists". Registration is
 * therefore deliberately skipped and only reported for diagnostics.
 */
function ensureRegistered(sessions, record) {
  void sessions;
  void record;
  return { registered: false, registerError: "skipped-resume-owns-the-session" };
}

/**
 * Reports whether a stored session is visible to the session list the Client
 * pulls with `sessions.refreshList()` (`remote.session.list` → host list()).
 *
 * host list() = live sessions + cold records from `sessionQuery.listSessions`
 * (cold records need a `cwd` in their header, which imported sessions always
 * carry), so an unregistered imported session should still be listed.
 */
async function visibility(lookup, sessionId) {
  try {
    const query = lookup("sessionQuery");
    if (!query || typeof query.listSessions !== "function") {
      return { listed: null, listReason: "no-session-query" };
    }
    const records = await query.listSessions();
    if (!Array.isArray(records)) {
      return { listed: null, listReason: "not-an-array" };
    }
    const ids = records.map((entry) => (entry && entry.header ? entry.header.id : undefined));
    return { listed: ids.includes(sessionId), listCount: ids.length };
  } catch (error) {
    return { listed: null, listReason: failureText(error) };
  }
}

/** Writes one stored Harness session (header + optional seeded transcript). */
async function createStoredSession(persistence, messages, sessions) {
  const sessionId = `session-${randomUUID()}`;
  const events = seedEvents(messages);
  const header = {
    version: SESSION_FORMAT_VERSION,
    id: sessionId,
    createdAt: Date.now(),
    cwd: DATA_DIR,
    isSeeded: false,
    agentPreset: "standard",
  };
  const handle = await persistence.create(header);
  try {
    if (events.length > 0) {
      await handle.append(events);
    }
    await handle.flush();
  } finally {
    await handle.close();
  }
  const record = { format: IMPORTED_FORMAT, webCount: messages.length, header, events };
  writeImported(record);
  return { sessionId, ...ensureRegistered(sessions, record) };
}

export function apply(ctx) {
  const token = readToken();
  writeReport("sync-v1.json", {
    mark: MARK,
    at: new Date().toISOString(),
    tokenAvailable: token.length > 0,
    tokenLength: token.length,
  });
  // A fresh install should not require the user to copy anything: if no token
  // file exists yet, quietly recover the session from the local browsers.
  if (token === "") {
    autoDetectToken().catch(() => undefined);
  }

  /** Register the data routes on the authenticated Host connection. */
  const registerRoutes = (inner) => {
    const report = {
      mark: MARK,
      at: new Date().toISOString(),
      hasConnection: false,
      hasFetch: false,
      hasWorkspaceRegistry: false,
      hasSessionController: false,
      hasSessionPersistence: false,
      registered: [],
    };
    try {
      const lookup = (name) => serviceOf(inner, name) || serviceOf(ctx, name);
      const connection = lookup("connection");
      const workspaceRegistry = lookup("workspaceRegistry");
      const sessionController = lookup("sessionController");
      report.hasConnection = Boolean(connection);
      report.hasWorkspaceRegistry = Boolean(workspaceRegistry);
      report.hasSessionController = Boolean(sessionController);
      report.hasSessionPersistence = Boolean(lookup("sessionPersistence"));
      const routes = connection && connection.fetch;
      report.hasFetch = Boolean(routes && typeof routes.register === "function");
      if (!routes || typeof routes.register !== "function") {
        writeReport("route.json", report);
        return;
      }
      /** Open (or seed) the Harness twin of a web chat. */
      const continueSession = async (webSessionId) => {
        const persistence = lookup("sessionPersistence");
        const sessions = lookup("sessions");
        if (!persistence || typeof persistence.create !== "function") {
          return { status: 503, payload: { ok: false, error: "session-persistence-missing" } };
        }
        const current = readToken();
        if (!current) {
          return {
            status: 401,
            payload: {
              ok: false,
              tokenInvalid: true,
              tokenMissing: true,
              error: `还没有配置网页版 token：请把 token 放进 ${TOKEN_FILE}`,
            },
          };
        }
        const map = readMap();
        const known = typeof map[webSessionId] === "string" ? map[webSessionId] : "";
        let stale = "";
        let replaceReason = "";
        let latest = null;
        if (known) {
          try {
            const snapshot = typeof persistence.stat === "function" ? await persistence.stat(known) : undefined;
            const record = snapshot ? readImported(known) : undefined;
            if (snapshot && record !== undefined) {
              latest = await loadMessages(current, webSessionId);
              if (tokenRejected(latest)) {
                return { status: 401, payload: tokenExpiredPayload() };
              }
              const readable = latest.code === 0;
              const sameCount = readable && latest.messages.length === record.webCount;
              const sameFormat = record.format === IMPORTED_FORMAT;
              // Reuse the twin when the web copy is unchanged, or when the web
              // side cannot be read right now (offline / token hiccup).
              if ((sameFormat && sameCount) || !readable) {
                const registration = ensureRegistered(sessions, record);
                const visible = await visibility(lookup, known);
                writeReport("open.json", {
                  mark: MARK,
                  at: new Date().toISOString(),
                  webSessionId,
                  sessionId: known,
                  created: false,
                  updated: false,
                  format: IMPORTED_FORMAT,
                  ...registration,
                  ...visible,
                });
                return {
                  status: 200,
                  payload: { ok: true, sessionId: known, created: false, updated: false, ...registration, ...visible },
                };
              }
              stale = known;
              replaceReason = sameFormat ? "updated" : "format";
            }
          } catch {
            /* fall through and rebuild */
          }
        }
        if (latest === null || latest.code !== 0) {
          latest = await loadMessages(current, webSessionId);
        }
        if (latest.code !== 0) {
          if (tokenRejected(latest)) {
            return { status: 401, payload: tokenExpiredPayload() };
          }
          return { status: 502, payload: { ok: false, error: `web-code-${latest.code}` } };
        }
        const created = await createStoredSession(persistence, latest.messages, sessions);
        const sessionId = created.sessionId;
        map[webSessionId] = sessionId;
        writeMap(map);
        // A twin written by the old renderer is superseded; keep a twin whose
        // web copy merely advanced (that Harness thread may still be in use).
        const removedOld = stale !== "" && replaceReason === "format" ? removeStoredSession(stale) : undefined;
        const visible = await visibility(lookup, sessionId);
        writeReport("open.json", {
          mark: MARK,
          at: new Date().toISOString(),
          webSessionId,
          sessionId,
          created: true,
          updated: stale !== "",
          replaceReason: replaceReason || undefined,
          previousSessionId: stale || undefined,
          removedOld,
          messageCount: latest.messages.length,
          format: IMPORTED_FORMAT,
          registered: created.registered,
          registerError: created.registerError,
          ...visible,
        });
        return {
          status: 200,
          payload: {
            ok: true,
            sessionId,
            created: true,
            updated: stale !== "",
            previousSessionId: stale || undefined,
            messageCount: latest.messages.length,
            registered: created.registered,
            registerError: created.registerError,
            ...visible,
          },
        };
      };

      /** Create a blank Harness conversation in the web-chat workspace. */
      const newChat = async () => {
        const persistence = lookup("sessionPersistence");
        const sessions = lookup("sessions");
        if (!persistence || typeof persistence.create !== "function") {
          return { status: 503, payload: { ok: false, error: "session-persistence-missing" } };
        }
        const created = await createStoredSession(persistence, [], sessions);
        writeReport("new-chat.json", {
          mark: MARK,
          at: new Date().toISOString(),
          sessionId: created.sessionId,
          registered: created.registered,
          registerError: created.registerError,
        });
        return {
          status: 200,
          payload: { ok: true, sessionId: created.sessionId, registered: created.registered },
        };
      };

      const handlers = [
        {
          // Read the current token state, save one the user pasted, or try to
          // recover the browser session automatically (zero-step install).
          path: TOKEN_ROUTE,
          methods: ["GET", "HEAD", "POST"],
          run: async (request) => {
            const method = String((request && request.method) || "GET").toUpperCase();
            if (method === "POST") {
              let body = null;
              try {
                body = await request.json();
              } catch {
                body = null;
              }
              const action = body && typeof body === "object" ? String(body.action || "") : "";
              if (action === "auto") {
                const found = await autoDetectToken();
                if (!found) {
                  return jsonResponse(404, {
                    ok: false,
                    error: "没有在本机浏览器里找到已登录的网页版会话，请手动粘贴一次 token",
                  });
                }
                return jsonResponse(200, {
                  ok: true,
                  source: found.source,
                  length: found.token.length,
                });
              }
              const value = normaliseToken(body && (body.token || body.value));
              if (value === "") {
                return jsonResponse(400, { ok: false, error: "token 不能为空" });
              }
              const checked = await validateToken(value);
              if (!checked.ok) {
                return jsonResponse(400, {
                  ok: false,
                  error: "token 校验失败，请确认复制的是网页版登录后的 userToken",
                  code: checked.code,
                });
              }
              writeTokenValue(value);
              return jsonResponse(200, { ok: true, source: "manual", length: value.length });
            }
            const current = readToken();
            return jsonResponse(200, {
              ok: true,
              hasToken: current !== "",
              length: current.length,
            });
          },
        },
        {
          path: SESSIONS_ROUTE,
          run: async (request) => {
            const current = readToken();
            if (!current) return tokenMissingResponse();
            const url = new URL(request.url);
            const count = Number(url.searchParams.get("count") || "20");
            const beforeUpdatedAt = Number(url.searchParams.get("beforeUpdatedAt") || "NaN");
            const beforePinned = String(url.searchParams.get("beforePinned") || "") === "true";
            const cursor = Number.isFinite(beforeUpdatedAt)
              ? { pinned: beforePinned, updatedAt: beforeUpdatedAt }
              : null;
            const result = await loadSessions(current, { count, cursor });
            if (tokenRejected(result)) {
              return tokenExpiredResponse();
            }
            if (cursor === null) {
              try {
                mkdirSync(DATA_DIR, { recursive: true });
                writeFileSync(CACHE_FILE, `${JSON.stringify({ at: new Date().toISOString(), ...result }, null, 2)}\n`, "utf8");
              } catch {
                /* cache is best effort */
              }
            }
            return jsonResponse(200, { ok: true, ...result });
          },
        },
        {
          path: MESSAGES_ROUTE,
          run: async (request) => {
            const current = readToken();
            if (!current) return tokenMissingResponse();
            const url = new URL(request.url);
            const sessionId = String(url.searchParams.get("id") || "");
            if (!sessionId) return jsonResponse(400, { ok: false, error: "missing-id" });
            const result = await loadMessages(current, sessionId);
            if (tokenRejected(result)) {
              return tokenExpiredResponse();
            }
            writeReport("messages.json", {
              mark: MARK,
              at: new Date().toISOString(),
              id: sessionId,
              count: result.messages.length,
              code: result.code,
            });
            return jsonResponse(200, { ok: true, ...result });
          },
        },
        {
          path: OPEN_ROUTE,
          run: async (request) => {
            const url = new URL(request.url);
            const webSessionId = String(url.searchParams.get("id") || "");
            if (!webSessionId) return jsonResponse(400, { ok: false, error: "missing-id" });
            const outcome = await continueSession(webSessionId);
            return jsonResponse(outcome.status, outcome.payload);
          },
        },
        {
          path: CONTINUE_ROUTE,
          run: async (request) => {
            const url = new URL(request.url);
            const webSessionId = String(url.searchParams.get("id") || "");
            if (!webSessionId) return jsonResponse(400, { ok: false, error: "missing-id" });
            const outcome = await continueSession(webSessionId);
            return jsonResponse(outcome.status, outcome.payload);
          },
        },
        {
          path: EXPORT_ROUTE,
          run: async (request) => {
            const current = readToken();
            if (!current) return tokenMissingResponse();
            const url = new URL(request.url);
            const sessionId = String(url.searchParams.get("id") || "");
            if (!sessionId) return jsonResponse(400, { ok: false, error: "missing-id" });
            const result = await loadMessages(current, sessionId);
            if (result.code !== 0) {
              if (tokenRejected(result)) {
                return tokenExpiredResponse();
              }
              return jsonResponse(502, { ok: false, error: `web-code-${result.code}` });
            }
            const title = String((result.session && result.session.title) || "网页对话");
            return jsonResponse(200, {
              ok: true,
              title,
              filename: safeFileName(title) + ".md",
              markdown: markdownFor(title, result.messages),
              messageCount: result.messages.length,
            });
          },
        },
        {
          path: NEW_CHAT_ROUTE,
          run: async () => {
            const outcome = await newChat();
            return jsonResponse(outcome.status, outcome.payload);
          },
        },
      ];
      for (const handler of handlers) {
        try {
          const dispose = routes.register({
            path: handler.path,
            methods: Array.isArray(handler.methods) ? handler.methods : ["GET", "HEAD"],
            requestBody: "buffered",
            fetch: async (request) => {
              try {
                return await handler.run(request);
              } catch (error) {
                writeReport("route-error.json", {
                  mark: MARK,
                  at: new Date().toISOString(),
                  path: handler.path,
                  url: String(request && request.url),
                  name: String((error && error.name) || "Error"),
                  message: failureText(error),
                  stack: String((error && error.stack) || ""),
                });
                return jsonResponse(500, { ok: false, error: failureText(error) });
              }
            },
          });
          report.registered.push(handler.path);
          if (typeof dispose === "function" && typeof ctx.effect === "function") {
            ctx.effect(() => dispose, `route:${handler.path}`);
          }
        } catch (error) {
          report.registered.push({ path: handler.path, error: failureText(error) });
        }
      }
    } catch (error) {
      report.error = failureText(error);
    }
    writeReport("route.json", report);
  };

  if (typeof ctx.inject === "function") {
    try {
      ctx.inject(["connection"], (inner) => registerRoutes(inner));
    } catch (error) {
      writeReport("route.json", { mark: MARK, error: failureText(error) });
    }
  } else {
    writeReport("route.json", { mark: MARK, error: "ctx.inject is not available" });
  }
}
