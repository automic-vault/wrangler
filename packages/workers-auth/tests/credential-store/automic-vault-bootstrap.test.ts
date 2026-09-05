import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import { it, vi } from "vitest";

const source = readFileSync(
	new URL("../../../../isotope/bootstrap.cjs", import.meta.url),
	"utf8"
);
const bundle = "/opt/av/wrangler/Wrangler.app";

it("authenticates the immutable bundle before loading code, preserving the command", ({
	expect,
}) => {
	const events: string[] = [];
	const process = {
		getuid: () => 501,
		execPath: `${bundle}/Contents/MacOS/wrangler`,
		argv: ["wrangler", "wrangler", "deploy", "--name", "demo"],
		env: { NODE_OPTIONS: "--require=evil", NODE_PATH: "/evil" },
		stderr: { write: vi.fn() },
		exitCode: undefined,
	};
	const fs = {
		realpathSync: (file: string) => file,
		lstatSync: () => ({
			uid: 0,
			mode: 0o755,
			isSymbolicLink: () => false,
			isFile: () => true,
			isDirectory: () => false,
		}),
		readdirSync: () => [],
		constants: { W_OK: 2 },
		accessSync: () => {
			throw Object.assign(new Error("access denied"), { code: "EACCES" });
		},
	};
	const module = {
		createRequire: () => (name: string) => {
			events.push(name);
			return module;
		},
		runMain: (file: string) => events.push(file),
	};
	runInNewContext(source, {
		process,
		require: (name: string) =>
			({
				"node:fs": fs,
				"node:path": path,
				"node:module": module,
				"node:child_process": {
					execFileSync: (_command: string, args: string[]) => {
						expect(args[args.indexOf("--test-requirement") + 1]).toMatch(
							/^=anchor apple generic/
						);
						events.push("verify");
					},
				},
			})[name],
	});
	expect(events[0]).toBe("verify");
	expect(events[1]).toBe(`${bundle}/Contents/Resources/automic-vault.node`);
	expect(events.at(-1)).toBe(
		`${bundle}/Contents/Resources/wrangler/wrangler-dist/cli.js`
	);
	expect(process.argv.slice(2)).toEqual(["deploy", "--name", "demo"]);
	expect(process.env).toEqual({});
	expect(process.exitCode).toBeUndefined();
});

it.for(["owner", "writable", "link", "signature", "acl"])(
	"rejects %s failure before loading code",
	(failure, { expect }) => {
		const load = vi.fn();
		const process = {
			getuid: () => 501,
			execPath: `${bundle}/Contents/MacOS/wrangler`,
			argv: [],
			env: {},
			stderr: { write: vi.fn() },
			exitCode: undefined,
		};
		const fs = {
			realpathSync: (file: string) =>
				file === process.execPath ? file : "/outside",
			lstatSync: () => ({
				uid: failure === "owner" ? 501 : 0,
				mode: failure === "writable" ? 0o777 : 0o755,
				isSymbolicLink: () => failure === "link",
				isFile: () => true,
				isDirectory: () => false,
			}),
			readdirSync: () => [],
			constants: { W_OK: 2 },
			accessSync: () => {
				if (failure === "acl") {
					return;
				}
				throw Object.assign(new Error("access denied"), { code: "EACCES" });
			},
		};
		runInNewContext(source, {
			process,
			require: (name: string) =>
				({
					"node:fs": fs,
					"node:path": path,
					"node:module": { createRequire: load },
					"node:child_process": {
						execFileSync: () => {
							throw new Error("signature failed");
						},
					},
				})[name],
		});
		expect(load).not.toHaveBeenCalled();
		expect(process.exitCode).toBe(1);
	}
);
