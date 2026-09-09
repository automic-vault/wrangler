import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { runInNewContext } from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const bootstrap = readFileSync(
	path.join(root, "isotope/bootstrap.cjs"),
	"utf8"
);
for (const [accessError, uid, mode, allowed] of [
	["EACCES", 0, 0o755, true],
	["EPERM", 0, 0o755, true],
	["EROFS", 0, 0o755, true],
	["EIO", 0, 0o755, false],
	["ENOENT", 0, 0o755, false],
	[null, 0, 0o755, false],
	["EROFS", 501, 0o755, false],
	["EROFS", 0, 0o777, false],
]) {
	let ran = false;
	let error = "";
	const modules = {
		"node:path": path,
		"node:fs": {
			realpathSync: (filename) => filename,
			lstatSync: () => ({
				uid,
				mode,
				isSymbolicLink: () => false,
				isDirectory: () => true,
				isFile: () => false,
			}),
			readdirSync: () => [],
			constants: { W_OK: 2 },
			accessSync: () => {
				if (accessError)
					throw Object.assign(new Error(accessError), { code: accessError });
			},
		},
		"node:child_process": { execFileSync: () => {} },
		"node:module": {
			createRequire: () => () => ({
				runMain: () => {
					ran = true;
				},
			}),
		},
	};
	runInNewContext(bootstrap, {
		require: (name) => modules[name],
		process: {
			execPath: "/opt/av/wrangler/Wrangler.app/Contents/MacOS/wrangler",
			getuid: () => 501,
			env: {},
			argv: [],
			stderr: {
				write: (message) => {
					error += message;
				},
			},
		},
	});
	assert.equal(
		ran,
		allowed,
		`${accessError}, uid=${uid}, mode=${mode}: ${error}`
	);
}
const bundle = path.join(root, "isotope/out/Wrangler.app");
const executable = path.join(bundle, "Contents/MacOS/wrangler");
const directory = mkdtempSync(path.join(os.tmpdir(), "wrangler-sea-smoke-"));
try {
	const marker = path.join(directory, "executed");
	const preload = path.join(directory, "preload.cjs");
	writeFileSync(
		preload,
		`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "executed");`
	);
	for (const args of [["--version"], [`--node-options=--require=${preload}`]]) {
		const result = spawnSync(executable, args, {
			env: {
				...process.env,
				NODE_OPTIONS: `--require=${JSON.stringify(preload)}`,
				WRANGLER_SEND_METRICS: "false",
			},
			encoding: "utf8",
			timeout: 10000,
		});
		assert.ifError(result.error);
		assert(!existsSync(marker), "SEA accepted external Node options");
		assert(
			result.stderr.includes("Wrangler Isotope:") || result.status === 0,
			`SEA did not reach its bootstrap: ${result.stderr}`
		);
	}
	// Check the packaged module graph even when the staging directory's ownership
	// correctly prevents running the signed entry point before installation.
	const cli = path.join(
		bundle,
		"Contents/Resources/wrangler/wrangler-dist/cli.js"
	);
	const version = JSON.parse(
		readFileSync(path.join(root, "packages/wrangler/package.json"))
	).version;
	const output = execFileSync(process.execPath, [cli, "--version"], {
		env: { ...process.env, NODE_OPTIONS: "", WRANGLER_SEND_METRICS: "false" },
		encoding: "utf8",
		timeout: 10000,
	});
	assert(output.includes(version), output);
	console.log(
		"Signed SEA option isolation and packaged Wrangler version checks passed"
	);
} finally {
	rmSync(directory, { recursive: true, force: true });
}
