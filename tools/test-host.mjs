// Host-half self check: apply() must register the seven data routes on a
// minimal fake cordis context. Run: node tools/test-host.mjs
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep the self check out of the real data folder.
process.env.DSH_WCS_DATA_DIR = mkdtempSync(join(tmpdir(), "dsh-wcs-selfcheck-"));

const { apply } = await import("../index.js");

const registered = [];
const services = {
	connection: {
		fetch: {
			register(route) {
				registered.push({ path: route.path, methods: route.methods });
				return () => undefined;
			}
		}
	},
	workspaceRegistry: {},
	sessionController: {},
	sessionPersistence: {}
};

const ctx = {
	get: (name) => services[name],
	inject: (names, callback) => callback({ get: (name) => services[name] }),
	effect: (run) => run()
};

apply(ctx);

const paths = registered.map((route) => route.path);
const expected = [
	"/api/wcs/token",
	"/api/wcs/sessions",
	"/api/wcs/messages",
	"/api/wcs/open",
	"/api/wcs/continue",
	"/api/wcs/export",
	"/api/wcs/new-chat"
];
const missing = expected.filter((path) => !paths.includes(path));
const token = registered.find((route) => route.path === "/api/wcs/token");
const checks = [
	["seven data routes registered", registered.length === 7],
	["every expected route present", missing.length === 0],
	["token route accepts POST", Boolean(token && token.methods.includes("POST"))],
	["no debug route", !paths.includes("/api/wcs/debug")]
];

let failed = 0;
for (const [name, ok] of checks) {
	console.log((ok ? "PASS" : "FAIL") + "  " + name);
	if (!ok) failed += 1;
}
if (failed > 0) {
	process.exitCode = 1;
}
