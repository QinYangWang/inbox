// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Input, Loader, Select, Text, Textarea, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { DomainConfig } from "~/types";

function pemBytes(pem: string): Uint8Array {
	const value = pem.replace(/\\n/g, "").replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

function toBase64(value: ArrayBuffer | Uint8Array): string {
	const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function encryptApiKey(apiKey: string, domain: string, publicKeyPem: string, keyId: string): Promise<string> {
	const wrappingKey = await crypto.subtle.importKey(
		"spki",
		pemBytes(publicKeyPem).buffer as ArrayBuffer,
		{ name: "RSA-OAEP", hash: "SHA-256" },
		false,
		["wrapKey"],
	);
	const dataKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const aad = new TextEncoder().encode(`agentic-inbox:domain-secret:${domain.toLowerCase()}:resend:v1`);
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: aad },
		dataKey,
		new TextEncoder().encode(apiKey),
	);
	const wrappedKey = await crypto.subtle.wrapKey("raw", dataKey, wrappingKey, { name: "RSA-OAEP" });
	return JSON.stringify({
		version: 1,
		keyId,
		keyAlgorithm: "RSA-OAEP-256",
		dataAlgorithm: "A256GCM",
		wrappedKey: toBase64(wrappedKey),
		iv: toBase64(iv),
		ciphertext: toBase64(ciphertext),
	});
}

export default function DomainSettingsRoute() {
	const { domain = "" } = useParams<{ domain: string }>();
	const navigate = useNavigate();
	const toast = useKumoToastManager();
	const queryClient = useQueryClient();
	const { data: config, isLoading } = useQuery({ queryKey: queryKeys.domains.detail(domain), queryFn: () => api.getDomain(domain), enabled: Boolean(domain) });
	const [addresses, setAddresses] = useState("");
	const [provider, setProvider] = useState<DomainConfig["outboundProvider"]>("none");
	const [apiKey, setApiKey] = useState("");
	const [removeKey, setRemoveKey] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => { if (config) { setAddresses(config.emailAddresses.join("\n")); setProvider(config.outboundProvider); } }, [config]);

	const save = async (event: FormEvent) => {
		event.preventDefault(); setSaving(true); setError(null);
		try {
			let resendApiKeyEncrypted: string | undefined;
			if (apiKey.trim()) {
				const { publicKey, keyId } = await api.getDomainEncryptionKey();
				resendApiKeyEncrypted = await encryptApiKey(apiKey.trim(), domain, publicKey, keyId);
			}
			const emailAddresses = [...new Set(addresses.split(/[\n,]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
			await api.updateDomain(domain, { emailAddresses, outboundProvider: provider, resendApiKeyEncrypted, removeResendApiKey: removeKey });
			await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }), queryClient.invalidateQueries({ queryKey: queryKeys.domains.detail(domain) })]);
			setApiKey(""); setRemoveKey(false); toast.add({ title: "Domain settings saved" });
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to save domain"); }
		finally { setSaving(false); }
	};

	if (isLoading || !config) return <div className="flex min-h-screen items-center justify-center"><Loader /></div>;
	return <div className="min-h-screen bg-kumo-recessed"><div className="mx-auto max-w-2xl px-4 py-8 md:py-14">
		<div className="mb-8 flex items-center gap-3"><Button variant="ghost" shape="square" icon={<ArrowLeftIcon />} onClick={() => navigate("/domains")} aria-label="Back" /><div><h1 className="text-2xl font-bold text-kumo-default">{domain}</h1><p className="text-sm text-kumo-subtle">Domain configuration</p></div></div>
		<form className="space-y-6" onSubmit={save}>{error && <Text variant="error">{error}</Text>}
			<section className="rounded-xl border border-kumo-line bg-kumo-base p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Receiving provider</h2><Badge variant="primary">Enabled</Badge></div><Input label="Provider" value="Cloudflare Email Routing" disabled /><p className="mt-2 text-xs text-kumo-subtle">Incoming mail is received through the catch-all Email Routing rule configured in Cloudflare.</p></section>
			<section className="rounded-xl border border-kumo-line bg-kumo-base p-5"><h2 className="mb-4 font-medium">Allowed email addresses</h2><Textarea aria-label="Allowed email addresses" rows={6} placeholder={`alice@${domain}\nbob@${domain}`} value={addresses} onChange={(e) => setAddresses(e.target.value)} /><p className="mt-2 text-xs text-kumo-subtle">One address per line. Leave empty to allow any address on this domain. This limits both mailbox creation and incoming delivery.</p></section>
			<section className="rounded-xl border border-kumo-line bg-kumo-base p-5"><h2 className="mb-4 font-medium">Sending provider</h2><Select aria-label="Sending provider" value={provider} onValueChange={(value) => value && setProvider(value as DomainConfig["outboundProvider"])}><Select.Option value="none">Off (default)</Select.Option><Select.Option value="cloudflare">Cloudflare Email Service</Select.Option><Select.Option value="resend">Resend</Select.Option></Select>
				{provider === "cloudflare" && <p className="mt-3 text-xs text-kumo-subtle">Uses the Worker's <code>EMAIL</code> send_email binding.</p>}
				{provider === "resend" && <div className="mt-4 space-y-2"><Input label="Resend API key" type="password" placeholder={config.hasResendApiKey ? "Saved — enter a new key to replace it" : "re_..."} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setRemoveKey(false); }} /><p className="text-xs text-kumo-subtle">The key is encrypted in your browser with a random AES-256-GCM key. RSA-OAEP wraps that key, and only the Worker private key can unwrap it.</p>{config.hasResendApiKey && <Button type="button" variant="ghost" size="sm" onClick={() => { setApiKey(""); setRemoveKey(true); }}>Remove saved key</Button>}{removeKey && <Text variant="error" size="sm">The saved key will be removed when you save.</Text>}</div>}
			</section>
			<div className="flex justify-end"><Button type="submit" variant="primary" loading={saving}>Save changes</Button></div>
		</form>
	</div></div>;
}
