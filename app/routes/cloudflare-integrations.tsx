// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowLeftIcon, CloudArrowUpIcon, LinkBreakIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Spinner } from "~/components/ui/spinner";
import api from "~/services/api";

export default function CloudflareIntegrationsRoute() {
	const navigate = useNavigate();
	const [params] = useSearchParams();
	const [selected, setSelected] = useState<string[]>([]);
	const [working, setWorking] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(params.get("error"));
	const domainsQuery = useQuery({ queryKey: ["domains"], queryFn: api.listDomains });
	const integrationsQuery = useQuery({ queryKey: ["cloudflare-integrations"], queryFn: api.listCloudflareIntegrations });
	const connectedDomains = useMemo(() => new Set((integrationsQuery.data ?? []).flatMap((item) => item.domains)), [integrationsQuery.data]);
	const available = (domainsQuery.data ?? []).filter((domain) => !connectedDomains.has(domain.domain));

	const redirect = async (action: () => Promise<{ authorizationUrl: string }>, key: string) => {
		setWorking(key); setError(null);
		try { const { authorizationUrl } = await action(); window.location.assign(authorizationUrl); }
		catch (cause) { setError(cause instanceof Error ? cause.message : "Cloudflare authorization could not be started"); setWorking(null); }
	};

	if (domainsQuery.isLoading || integrationsQuery.isLoading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
	return <main className="min-h-screen bg-muted px-4 py-8 sm:py-12"><div className="mx-auto max-w-3xl">
		<header className="mb-8 flex items-start gap-3"><Button variant="ghost" size="icon" aria-label="Back" onClick={() => navigate("/domains")}><ArrowLeftIcon aria-hidden="true" /></Button><div><h1 className="text-2xl font-bold">Cloudflare accounts</h1><p className="mt-1 text-sm text-muted-foreground">Connect domains from other accounts without sharing API tokens.</p></div></header>
		{params.get("status") && <div className="mb-5 rounded-xl border border-green-300 bg-green-50 p-4 text-sm text-green-950">Cloudflare account {params.get("status")} successfully.</div>}
		{error && <div role="alert" className="mb-5 rounded-xl border border-destructive/30 bg-destructive/8 p-4 text-sm text-destructive-foreground">{error}</div>}

		<section className="mb-6 rounded-xl border border-border bg-card p-5 shadow-sm"><div className="mb-4 flex items-start gap-3"><CloudArrowUpIcon className="mt-0.5 size-6" aria-hidden="true" /><div><h2 className="font-semibold">Connect an account</h2><p className="mt-1 text-sm text-muted-foreground">Choose configured domains, then authorize the account that owns them. Domains in one connection must belong to the same Cloudflare account.</p></div></div>
			{available.length ? <div className="space-y-2">{available.map((item) => <label key={item.domain} className="flex cursor-pointer items-center gap-3 rounded-lg border border-border p-3 hover:bg-muted"><input type="checkbox" className="size-4 accent-foreground" checked={selected.includes(item.domain)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.domain] : current.filter((domain) => domain !== item.domain))} /><span className="font-medium">{item.domain}</span></label>)}</div> : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">Add a domain first, or all configured domains are already connected.</p>}
			<div className="mt-4 flex justify-end"><Button disabled={!selected.length || Boolean(working)} onClick={() => redirect(() => api.connectCloudflare(selected), "connect")}>{working === "connect" ? <Spinner className="size-4" /> : <ShieldCheckIcon aria-hidden="true" />}Authorize with Cloudflare</Button></div>
		</section>

		<section><h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Connected accounts</h2>{integrationsQuery.data?.length ? <div className="space-y-3">{integrationsQuery.data.map((integration) => <div key={integration.id} className="rounded-xl border border-border bg-card p-5 shadow-sm"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center"><div><div className="flex items-center gap-2"><h3 className="font-semibold">{integration.accountName}</h3><Badge variant="success">Connected</Badge></div><p className="mt-1 text-xs text-muted-foreground">{integration.domains.join(", ")}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{integration.scriptName}</p></div><Button variant="secondary" disabled={Boolean(working)} onClick={() => redirect(() => api.disconnectCloudflare(integration.id), integration.id)}>{working === integration.id ? <Spinner className="size-4" /> : <LinkBreakIcon aria-hidden="true" />}Remove integration</Button></div></div>)}</div> : <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No Cloudflare accounts connected yet.</p>}</section>
	</div></main>;
}
