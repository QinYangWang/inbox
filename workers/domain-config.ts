// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { DurableObject } from "cloudflare:workers";
import type { Env } from "./types";

export type OutboundProvider = "none" | "cloudflare" | "resend";
export type InboundProvider = "cloudflare";
export type MasterVersion = "v1" | "v2";

export interface StoredDomainConfig {
	domain: string;
	emailAddresses: string[];
	inboundProvider: InboundProvider;
	outboundProvider: OutboundProvider;
	resendApiKeyEncrypted: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface DomainConfig extends Omit<StoredDomainConfig, "resendApiKeyEncrypted"> {
	hasResendApiKey: boolean;
}

export interface EmailRelayConfig {
	id: string;
	publicKey: string;
	domains: string[];
	createdAt: string;
	updatedAt: string;
}

export interface CloudflareRouteSnapshot {
	domain: string;
	zoneId: string;
	catchAll: { name?: string; enabled: boolean; actions: Array<{ type: string; value: string[] }> } | null;
}

export interface CloudflareIntegration {
	id: string;
	accountId: string;
	accountName: string;
	scriptName: string;
	domains: string[];
	routeSnapshots: CloudflareRouteSnapshot[];
	createdAt: string;
}

export interface CloudflareOAuthState {
	state: string;
	codeVerifier: string;
	operation: "connect" | "disconnect";
	domains: string[];
	integrationId: string | null;
	expiresAt: number;
}

interface SecretEnvelopeV1 {
	version: 1;
	keyId: string;
	keyAlgorithm: "RSA-OAEP-256";
	dataAlgorithm: "A256GCM";
	wrappedKey: string;
	iv: string;
	ciphertext: string;
}

interface EncryptionState {
	keyId: string;
	publicKey: string;
	encryptedPrivateKey: string;
	iv: string;
	salt: string;
	masterVersion: MasterVersion;
}

const normaliseDomain = (value: string) => value.trim().toLowerCase().replace(/^@/, "");
const encodeBase64 = (value: ArrayBuffer | Uint8Array) => {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};
const decodeBase64 = (value: string): ArrayBuffer =>
	Uint8Array.from(atob(value), (char) => char.charCodeAt(0)).buffer as ArrayBuffer;

function bytesToPem(value: ArrayBuffer, label: string): string {
	const base64 = encodeBase64(value);
	const lines = base64.match(/.{1,64}/g)?.join("\n") ?? base64;
	return `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
}

function pemToBuffer(pem: string): ArrayBuffer {
	const base64 = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
	return decodeBase64(base64);
}

export class DomainConfigDO extends DurableObject<Env> {
	constructor(state: DurableObjectState, env: Env) {
		super(state, env);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS domains (
			domain TEXT PRIMARY KEY,
			email_addresses TEXT NOT NULL DEFAULT '[]',
			inbound_provider TEXT NOT NULL DEFAULT 'cloudflare',
			outbound_provider TEXT NOT NULL DEFAULT 'none',
			resend_api_key_encrypted TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS encryption_state (
			id INTEGER PRIMARY KEY CHECK (id = 1),
			key_id TEXT NOT NULL,
			public_key TEXT NOT NULL,
			encrypted_private_key TEXT NOT NULL,
			iv TEXT NOT NULL,
			salt TEXT NOT NULL,
			master_version TEXT NOT NULL CHECK (master_version IN ('v1', 'v2')),
			updated_at TEXT NOT NULL
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS relay_nonces (
			relay_id TEXT NOT NULL,
			nonce TEXT NOT NULL,
			expires_at INTEGER NOT NULL,
			PRIMARY KEY (relay_id, nonce)
		)`);
		this.ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS relay_nonces_expires_at ON relay_nonces (expires_at)");
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS email_relays (
			id TEXT PRIMARY KEY,
			public_key TEXT NOT NULL,
			domains TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS cloudflare_integrations (
			id TEXT PRIMARY KEY, account_id TEXT NOT NULL, account_name TEXT NOT NULL,
			script_name TEXT NOT NULL, domains TEXT NOT NULL, route_snapshots TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`);
		this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS cloudflare_oauth_states (
			state TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, operation TEXT NOT NULL,
			domains TEXT NOT NULL, integration_id TEXT, expires_at INTEGER NOT NULL
		)`);
	}

	getEmailRelay(id: string): EmailRelayConfig | null {
		const row = [...this.ctx.storage.sql.exec("SELECT * FROM email_relays WHERE id = ?", id)][0];
		return row ? { id: row.id as string, publicKey: row.public_key as string, domains: JSON.parse(row.domains as string), createdAt: row.created_at as string, updatedAt: row.updated_at as string } : null;
	}

	listEmailRelays(): EmailRelayConfig[] {
		return [...this.ctx.storage.sql.exec("SELECT * FROM email_relays ORDER BY id")].map((row) => ({ id: row.id as string, publicKey: row.public_key as string, domains: JSON.parse(row.domains as string), createdAt: row.created_at as string, updatedAt: row.updated_at as string }));
	}

	upsertEmailRelay(id: string, publicKey: string, domains: string[]): EmailRelayConfig {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(`INSERT INTO email_relays (id, public_key, domains, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET public_key = excluded.public_key, domains = excluded.domains, updated_at = excluded.updated_at`, id, publicKey, JSON.stringify(domains), now, now);
		return this.getEmailRelay(id)!;
	}

	deleteEmailRelay(id: string): boolean {
		if (!this.getEmailRelay(id)) return false;
		this.ctx.storage.sql.exec("DELETE FROM relay_nonces WHERE relay_id = ?", id);
		this.ctx.storage.sql.exec("DELETE FROM email_relays WHERE id = ?", id);
		return true;
	}

	listCloudflareIntegrations(): CloudflareIntegration[] {
		return [...this.ctx.storage.sql.exec("SELECT * FROM cloudflare_integrations ORDER BY created_at")].map((row) => ({ id: row.id as string, accountId: row.account_id as string, accountName: row.account_name as string, scriptName: row.script_name as string, domains: JSON.parse(row.domains as string), routeSnapshots: JSON.parse(row.route_snapshots as string), createdAt: row.created_at as string }));
	}
	getCloudflareIntegration(id: string): CloudflareIntegration | null { return this.listCloudflareIntegrations().find((item) => item.id === id) ?? null; }
	upsertCloudflareIntegration(value: Omit<CloudflareIntegration, "createdAt">): CloudflareIntegration {
		const now = new Date().toISOString();
		this.ctx.storage.sql.exec(`INSERT INTO cloudflare_integrations (id, account_id, account_name, script_name, domains, route_snapshots, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
			ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id, account_name=excluded.account_name, script_name=excluded.script_name, domains=excluded.domains, route_snapshots=excluded.route_snapshots`, value.id, value.accountId, value.accountName, value.scriptName, JSON.stringify(value.domains), JSON.stringify(value.routeSnapshots), now);
		return this.getCloudflareIntegration(value.id)!;
	}
	deleteCloudflareIntegration(id: string): void { this.ctx.storage.sql.exec("DELETE FROM cloudflare_integrations WHERE id = ?", id); this.deleteEmailRelay(id); }
	createCloudflareOAuthState(value: CloudflareOAuthState): void { this.ctx.storage.sql.exec("DELETE FROM cloudflare_oauth_states WHERE expires_at <= ?", Math.floor(Date.now() / 1000)); this.ctx.storage.sql.exec("INSERT INTO cloudflare_oauth_states (state, code_verifier, operation, domains, integration_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)", value.state, value.codeVerifier, value.operation, JSON.stringify(value.domains), value.integrationId, value.expiresAt); }
	consumeCloudflareOAuthState(state: string): CloudflareOAuthState | null {
		const row = [...this.ctx.storage.sql.exec("SELECT * FROM cloudflare_oauth_states WHERE state = ?", state)][0];
		this.ctx.storage.sql.exec("DELETE FROM cloudflare_oauth_states WHERE state = ?", state);
		if (!row || Number(row.expires_at) <= Math.floor(Date.now() / 1000)) return null;
		return { state: row.state as string, codeVerifier: row.code_verifier as string, operation: row.operation as "connect" | "disconnect", domains: JSON.parse(row.domains as string), integrationId: row.integration_id as string | null, expiresAt: Number(row.expires_at) };
	}

	claimRelayNonce(relayId: string, nonce: string, expiresAt: number): boolean {
		const now = Math.floor(Date.now() / 1000);
		this.ctx.storage.sql.exec("DELETE FROM relay_nonces WHERE expires_at <= ?", now);
		const exists = [...this.ctx.storage.sql.exec(
			"SELECT 1 FROM relay_nonces WHERE relay_id = ? AND nonce = ? LIMIT 1",
			relayId,
			nonce,
		)].length > 0;
		if (exists) return false;
		this.ctx.storage.sql.exec(
			"INSERT INTO relay_nonces (relay_id, nonce, expires_at) VALUES (?, ?, ?)",
			relayId,
			nonce,
			expiresAt,
		);
		return true;
	}

	releaseRelayNonce(relayId: string, nonce: string): void {
		this.ctx.storage.sql.exec(
			"DELETE FROM relay_nonces WHERE relay_id = ? AND nonce = ?",
			relayId,
			nonce,
		);
	}

	private master(version: MasterVersion): string | undefined {
		return version === "v1" ? this.env.DOMAIN_ENCRYPTION_MASTER_V1 : this.env.DOMAIN_ENCRYPTION_MASTER_V2;
	}

	private masterBytes(version: MasterVersion): ArrayBuffer {
		const name = `DOMAIN_ENCRYPTION_MASTER_${version.toUpperCase()}`;
		const secret = this.master(version)?.trim();
		if (!secret) throw new Error(`${name} is not configured`);
		try {
			const bytes = decodeBase64(secret);
			if (bytes.byteLength !== 32) throw new Error("wrong length");
			return bytes;
		} catch {
			throw new Error(`${name} must be a base64-encoded 32-byte random secret`);
		}
	}

	private hasValidMaster(version: MasterVersion): boolean {
		try { this.masterBytes(version); return true; } catch { return false; }
	}

	private async deriveMasterKey(version: MasterVersion, salt: ArrayBuffer, keyId: string): Promise<CryptoKey> {
		const material = await crypto.subtle.importKey("raw", this.masterBytes(version), "HKDF", false, ["deriveKey"]);
		return crypto.subtle.deriveKey(
			{ name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode(`agentic-inbox:rsa-private:${keyId}:${version}`) },
			material,
			{ name: "AES-GCM", length: 256 },
			false,
			["encrypt", "decrypt"],
		);
	}

	private readEncryptionState(): EncryptionState | null {
		const row = [...this.ctx.storage.sql.exec("SELECT * FROM encryption_state WHERE id = 1")][0];
		if (!row) return null;
		return {
			keyId: row.key_id as string,
			publicKey: row.public_key as string,
			encryptedPrivateKey: row.encrypted_private_key as string,
			iv: row.iv as string,
			salt: row.salt as string,
			masterVersion: row.master_version as MasterVersion,
		};
	}

	private async encryptPrivateKey(pkcs8: ArrayBuffer, version: MasterVersion, keyId: string) {
		const salt = crypto.getRandomValues(new Uint8Array(32));
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const key = await this.deriveMasterKey(version, salt.buffer as ArrayBuffer, keyId);
		const aad = new TextEncoder().encode(`agentic-inbox:rsa-private:${keyId}:${version}`);
		const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, key, pkcs8);
		return { encryptedPrivateKey: encodeBase64(ciphertext), iv: encodeBase64(iv), salt: encodeBase64(salt) };
	}

	private async decryptPrivateKey(state: EncryptionState): Promise<ArrayBuffer> {
		const key = await this.deriveMasterKey(state.masterVersion, decodeBase64(state.salt), state.keyId);
		const aad = new TextEncoder().encode(`agentic-inbox:rsa-private:${state.keyId}:${state.masterVersion}`);
		return crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: decodeBase64(state.iv), additionalData: aad },
			key,
			decodeBase64(state.encryptedPrivateKey),
		);
	}

	private async ensureEncryptionState(): Promise<EncryptionState> {
		const existing = this.readEncryptionState();
		if (existing) return existing;
		if (!this.env.DOMAIN_ENCRYPTION_MASTER_V1) throw new Error("DOMAIN_ENCRYPTION_MASTER_V1 is not configured");
		const pair = await crypto.subtle.generateKey(
			{ name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
			true,
			["wrapKey", "unwrapKey"],
		) as CryptoKeyPair;
		const keyId = `rsa-${crypto.randomUUID()}`;
		const [spki, pkcs8] = await Promise.all([
			crypto.subtle.exportKey("spki", pair.publicKey),
			crypto.subtle.exportKey("pkcs8", pair.privateKey),
		]);
		const encrypted = await this.encryptPrivateKey(pkcs8, "v1", keyId);
		new Uint8Array(pkcs8).fill(0);
		this.ctx.storage.sql.exec(
			`INSERT OR IGNORE INTO encryption_state
			 (id, key_id, public_key, encrypted_private_key, iv, salt, master_version, updated_at)
			 VALUES (1, ?, ?, ?, ?, ?, 'v1', ?)`,
			keyId, bytesToPem(spki, "PUBLIC KEY"), encrypted.encryptedPrivateKey,
			encrypted.iv, encrypted.salt, new Date().toISOString(),
		);
		return this.readEncryptionState()!;
	}

	async getEncryptionPublicConfig(): Promise<{ publicKey: string; keyId: string }> {
		const state = await this.ensureEncryptionState();
		return { publicKey: state.publicKey, keyId: state.keyId };
	}

	private async validateEncryptionState(state: EncryptionState): Promise<void> {
		const pkcs8 = await this.decryptPrivateKey(state);
		try {
			const [privateKey, publicKey] = await Promise.all([
				crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]),
				crypto.subtle.importKey("spki", pemToBuffer(state.publicKey), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]),
			]);
			const challenge = crypto.getRandomValues(new Uint8Array(32));
			const encrypted = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, publicKey, challenge);
			const decrypted = new Uint8Array(await crypto.subtle.decrypt({ name: "RSA-OAEP" }, privateKey, encrypted));
			if (!challenge.every((byte, index) => decrypted[index] === byte)) throw new Error("RSA key pair validation failed");
		} finally {
			new Uint8Array(pkcs8).fill(0);
		}
	}

	async checkEncryptionHealth(): Promise<{ healthy: boolean; active: MasterVersion; message?: string }> {
		const stored = this.readEncryptionState();
		const active = stored?.masterVersion ?? "v1";
		if (!this.hasValidMaster(active)) {
			return { healthy: false, active, message: `Active secret DOMAIN_ENCRYPTION_MASTER_${active.toUpperCase()} is missing or is not a base64-encoded 32-byte value` };
		}
		try {
			const state = stored ?? await this.ensureEncryptionState();
			await this.validateEncryptionState(state);
			return { healthy: true, active };
		} catch (error) {
			console.error("Encryption health check failed:", (error as Error).message);
			return {
				healthy: false,
				active,
				message: `DOMAIN_ENCRYPTION_MASTER_${active.toUpperCase()} cannot decrypt the server key. Restore the original secret before sending email.`,
			};
		}
	}

	async getMasterStatus() {
		const state = await this.ensureEncryptionState();
		const target: MasterVersion = state.masterVersion === "v1" ? "v2" : "v1";
		return {
			active: state.masterVersion,
			target,
			available: { v1: this.hasValidMaster("v1"), v2: this.hasValidMaster("v2") },
			canMigrate: this.hasValidMaster(target),
		};
	}

	async migrateMaster(): Promise<Awaited<ReturnType<DomainConfigDO["getMasterStatus"]>>> {
		const state = await this.ensureEncryptionState();
		const target: MasterVersion = state.masterVersion === "v1" ? "v2" : "v1";
		this.masterBytes(target); // Fail before decrypting anything if the target is absent or malformed.
		const pkcs8 = await this.decryptPrivateKey(state);
		const encrypted = await this.encryptPrivateKey(pkcs8, target, state.keyId);
		// Verify the newly encrypted value before replacing the recoverable copy.
		const candidate: EncryptionState = { ...state, ...encrypted, masterVersion: target };
		const verified = await this.decryptPrivateKey(candidate);
		await crypto.subtle.importKey("pkcs8", verified, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
		new Uint8Array(pkcs8).fill(0);
		new Uint8Array(verified).fill(0);
		this.ctx.storage.sql.exec(
			`UPDATE encryption_state SET encrypted_private_key = ?, iv = ?, salt = ?,
			 master_version = ?, updated_at = ? WHERE id = 1 AND master_version = ?`,
			encrypted.encryptedPrivateKey, encrypted.iv, encrypted.salt, target,
			new Date().toISOString(), state.masterVersion,
		);
		return this.getMasterStatus();
	}

	async decryptResendApiKey(domain: string, value: string): Promise<string> {
		const state = await this.ensureEncryptionState();
		const envelope = JSON.parse(value) as Partial<SecretEnvelopeV1>;
		if (envelope.version !== 1 || envelope.keyId !== state.keyId || envelope.keyAlgorithm !== "RSA-OAEP-256" ||
			envelope.dataAlgorithm !== "A256GCM" || typeof envelope.wrappedKey !== "string" ||
			typeof envelope.iv !== "string" || typeof envelope.ciphertext !== "string") {
			throw new Error("Unsupported or expired encrypted secret envelope");
		}
		const pkcs8 = await this.decryptPrivateKey(state);
		const privateKey = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["unwrapKey"]);
		new Uint8Array(pkcs8).fill(0);
		const dataKey = await crypto.subtle.unwrapKey(
			"raw", decodeBase64(envelope.wrappedKey), privateKey, { name: "RSA-OAEP" },
			{ name: "AES-GCM", length: 256 }, false, ["decrypt"],
		);
		const aad = new TextEncoder().encode(`agentic-inbox:domain-secret:${domain.toLowerCase()}:resend:v1`);
		const plaintext = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: decodeBase64(envelope.iv), additionalData: aad }, dataKey, decodeBase64(envelope.ciphertext),
		);
		return new TextDecoder().decode(plaintext);
	}

	private rowToConfig(row: Record<string, unknown>): StoredDomainConfig {
		return { domain: row.domain as string, emailAddresses: JSON.parse(row.email_addresses as string),
			inboundProvider: row.inbound_provider as InboundProvider, outboundProvider: row.outbound_provider as OutboundProvider,
			resendApiKeyEncrypted: (row.resend_api_key_encrypted as string | null) ?? null,
			createdAt: row.created_at as string, updatedAt: row.updated_at as string };
	}
	list(): StoredDomainConfig[] { return [...this.ctx.storage.sql.exec("SELECT * FROM domains ORDER BY domain")].map((row) => this.rowToConfig(row)); }
	get(domain: string): StoredDomainConfig | null { const rows = [...this.ctx.storage.sql.exec("SELECT * FROM domains WHERE domain = ?", normaliseDomain(domain))]; return rows[0] ? this.rowToConfig(rows[0]) : null; }
	create(domain: string): StoredDomainConfig { const value = normaliseDomain(domain); const now = new Date().toISOString(); this.ctx.storage.sql.exec("INSERT INTO domains (domain, created_at, updated_at) VALUES (?, ?, ?)", value, now, now); return this.get(value)!; }
	update(domain: string, input: { emailAddresses: string[]; outboundProvider: OutboundProvider; resendApiKeyEncrypted?: string; removeResendApiKey?: boolean }): StoredDomainConfig | null {
		const current = this.get(domain); if (!current) return null;
		const encryptedKey = input.removeResendApiKey ? null : input.resendApiKeyEncrypted ?? current.resendApiKeyEncrypted;
		this.ctx.storage.sql.exec(`UPDATE domains SET email_addresses = ?, outbound_provider = ?, resend_api_key_encrypted = ?, updated_at = ? WHERE domain = ?`, JSON.stringify(input.emailAddresses), input.outboundProvider, encryptedKey, new Date().toISOString(), current.domain);
		return this.get(current.domain);
	}
	delete(domain: string): boolean { const value = normaliseDomain(domain); if (!this.get(value)) return false; this.ctx.storage.sql.exec("DELETE FROM domains WHERE domain = ?", value); return true; }
}

export function getDomainConfigStub(env: Env): DurableObjectStub<DomainConfigDO> { return env.DOMAIN_CONFIG.get(env.DOMAIN_CONFIG.idFromName("global")); }
export function publicDomainConfig(config: StoredDomainConfig): DomainConfig { const { resendApiKeyEncrypted, ...safe } = config; return { ...safe, hasResendApiKey: Boolean(resendApiKeyEncrypted) }; }

export async function getOutboundConfig(env: Env, domain: string): Promise<{ provider: OutboundProvider; resendApiKey?: string }> {
	const stub = getDomainConfigStub(env);
	const config = await stub.get(domain);
	if (!config) throw new Error(`Domain ${domain} is not configured`);
	if (config.outboundProvider === "resend") {
		if (!config.resendApiKeyEncrypted) throw new Error("A Resend API key is not configured for this domain");
		return { provider: "resend", resendApiKey: await stub.decryptResendApiKey(domain, config.resendApiKeyEncrypted) };
	}
	if (config.outboundProvider === "cloudflare" && !(env as unknown as { EMAIL?: SendEmail }).EMAIL) throw new Error("Cloudflare Email Service is not bound; deploy with wrangler.cloudflare.toml");
	return { provider: config.outboundProvider };
}
