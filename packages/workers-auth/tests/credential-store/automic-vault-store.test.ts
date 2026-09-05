import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { removeDirSync } from "@cloudflare/workers-utils";
import { afterEach, beforeEach, describe, it, vi } from "vitest";
import { AutomicVaultCredentialStore } from "../../src/credential-store/automic-vault-store";
import { createCredentialStorageContext } from "../../src/credential-store/resolver";

const { request, isSea } = vi.hoisted(() => ({
	request: vi.fn(),
	isSea: vi.fn(),
}));
const getBuiltinModule = process.getBuiltinModule;
vi.mock("node:module", () => ({ createRequire: () => () => ({ request }) }));
let directory: string;
beforeEach(() => {
	directory = mkdtempSync(path.join(os.tmpdir(), "wrangler-vault-"));
	isSea.mockReturnValue(true);
	vi.spyOn(process, "getBuiltinModule").mockImplementation((name) =>
		name === "node:sea" ? { isSea } : getBuiltinModule(name)
	);
});
afterEach(() => removeDirSync(directory));

describe("Automic Vault OAuth storage", () => {
	it("stores access and refresh tokens only in Vault and writes a tokenless profile marker", ({
		expect,
	}) => {
		const store = new AutomicVaultCredentialStore(directory, "work");
		const credential = {
			oauth_token: "access",
			refresh_token: "refresh",
			scopes: ["read"],
		};
		store.write(credential);
		expect(request).toHaveBeenCalledWith(
			"wrangler-save",
			"WRANGLER_AUTH_776F726B",
			JSON.stringify(credential)
		);
		expect(readFileSync(path.join(directory, "config/work.toml"), "utf8")).toBe(
			"# Credential stored in Automic Vault.\n"
		);
		request.mockReturnValue(JSON.stringify(credential));
		expect(store.read()).toEqual(credential);
		expect(store.clear()).toBe(true);
		expect(existsSync(path.join(directory, "config/work.toml"))).toBe(false);
		expect(request).toHaveBeenLastCalledWith(
			"wrangler-delete",
			"WRANGLER_AUTH_776F726B"
		);
	});
	it("reports no local credential marker on a no-op clear", ({ expect }) => {
		const store = new AutomicVaultCredentialStore(directory);
		expect(store.clear()).toBe(false);
	});

	it("does not turn denial or transport failure into logged-out state", ({
		expect,
	}) => {
		const store = new AutomicVaultCredentialStore(directory);
		request.mockImplementation(() => {
			throw new Error("denied");
		});
		expect(() => store.read()).toThrow("denied");
		expect(() => store.write({ oauth_token: "secret" })).toThrow("denied");
		expect(() => store.clear()).toThrow("denied");
	});
	it("distinguishes missing credentials from malformed replies", ({
		expect,
	}) => {
		const store = new AutomicVaultCredentialStore(directory);
		request.mockReturnValue(undefined);
		expect(store.read()).toBeUndefined();
		for (const value of [
			"not-json-secret-material",
			"null",
			"[]",
			'{"oauth_token":42}',
			'{"scopes":[42]}',
			'{"unrecognized":"value"}',
		]) {
			request.mockReturnValue(value);
			expect(() => store.read()).toThrow(
				"Invalid Wrangler credential in Automic Vault."
			);
		}
	});
	it("refuses credential access from a normal Node or npm installation", ({
		expect,
	}) => {
		isSea.mockReturnValue(false);
		const store = new AutomicVaultCredentialStore(directory);
		expect(() => store.read()).toThrow("signed Wrangler Isotope");
		expect(() => store.write({ oauth_token: "secret" })).toThrow(
			"signed Wrangler Isotope"
		);
		expect(() => store.clear()).toThrow("signed Wrangler Isotope");
		expect(request).not.toHaveBeenCalled();
	});
	it("does not collapse distinct profile names", ({ expect }) => {
		const names = ["work-a", "work_a", "Work-a"];
		expect(
			new Set(
				names.map((name) =>
					new AutomicVaultCredentialStore(directory, name).path()
				)
			).size
		).toBe(names.length);
		expect(
			() => new AutomicVaultCredentialStore(directory, "../outside")
		).toThrow();
	});
});

it.skipIf(process.platform !== "darwin")(
	"selects Vault lazily in the Isotope even when upstream keyring is disabled",
	({ expect }) => {
		vi.stubEnv("CLOUDFLARE_AUTH_USE_KEYRING", "false");
		const { getActiveStore } = createCredentialStorageContext({
			serviceName: "wrangler",
			getConfigPath: () => directory,
			isKeyringEnabled: () => false,
			logger: { log: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
			isNonInteractiveOrCI: () => true,
		});
		expect(getActiveStore().kind).toBe("automic-vault");
		expect(request).not.toHaveBeenCalled();
		isSea.mockReturnValue(false);
		expect(getActiveStore().kind).toBe("file");
	}
);
