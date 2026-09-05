import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
	readdirSync,
} from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bundle = path.join(root, "isotope/out/Wrangler.app");
const contents = path.join(bundle, "Contents");
const resources = path.join(contents, "Resources");
const identity = process.env.CODESIGN_IDENTITY;
if (!identity) throw new Error("CODESIGN_IDENTITY is required");
// Node 26's SEA builder seals execArgvExtension: none into the executable.
if (process.versions.node !== "26.8.1")
	throw new Error("Build the Isotope runtime with Node 26.8.1");
function run(command, args) {
	execFileSync(command, args, { cwd: root, stdio: "inherit" });
}
rmSync(bundle, { recursive: true, force: true });
mkdirSync(path.join(contents, "MacOS"), { recursive: true });
mkdirSync(resources, { recursive: true });
run("pnpm", ["--filter", "wrangler...", "build"]);
rmSync(path.join(root, "isotope/out/deploy"), { recursive: true, force: true });
run("pnpm", [
	"--filter",
	"wrangler",
	"--config.inject-workspace-packages=true",
	"deploy",
	"--prod",
	path.join(root, "isotope/out/deploy"),
]);
// Preserve relative pnpm links; the bootstrap rejects links outside the sealed bundle.
cpSync(
	path.join(root, "isotope/out/deploy"),
	path.join(resources, "wrangler"),
	{ recursive: true, verbatimSymlinks: true }
);
run("clang++", [
	"-std=c++17",
	"-mmacosx-version-min=14.0",
	"-fblocks",
	"-shared",
	"-framework",
	"CoreFoundation",
	"-undefined",
	"dynamic_lookup",
	`-I${path.resolve(path.dirname(process.execPath), "../include/node")}`,
	"isotope/automic-vault.cc",
	"-o",
	path.join(resources, "automic-vault.node"),
]);
const config = path.join(root, "isotope/out/sea.json");
writeFileSync(
	config,
	JSON.stringify({
		main: path.join(root, "isotope/bootstrap.cjs"),
		output: path.join(contents, "MacOS/wrangler"),
		disableExperimentalSEAWarning: true,
		execArgvExtension: "none",
		execArgv: [],
	})
);
run(process.execPath, ["--build-sea", config]);
const version = JSON.parse(
	readFileSync(path.join(root, "packages/wrangler/package.json"))
).version;
writeFileSync(
	path.join(contents, "Info.plist"),
	`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.automicvault.wrangler</string><key>CFBundleExecutable</key><string>wrangler</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>${version}</string></dict></plist>`
);
function signNative(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const file = path.join(directory, entry.name);
		if (entry.isSymbolicLink()) continue;
		if (entry.isDirectory()) signNative(file);
		else {
			const magic = readFileSync(file).subarray(0, 4).toString("hex");
			if (["cffaedfe", "cefaedfe", "cafebabe", "bebafeca"].includes(magic)) {
				run("/usr/bin/codesign", [
					"--force",
					"--options",
					"runtime",
					"--timestamp",
					...(entry.name === "workerd"
						? ["--entitlements", "isotope/entitlements.plist"]
						: []),
					"--sign",
					identity,
					file,
				]);
				if (entry.name === "workerd")
					run(file, ["test", "isotope/workerd-smoke.capnp"]);
			}
		}
	}
}
signNative(resources);
run("/usr/bin/codesign", [
	"--force",
	"--options",
	"runtime",
	"--timestamp",
	"--entitlements",
	"isotope/entitlements.plist",
	"--sign",
	identity,
	bundle,
]);
run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]);
run(process.execPath, ["isotope/smoke.mjs"]);
run("/usr/bin/tar", [
	"czf",
	`isotope/out/cli-${version}.tgz`,
	"-C",
	"isotope/out",
	"Wrangler.app",
]);
