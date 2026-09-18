// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";
import type { DomainConfig } from "~/types";

const OUTBOUND_PROVIDERS: { label: string; value: DomainConfig["outboundProvider"] }[] = [
	{ label: "Off (default)", value: "none" },
	{ label: "Cloudflare Email Service", value: "cloudflare" },
	{ label: "Resend", value: "resend" },
];

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
			setApiKey(""); setRemoveKey(false); toastManager.add({ title: "Domain settings saved" });
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to save domain"); }
		finally { setSaving(false); }
	};

	if (isLoading || !config) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
	return <div className="min-h-screen bg-muted"><div className="mx-auto max-w-2xl px-4 py-8 md:py-14">
		<div className="mb-8 flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => navigate("/domains")} aria-label="Back"><ArrowLeftIcon aria-hidden="true" /></Button><div><h1 className="text-2xl font-bold text-foreground">{domain}</h1><p className="text-sm text-muted-foreground">Domain configuration</p></div></div>
		<form className="flex flex-col gap-6" onSubmit={save}>{error && <p className="text-sm text-destructive-foreground">{error}</p>}
			<section className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between"><h2 className="font-medium">Receiving provider</h2><Badge>Enabled</Badge></div><Field><FieldLabel>Provider</FieldLabel><Input value="Cloudflare Email Routing" disabled /></Field><p className="mt-2 text-xs text-muted-foreground">Incoming mail is received through the catch-all Email Routing rule configured in Cloudflare.</p></section>
			<section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-medium">Allowed email addresses</h2><Textarea aria-label="Allowed email addresses" rows={6} placeholder={`alice@${domain}\nbob@${domain}`} value={addresses} onChange={(e) => setAddresses(e.target.value)} /><p className="mt-2 text-xs text-muted-foreground">One address per line. Leave empty to allow any address on this domain. This limits both mailbox creation and incoming delivery.</p></section>
			<section className="rounded-xl border border-border bg-card p-5"><h2 className="mb-4 font-medium">Sending provider</h2><Select items={OUTBOUND_PROVIDERS} value={provider} onValueChange={(value) => value && setProvider(value as DomainConfig["outboundProvider"])}><SelectTrigger aria-label="Sending provider"><SelectValue /></SelectTrigger><SelectPopup>{OUTBOUND_PROVIDERS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectPopup></Select>
				{provider === "cloudflare" && <p className="mt-3 text-xs text-muted-foreground">Uses the Worker's <code>EMAIL</code> send_email binding.</p>}
				{provider === "resend" && <div className="mt-4 flex flex-col gap-2"><Field><FieldLabel>Resend API key</FieldLabel><Input type="password" placeholder={config.hasResendApiKey ? "Saved — enter a new key to replace it" : "re_..."} value={apiKey} onChange={(e) => { setApiKey(e.target.value); setRemoveKey(false); }} /></Field><p className="text-xs text-muted-foreground">The key is encrypted in your browser with a random AES-256-GCM key. RSA-OAEP wraps that key, and only the Worker private key can unwrap it.</p>{config.hasResendApiKey && <Button type="button" variant="ghost" size="sm" onClick={() => { setApiKey(""); setRemoveKey(true); }}>Remove saved key</Button>}{removeKey && <p className="text-sm text-destructive-foreground">The saved key will be removed when you save.</p>}</div>}
			</section>
			<div className="flex justify-end"><Button type="submit" loading={saving}>Save changes</Button></div>
		</form>
	</div></div>;
}
