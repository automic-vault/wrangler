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

const root = path.resolve(import.meta.dirname, "..");
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
