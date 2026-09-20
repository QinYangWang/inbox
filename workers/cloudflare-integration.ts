// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import type { CloudflareIntegration, CloudflareOAuthState, CloudflareRouteSnapshot, DomainConfigDO } from "./domain-config";
import type { Env } from "./types";

const AUTHORIZATION_URL = "https://dash.cloudflare.com/oauth2/auth";
const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";
const REVOKE_URL = "https://dash.cloudflare.com/oauth2/revoke";
const API_URL = "https://api.cloudflare.com/client/v4";

const RELAY_SOURCE = `const d=s=>{const n=s.replace(/-/g,"+").replace(/_/g,"/"),b=atob(n+"=".repeat((4-n.length%4)%4));return Uint8Array.from(b,c=>c.charCodeAt(0)).buffer};const e=b=>{let s="";for(const x of new Uint8Array(b))s+=String.fromCharCode(x);return btoa(s).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"")};export default{async email(m,v){if(m.rawSize<=0||m.rawSize>26214400)throw Error("Unsupported email size");const b=await new Response(m.raw).arrayBuffer();if(b.byteLength!==m.rawSize)throw Error("Email size mismatch");const f=m.from.trim().toLowerCase(),t=m.to.trim().toLowerCase(),ts=Math.floor(Date.now()/1000).toString(),n=crypto.randomUUID().replace(/-/g,"");const h=e(await crypto.subtle.digest("SHA-256",b)),p=["v1",v.RELAY_ID,ts,n,f,t,h].join("\\n"),k=await crypto.subtle.importKey("pkcs8",d(v.RELAY_PRIVATE_KEY),"Ed25519",false,["sign"]),s="v1="+e(await crypto.subtle.sign("Ed25519",k,new TextEncoder().encode(p)));const r=await fetch(v.CENTRAL_INGEST_URL,{method:"POST",headers:{"Content-Type":"message/rfc822","X-Agentic-Relay-Id":v.RELAY_ID,"X-Agentic-Relay-Timestamp":ts,"X-Agentic-Relay-Nonce":n,"X-Agentic-Relay-Signature":s,"X-Agentic-Envelope-From":f,"X-Agentic-Envelope-To":t},body:b});if(!r.ok)throw Error("Central ingestion rejected email: "+r.status)}}};`;

function b64url(value: ArrayBuffer | Uint8Array): string {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function requireOAuth(env: Env) {
	if (!env.CLOUDFLARE_OAUTH_CLIENT_ID || !env.CLOUDFLARE_OAUTH_CLIENT_SECRET || !env.CLOUDFLARE_OAUTH_REDIRECT_URI) throw new Error("Cloudflare OAuth is not configured");
	return { id: env.CLOUDFLARE_OAUTH_CLIENT_ID, secret: env.CLOUDFLARE_OAUTH_CLIENT_SECRET, redirect: env.CLOUDFLARE_OAUTH_REDIRECT_URI };
}
export async function createOAuthRequest(env: Env, stub: DurableObjectStub<DomainConfigDO>, input: { operation: "connect" | "disconnect"; domains?: string[]; integrationId?: string }) {
	const oauth = requireOAuth(env), state = b64url(crypto.getRandomValues(new Uint8Array(32))), verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
	const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
	await stub.createCloudflareOAuthState({ state, codeVerifier: verifier, operation: input.operation, domains: input.domains ?? [], integrationId: input.integrationId ?? null, expiresAt: Math.floor(Date.now() / 1000) + 600 });
	const url = new URL(AUTHORIZATION_URL); url.search = new URLSearchParams({ client_id: oauth.id, redirect_uri: oauth.redirect, response_type: "code", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
	return url.toString();
}
async function exchangeCode(env: Env, code: string, verifier: string): Promise<string> {
	const oauth = requireOAuth(env), body = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: oauth.redirect, code_verifier: verifier });
	const response = await fetch(TOKEN_URL, { method: "POST", headers: { Authorization: `Basic ${btoa(`${oauth.id}:${oauth.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body });
	const data = await response.json() as { access_token?: string; error_description?: string };
	if (!response.ok || !data.access_token) throw new Error(data.error_description || "Cloudflare OAuth token exchange failed");
	return data.access_token;
}
async function cf<T>(token: string, path: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_URL}${path}`, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options.headers } });
	const body = await response.json().catch(() => ({})) as { success?: boolean; result?: T; errors?: unknown };
	if (!response.ok || body.success === false) throw new Error(`Cloudflare API ${response.status}: ${JSON.stringify(body.errors ?? body)}`);
	return body.result as T;
}
async function revoke(env: Env, token: string) { const oauth = requireOAuth(env); await fetch(REVOKE_URL, { method: "POST", headers: { Authorization: `Basic ${btoa(`${oauth.id}:${oauth.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }) }).catch(() => undefined); }

interface Zone { id: string; name: string; account: { id: string; name: string } }
type RouteSnapshot = CloudflareRouteSnapshot;
async function deployWorker(token: string, accountId: string, scriptName: string, relayId: string, privateKey: string, ingestionUrl: string) {
	const form = new FormData();
	form.append("metadata", new Blob([JSON.stringify({ main_module: "index.js", compatibility_date: "2025-11-28", bindings: [
		{ type: "plain_text", name: "RELAY_ID", text: relayId }, { type: "plain_text", name: "CENTRAL_INGEST_URL", text: ingestionUrl },
	] })], { type: "application/json" }));
	form.append("index.js", new Blob([RELAY_SOURCE], { type: "application/javascript+module" }), "index.js");
	await cf(token, `/accounts/${accountId}/workers/scripts/${scriptName}`, { method: "PUT", body: form });
	await cf(token, `/accounts/${accountId}/workers/scripts/${scriptName}/secrets`, { method: "PUT", body: JSON.stringify({ name: "RELAY_PRIVATE_KEY", text: privateKey, type: "secret_text" }) });
}
async function restoreRoutes(token: string, snapshots: RouteSnapshot[], scriptName: string) {
	for (const item of [...snapshots].reverse()) {
		const body = item.catchAll ? { name: item.catchAll.name, enabled: item.catchAll.enabled, actions: item.catchAll.actions } : { name: "Catch-all address", enabled: false, actions: [{ type: "worker", value: [scriptName] }] };
		await cf(token, `/zones/${item.zoneId}/email/routing/rules/catch_all`, { method: "PUT", body: JSON.stringify(body) });
	}
}
async function connect(env: Env, stub: DurableObjectStub<DomainConfigDO>, token: string, state: CloudflareOAuthState): Promise<CloudflareIntegration> {
	for (const domain of state.domains) if (!await stub.get(domain)) throw new Error(`Domain ${domain} is no longer configured`);
	const existing = await stub.listCloudflareIntegrations();
	if (state.domains.some((domain) => existing.some((item) => item.domains.includes(domain)))) throw new Error("One or more domains are already connected");
	const zones: Zone[] = [];
	for (const domain of state.domains) {
		const found = await cf<Zone[]>(token, `/zones?name=${encodeURIComponent(domain)}`);
		if (found.length !== 1) throw new Error(`Could not uniquely resolve Cloudflare zone ${domain}`);
		zones.push(found[0]);
	}
	const accountId = zones[0]?.account.id;
	if (!accountId || zones.some((zone) => zone.account.id !== accountId)) throw new Error("Connect domains from one Cloudflare account at a time");
	const relayId = `oauth-${crypto.randomUUID()}`, scriptName = `agentic-inbox-${relayId}`;
	const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
	const publicKey = b64url(await crypto.subtle.exportKey("raw", pair.publicKey)), privateKey = b64url(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
	const snapshots: RouteSnapshot[] = [], origin = new URL(requireOAuth(env).redirect).origin;
	try {
		await deployWorker(token, accountId, scriptName, relayId, privateKey, `${origin}/api/v1/relay/email`);
		for (const zone of zones) {
			await cf(token, `/zones/${zone.id}/email/routing/enable`, { method: "POST", body: "{}" }).catch(() => undefined);
			const old = await cf<RouteSnapshot["catchAll"]>(token, `/zones/${zone.id}/email/routing/rules/catch_all`).catch(() => null);
			snapshots.push({ domain: zone.name, zoneId: zone.id, catchAll: old });
			await cf(token, `/zones/${zone.id}/email/routing/rules/catch_all`, { method: "PUT", body: JSON.stringify({ name: `Agentic Inbox relay (${relayId})`, enabled: true, actions: [{ type: "worker", value: [scriptName] }] }) });
		}
		await stub.upsertEmailRelay(relayId, publicKey, state.domains);
		return await stub.upsertCloudflareIntegration({ id: relayId, accountId, accountName: zones[0].account.name, scriptName, domains: state.domains, routeSnapshots: snapshots });
	} catch (error) {
		await restoreRoutes(token, snapshots, scriptName).catch(() => undefined);
		await cf(token, `/accounts/${accountId}/workers/scripts/${scriptName}`, { method: "DELETE" }).catch(() => undefined);
		await stub.deleteEmailRelay(relayId);
		throw error;
	}
}
async function disconnect(stub: DurableObjectStub<DomainConfigDO>, token: string, id: string) {
	const integration = await (stub as unknown as { getCloudflareIntegration(id: string): Promise<CloudflareIntegration | null> }).getCloudflareIntegration(id);
	if (!integration) throw new Error("Cloudflare integration not found");
	await restoreRoutes(token, integration.routeSnapshots as RouteSnapshot[], integration.scriptName);
	try { await cf(token, `/accounts/${integration.accountId}/workers/scripts/${integration.scriptName}`, { method: "DELETE" }); }
	catch (error) { if (!(error instanceof Error) || !error.message.includes(" 404:")) throw error; }
	await stub.deleteCloudflareIntegration(id);
}
export async function completeOAuth(env: Env, stub: DurableObjectStub<DomainConfigDO>, code: string, stateValue: string) {
	const state = await stub.consumeCloudflareOAuthState(stateValue); if (!state) throw new Error("OAuth request is invalid or expired");
	const token = await exchangeCode(env, code, state.codeVerifier);
	try { if (state.operation === "connect") return { operation: "connected", integration: await connect(env, stub, token, state) }; await disconnect(stub, token, state.integrationId!); return { operation: "disconnected" }; }
	finally { await revoke(env, token); }
}
