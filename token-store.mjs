/**
 * Web token storage helpers.
 *
 * Two jobs:
 *  1. read/write the user's chat.deepseek.com token file;
 *  2. best-effort discovery of that token inside the local Chromium browsers'
 *     "Local Storage" LevelDB files, so a fresh install works without asking
 *     the user to copy anything.
 *
 * The discovery is deliberately forgiving: it only REPORTS candidates and
 * expects the caller to validate them against the real API before saving.
 * Nothing here talks to the network.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const TOKEN_KEY_HINTS = ["usertoken", "user_token", "token"];
const ORIGIN_HINTS = ["chat.deepseek.com"];
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CANDIDATES = 40;

/** Read the stored token value (JSON wrapper or raw text). "" when absent. */
export function readStoredTokenFile(file) {
  try {
    const raw = readFileSync(file, "utf8").trim();
    if (!raw) return "";
    let value = raw;
    if (raw.startsWith("{")) {
      try {
        const parsed = JSON.parse(raw);
        value = parsed.value || parsed.token || parsed.userToken || "";
      } catch {
        /* keep raw */
      }
    }
    return normaliseToken(value);
  } catch {
    return "";
  }
}

/** Persist one token, replacing whatever was there before. */
export function writeStoredTokenFile(file, token) {
  const value = normaliseToken(token);
  if (value === "") return false;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ value, __version: "1" }, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** Strip wrappers the user might have copied along with the token. */
export function normaliseToken(value) {
  return String(value == null ? "" : value)
    .trim()
    .replace(/^Bearer\s+/i, "")
    .replace(/^"+|"+$/g, "")
    .trim();
}

/** Candidate browsers, most common first (Windows, macOS and Linux layouts). */
function browserRoots() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const mac = join(home, "Library", "Application Support");
  const linux = join(home, ".config");
  const roots = [];
  const local = process.env.LOCALAPPDATA || "";
  if (local !== "") {
    roots.push(
      { name: "chrome", root: join(local, "Google", "Chrome", "User Data") },
      { name: "edge", root: join(local, "Microsoft", "Edge", "User Data") },
      { name: "brave", root: join(local, "BraveSoftware", "Brave-Browser", "User Data") },
      { name: "chromium", root: join(local, "Chromium", "User Data") }
    );
  }
  if (process.platform === "darwin") {
    roots.push(
      { name: "chrome", root: join(mac, "Google", "Chrome") },
      { name: "edge", root: join(mac, "Microsoft Edge") },
      { name: "brave", root: join(mac, "BraveSoftware", "Brave-Browser") },
      { name: "chromium", root: join(mac, "Chromium") }
    );
  } else if (process.platform === "linux") {
    roots.push(
      { name: "chrome", root: join(linux, "google-chrome") },
      { name: "edge", root: join(linux, "microsoft-edge") },
      { name: "brave", root: join(linux, "BraveSoftware", "Brave-Browser") },
      { name: "chromium", root: join(linux, "chromium") }
    );
  }
  return roots;
}

/** Every `<profile>/Local Storage/leveldb` directory that exists. */
function leveldbDirs() {
  const dirs = [];
  for (const browser of browserRoots()) {
    if (!existsSync(browser.root)) continue;
    let entries = [];
    try {
      entries = readdirSync(browser.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!/^(Default|Profile \d+|Guest Profile|System Profile)$/.test(entry.name)) continue;
      const dir = join(browser.root, entry.name, "Local Storage", "leveldb");
      if (existsSync(dir)) {
        dirs.push({ browser: browser.name, profile: entry.name, dir });
      }
    }
  }
  return dirs;
}

function readVarint(buffer, position) {
  let result = 0;
  let shift = 0;
  let pos = position;
  while (pos < buffer.length) {
    const byte = buffer[pos];
    pos += 1;
    result += (byte & 0x7f) * Math.pow(2, shift);
    if ((byte & 0x80) === 0) {
      return { value: result, pos };
    }
    shift += 7;
    if (shift > 35) return null;
  }
  return null;
}

/** Reassemble the logical records out of one LevelDB write-ahead log file. */
function logicalRecords(buffer) {
  const records = [];
  const blockSize = 32768;
  let pending = null;
  let pos = 0;
  while (pos + 7 <= buffer.length) {
    const blockLeft = blockSize - (pos % blockSize);
    if (blockLeft < 7) {
      pos += blockLeft;
      continue;
    }
    const length = buffer.readUInt16LE(pos + 4);
    const type = buffer[pos + 6];
    const dataStart = pos + 7;
    const dataEnd = dataStart + length;
    if (length === 0) {
      pos = dataStart + (blockSize - (dataStart % blockSize)) % blockSize;
      continue;
    }
    if (dataEnd > buffer.length) break;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === 1) {
      records.push(data);
      pending = null;
    } else if (type === 2) {
      pending = [data];
    } else if (type === 3 && pending) {
      pending.push(data);
    } else if (type === 4 && pending) {
      pending.push(data);
      records.push(Buffer.concat(pending));
      pending = null;
    }
    pos = dataEnd;
  }
  return records;
}

/** Decode one Chromium localStorage value blob into a string. */
function decodeStorageValue(value) {
  if (!value || value.length === 0) return "";
  const body = value;
  const first = body[0];
  const rest = body.subarray(1);
  const fromUtf16 = (buf) => buf.toString("utf16le");
  const fromLatin = (buf) => buf.toString("latin1");
  const candidates = [];
  if (first === 0 || first === 1) {
    candidates.push(first === 0 ? fromUtf16(rest) : fromLatin(rest));
  }
  candidates.push(fromLatin(body));
  candidates.push(fromUtf16(body));
  return candidates;
}

/** Pull all plausible token strings out of one WriteBatch record. */
function tokensFromBatch(record) {
  const found = [];
  if (record.length < 12) return found;
  let pos = 12; // 8-byte sequence number + 4-byte entry count
  while (pos < record.length) {
    const tag = record[pos];
    pos += 1;
    if (tag !== 0 && tag !== 1) break;
    const keyVar = readVarint(record, pos);
    if (keyVar === null) break;
    pos = keyVar.pos;
    const key = record.subarray(pos, pos + keyVar.value);
    pos += keyVar.value;
    if (tag === 0) continue;
    const valueVar = readVarint(record, pos);
    if (valueVar === null) break;
    pos = valueVar.pos;
    const value = record.subarray(pos, pos + valueVar.value);
    pos += valueVar.value;
    const keyText = key.toString("latin1").toLowerCase();
    if (!ORIGIN_HINTS.some((hint) => keyText.includes(hint))) continue;
    if (!TOKEN_KEY_HINTS.some((hint) => keyText.includes(hint))) continue;
    for (const text of decodeStorageValue(value)) {
      const token = normaliseToken(text.replace(/[\u0000-\u001f]+/g, "").replace(/^"|"$/g, ""));
      if (/^[A-Za-z0-9._~+/=-]{20,200}$/.test(token)) {
        found.push(token);
      }
    }
  }
  return found;
}

/** Last-resort scan of a file's raw bytes for token-looking strings. */
function tokensFromRawBytes(buffer) {
  const found = [];
  const haystack = buffer;
  const needle = Buffer.from("userToken", "latin1");
  let index = haystack.indexOf(needle);
  let guard = 0;
  while (index !== -1 && guard < 200) {
    guard += 1;
    const windowStart = Math.max(0, index - 2048);
    const windowEnd = Math.min(haystack.length, index + 2048);
    const window = haystack.subarray(windowStart, windowEnd);
    for (const text of [window.toString("latin1"), window.toString("utf16le")]) {
      const matches = text.match(/[A-Za-z0-9._~+/=-]{32,200}/g) || [];
      for (const match of matches) {
        if (/^[A-Za-z0-9._~+/=-]{32,200}$/.test(match)) found.push(match);
      }
    }
    index = haystack.indexOf(needle, index + 1);
  }
  return found;
}

function filesIn(dir) {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    const full = join(dir, name);
    try {
      if (!statSync(full).isFile()) continue;
    } catch {
      continue;
    }
    if (/\.(log|ldb)$/i.test(name)) files.push({ name, full, isLog: /\.log$/i.test(name) });
  }
  // Newest first: the freshest login lives in the newest file.
  return files.sort((a, b) => {
    try {
      return statSync(b.full).mtimeMs - statSync(a.full).mtimeMs;
    } catch {
      return 0;
    }
  });
}

/**
 * Look for a logged-in chat.deepseek.com token in the local browsers.
 *
 * @param {(token: string) => Promise<boolean>} check validates a candidate
 *        against the live API. Candidates are tried newest-first and the first
 *        accepted one wins.
 * @returns {Promise<{token: string, source: string, scanned: number, tried: number} | null>}
 */
export async function detectBrowserToken(check) {
  const dirs = leveldbDirs();
  let scanned = 0;
  let tried = 0;
  const seen = new Set();
  for (const entry of dirs) {
    const files = filesIn(entry.dir);
    for (const file of files) {
      let buffer;
      try {
        const size = statSync(file.full).size;
        if (size === 0 || size > MAX_FILE_BYTES) continue;
        buffer = readFileSync(file.full);
      } catch {
        continue;
      }
      scanned += 1;
      let tokens = [];
      if (file.isLog) {
        try {
          for (const record of logicalRecords(buffer)) {
            tokens.push(...tokensFromBatch(record));
          }
        } catch {
          tokens = [];
        }
      }
      if (tokens.length === 0) {
        try {
          tokens = tokensFromRawBytes(buffer);
        } catch {
          tokens = [];
        }
      }
      for (const token of tokens) {
        if (seen.has(token)) continue;
        seen.add(token);
        if (seen.size > MAX_CANDIDATES) return null;
        tried += 1;
        let ok = false;
        try {
          ok = await check(token);
        } catch {
          ok = false;
        }
        if (ok) {
          return { token, source: `${entry.browser}/${entry.profile}/${file.name}`, scanned, tried };
        }
      }
    }
  }
  return null;
}
