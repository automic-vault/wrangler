import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { UserError } from "@cloudflare/workers-utils";
import {
	getAuthConfigFilePath,
	resolveAuthProfileBaseName,
} from "./file-store";
import type { UserAuthConfig } from "../config-file/auth";
import type { CredentialStore } from "./interface";

interface VaultClient {
	request(
		operation: "keys" | "wrangler-save" | "wrangler-delete",
		key: string,
		value?: string
	): string | undefined;
}

/** Avoid bundlers stripping the required node: prefix from the SEA builtin. */
export function isIsotopeRuntime(): boolean {
	return process.getBuiltinModule?.("node:sea")?.isSea() === true;
}

function client(): VaultClient {
	if (!isIsotopeRuntime()) {
		throw new UserError(
			"Automic Vault credentials require the signed Wrangler Isotope installation.",
			{ telemetryMessage: "automic vault unsigned runtime refused" }
		);
	}
	const require = createRequire(process.execPath);
	return require(
		path.join(path.dirname(process.execPath), "../Resources/automic-vault.node")
	) as VaultClient;
}

/** OAuth credential storage for the signed Wrangler Isotope. */
export class AutomicVaultCredentialStore implements CredentialStore {
	readonly kind = "automic-vault" as const;
	private readonly key: string;

	constructor(
		private readonly configPath: string,
		private readonly profile?: string
	) {
		// Hex is reversible and collision-free: case and punctuation distinguish profiles.
		this.key = `WRANGLER_AUTH_${Buffer.from(resolveAuthProfileBaseName(profile), "utf8").toString("hex").toUpperCase()}`;
	}

	read(): UserAuthConfig | undefined {
		const value = client().request("keys", this.key);
		if (value === undefined) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(value);
		if (
			typeof parsed !== "object" ||
			parsed === null ||
			Array.isArray(parsed)
		) {
			throw new UserError("Invalid Wrangler credential in Automic Vault.", {
				telemetryMessage: "automic vault credential invalid",
			});
		}
		for (const [key, entry] of Object.entries(parsed)) {
			if (
				key === "scopes"
					? !Array.isArray(entry) ||
						!entry.every((scope) => typeof scope === "string")
					: ![
							"oauth_token",
							"refresh_token",
							"expiration_time",
							"api_token",
						].includes(key) || typeof entry !== "string"
			) {
				throw new UserError("Invalid Wrangler credential in Automic Vault.", {
					telemetryMessage: "automic vault credential invalid",
				});
			}
		}
		return parsed as UserAuthConfig;
	}

	write(config: UserAuthConfig): void {
		client().request("wrangler-save", this.key, JSON.stringify(config));
		const marker = getAuthConfigFilePath(this.configPath, this.profile);
		mkdirSync(path.dirname(marker), { recursive: true, mode: 0o700 });
		writeFileSync(marker, "# Credential stored in Automic Vault.\n", {
			mode: 0o600,
		});
	}

	clear(): boolean {
		const marker = getAuthConfigFilePath(this.configPath, this.profile);
		const existed = existsSync(marker);
		client().request("wrangler-delete", this.key);
		rmSync(marker, {
			force: true,
		});
		return existed;
	}

	path(): string {
		return `Automic Vault: ${this.key}`;
	}
	describe(): string {
		return this.path();
	}
}
