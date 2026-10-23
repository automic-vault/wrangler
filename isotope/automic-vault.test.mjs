import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const originalCWD = process.cwd();
const directory = mkdtempSync(path.join(os.tmpdir(), "wrangler-xpc-test-"));
try {
	const addon = path.join(directory, "automic-vault.node");
	execFileSync(
		"clang++",
		[
			"-std=c++17",
			"-mmacosx-version-min=14.0",
			"-fblocks",
			"-shared",
			"-framework",
			"CoreFoundation",
			"-undefined",
			"dynamic_lookup",
			`-I${path.resolve(path.dirname(process.execPath), "../include/node")}`,
			path.join(import.meta.dirname, "automic-vault-test.cc"),
			"-o",
			addon,
		],
		{ stdio: "inherit" }
	);
	const { request } = createRequire(import.meta.url)(addon);
	const key = "WRANGLER_AUTH_64656661756C74";
	const project = path.join(directory, "project with spaces-é");
	mkdirSync(project);
	for (const cwd of [os.homedir(), project]) {
		process.chdir(cwd);
		for (const operation of ["keys", "wrangler-save", "wrangler-delete"]) {
			assert.throws(
				() => request(operation, key, "test credential"),
				{ message: `captured cwd: ${realpathSync(cwd)}` },
				`${operation} must send its current working directory`
			);
		}
	}
	// A disappearing working directory must fail before sending a request.
	rmSync(project, { recursive: true });
	for (const operation of ["keys", "wrangler-save", "wrangler-delete"]) {
		assert.throws(() => request(operation, key, "test credential"), {
			message: "Cannot resolve working directory",
		});
	}
	console.log("Native read/save/delete working-directory checks passed");
} finally {
	process.chdir(originalCWD);
	rmSync(directory, { recursive: true, force: true });
}
