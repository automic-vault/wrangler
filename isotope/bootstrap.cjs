const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { execFileSync } = require("node:child_process");

try {
	const executable = fs.realpathSync(process.execPath);
	const contents = path.dirname(path.dirname(executable));
	const bundle = path.dirname(contents);
	if (
		path.basename(contents) !== "Contents" ||
		path.basename(path.dirname(executable)) !== "MacOS" ||
		path.basename(executable) !== "wrangler"
	) {
		throw new Error("Wrangler requires its signed Isotope bundle.");
	}
	// Authenticate resources and prevent same-user replacement between validation
	// and loading. Every ancestor, resource and dependency must be root-owned.
	function check(filename) {
		const stat = fs.lstatSync(filename);
		if (stat.isSymbolicLink()) {
			if (
				stat.uid !== 0 ||
				!fs.realpathSync(filename).startsWith(bundle + path.sep)
			)
				throw new Error("Wrangler resource link escapes its signed bundle.");
			return;
		}
		if (!stat.isFile() && !stat.isDirectory()) {
			throw new Error("Invalid Wrangler runtime resource type.");
		}
		if (stat.uid !== 0 || (stat.mode & 0o022) !== 0) {
			throw new Error(
				"Wrangler Isotope installation must be root-owned and not writable by group or others."
			);
		}
		// Mode bits alone do not account for macOS ACL grants.
		if (process.getuid() !== 0) {
			let writable = false;
			try {
				fs.accessSync(filename, fs.constants.W_OK);
				writable = true;
			} catch (error) {
				if (error.code !== "EACCES" && error.code !== "EPERM") throw error;
			}
			if (writable)
				throw new Error(
					"Wrangler runtime resources must not be writable by this user."
				);
		}
	}
	for (let directory = bundle; ; directory = path.dirname(directory)) {
		check(directory);
		if (directory === path.dirname(directory)) break;
	}
	function checkTree(directory) {
		check(directory);
		for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
			const filename = path.join(directory, entry.name);
			if (entry.isDirectory()) checkTree(filename);
			else check(filename);
		}
	}
	checkTree(bundle);
	execFileSync(
		"/usr/bin/codesign",
		[
			"--verify",
			"--deep",
			"--strict",
			"--all-architectures",
			"--test-requirement",
			'=anchor apple generic and certificate leaf[subject.OU] = ZU76A67LGU and identifier "com.automicvault.wrangler"',
			bundle,
		],
		{ stdio: "pipe" }
	);
	delete process.env.NODE_OPTIONS;
	delete process.env.NODE_PATH;
	const require = createRequire(executable);
	// Capture native argv before giving upstream its conventional Node argv shape.
	require(path.join(contents, "Resources/automic-vault.node"));
	const cli = path.join(contents, "Resources/wrangler/wrangler-dist/cli.js");
	process.argv = [executable, cli, ...process.argv.slice(2)];
	require("node:module").runMain(cli);
} catch (error) {
	process.stderr.write(`Wrangler Isotope: ${error.message}\n`);
	process.exitCode = 1;
}
