// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

export const RELAY_MAX_EMAIL_SIZE = 25 * 1024 * 1024;
export const RELAY_MAX_CLOCK_SKEW_SECONDS = 300;
export const RELAY_HEADERS = {
	id: "X-Agentic-Relay-Id", timestamp: "X-Agentic-Relay-Timestamp",
	nonce: "X-Agentic-Relay-Nonce", signature: "X-Agentic-Relay-Signature",
	from: "X-Agentic-Envelope-From", to: "X-Agentic-Envelope-To",
} as const;

export interface RelayVerificationConfig { publicKey: string; domains: string[] }
interface RelayMetadata { id: string; timestamp: string; nonce: string; from: string; to: string; signature: string }
export type RelayAuthenticationResult =
	| { ok: true; metadata: Omit<RelayMetadata, "signature"> }
	| { ok: false; status: 400 | 401 | 403; error: string };

function decodeBase64Url(value: string): ArrayBuffer {
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
	return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer as ArrayBuffer;
}
function encodeBase64Url(value: ArrayBuffer): string {
	let binary = "";
	for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(value: ArrayBuffer) { return encodeBase64Url(await crypto.subtle.digest("SHA-256", value)); }
export function relaySignaturePayload(metadata: Omit<RelayMetadata, "signature">, digest: string) {
	return ["v1", metadata.id, metadata.timestamp, metadata.nonce, metadata.from, metadata.to, digest].join("\n");
}

export async function authenticateRelayRequest(request: Request, body: ArrayBuffer, config: RelayVerificationConfig | null): Promise<RelayAuthenticationResult> {
	const metadata: RelayMetadata = {
		id: request.headers.get(RELAY_HEADERS.id)?.trim() ?? "",
		timestamp: request.headers.get(RELAY_HEADERS.timestamp)?.trim() ?? "",
		nonce: request.headers.get(RELAY_HEADERS.nonce)?.trim() ?? "",
		signature: request.headers.get(RELAY_HEADERS.signature)?.trim() ?? "",
		from: request.headers.get(RELAY_HEADERS.from)?.trim().toLowerCase() ?? "",
		to: request.headers.get(RELAY_HEADERS.to)?.trim().toLowerCase() ?? "",
	};
	if (!/^[a-zA-Z0-9_-]{1,64}$/.test(metadata.id) || !/^[a-zA-Z0-9_-]{16,128}$/.test(metadata.nonce) || !metadata.from || !metadata.to || !metadata.timestamp || !metadata.signature) {
		return { ok: false, status: 400, error: "Invalid relay metadata" };
	}
	const timestamp = Number(metadata.timestamp), now = Math.floor(Date.now() / 1000);
	if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > RELAY_MAX_CLOCK_SKEW_SECONDS) return { ok: false, status: 401, error: "Relay request timestamp is expired" };
	if (!config) return { ok: false, status: 401, error: "Invalid relay credentials" };
	const recipientDomain = metadata.to.split("@")[1];
	if (!recipientDomain || !config.domains.includes(recipientDomain)) return { ok: false, status: 403, error: "Relay is not authorized for this recipient domain" };
	try {
		if (!metadata.signature.startsWith("v1=")) throw new Error("version");
		const publicKey = decodeBase64Url(config.publicKey);
		const signature = decodeBase64Url(metadata.signature.slice(3));
		if (publicKey.byteLength !== 32 || signature.byteLength !== 64) throw new Error("length");
		const key = await crypto.subtle.importKey("raw", publicKey, "Ed25519", false, ["verify"]);
		const valid = await crypto.subtle.verify("Ed25519", key, signature, new TextEncoder().encode(relaySignaturePayload(metadata, await sha256(body))));
		if (!valid) throw new Error("signature");
	} catch {
		return { ok: false, status: 401, error: "Invalid relay credentials" };
	}
	return { ok: true, metadata: { id: metadata.id, timestamp: metadata.timestamp, nonce: metadata.nonce, from: metadata.from, to: metadata.to } };
}
