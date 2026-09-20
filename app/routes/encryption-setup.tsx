// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowClockwiseIcon, CheckCircleIcon, CopyIcon, KeyIcon, ShieldCheckIcon, WarningIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import api from "~/services/api";

function generateSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

async function copy(value: string, label: string) {
	await navigator.clipboard.writeText(value);
	toastManager.add({ title: `${label} copied` });
}

export default function EncryptionSetupRoute() {
	const navigate = useNavigate();
	const location = useLocation();
	const returnTo = (location.state as { from?: string } | null)?.from;
	const [secret, setSecret] = useState("");
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: ["encryption-health"],
		queryFn: api.getEncryptionHealth,
		staleTime: 0,
		retry: false,
	});
	const version = data?.active ?? "v1";
	const variableName = `DOMAIN_ENCRYPTION_MASTER_${version.toUpperCase()}`;
	const productionCommand = `npx wrangler secret put ${variableName}`;
	const localValue = `${variableName}=${secret}`;

	useEffect(() => {
		setSecret(generateSecret());
	}, []);

	const status = useMemo(() => {
		if (data?.healthy) return { label: "Configured", tone: "success" as const };
		if (isError) return { label: "Check unavailable", tone: "warning" as const };
		return { label: "Setup required", tone: "warning" as const };
	}, [data?.healthy, isError]);

	return (
		<main className="min-h-screen bg-muted px-4 py-8 sm:py-14">
			<div className="mx-auto max-w-3xl">
				<header className="mb-8 text-center">
					<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
						<ShieldCheckIcon className="size-6" aria-hidden="true" />
					</div>
					<div className="mb-3 flex items-center justify-center gap-2">
						<h1 className="text-2xl font-bold sm:text-3xl">Configure encryption</h1>
						<Badge variant={status.tone}>{status.label}</Badge>
					</div>
					<p className="mx-auto max-w-xl text-sm text-muted-foreground sm:text-base">
						Agentic Inbox needs a private 32-byte master secret to protect provider credentials and server-generated private keys.
					</p>
				</header>

				{data?.healthy ? (
					<section className="rounded-xl border border-border bg-card p-6 text-center shadow-sm">
						<CheckCircleIcon className="mx-auto mb-3 size-9 text-green-600" aria-hidden="true" />
						<h2 className="text-lg font-semibold">Encryption is ready</h2>
						<p className="mt-1 text-sm text-muted-foreground">{variableName} is configured and can decrypt the server key.</p>
						<Button className="mt-5" onClick={() => navigate(returnTo?.startsWith("/") ? returnTo : "/")}>Continue to mailboxes</Button>
					</section>
				) : (
					<div className="space-y-4">
						{(data?.message || isError) && (
							<div role="alert" className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
								<WarningIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
								<div><p className="font-medium">Encryption is not ready</p><p className="mt-0.5 break-words text-sm">{data?.message ?? "The Worker could not verify the encryption configuration. Confirm the service is running, then try again."}</p></div>
							</div>
						)}

						<section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
							<div className="mb-4 flex items-start gap-3"><Badge>1</Badge><div><h2 className="font-semibold">Generate a master secret</h2><p className="mt-1 text-sm text-muted-foreground">Generated locally in this browser with the Web Crypto API. It is never sent to this application.</p></div></div>
							<div className="flex flex-col gap-2 sm:flex-row">
								<Input aria-label="Generated encryption secret" className="font-mono text-xs" value={secret} readOnly />
								<div className="flex gap-2">
									<Button variant="secondary" size="icon" aria-label="Generate a new secret" onClick={() => setSecret(generateSecret())}><ArrowClockwiseIcon aria-hidden="true" /></Button>
									<Button variant="secondary" className="flex-1 sm:flex-none" disabled={!secret} onClick={() => copy(secret, "Secret")}><CopyIcon aria-hidden="true" />Copy secret</Button>
								</div>
							</div>
							<p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground"><KeyIcon className="mt-0.5 shrink-0" aria-hidden="true" />Store this value securely. Replacing or losing it can make existing encrypted provider keys unavailable.</p>
						</section>

						<section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
							<div className="mb-4 flex items-start gap-3"><Badge>2</Badge><div><h2 className="font-semibold">Save it as a Cloudflare secret</h2><p className="mt-1 text-sm text-muted-foreground">Run this command from the project directory, then paste the generated secret when Wrangler prompts you.</p></div></div>
							<div className="flex items-center gap-2 rounded-lg bg-muted p-3"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs sm:text-sm">{productionCommand}</code><Button variant="ghost" size="icon-sm" aria-label="Copy Wrangler command" onClick={() => copy(productionCommand, "Command")}><CopyIcon aria-hidden="true" /></Button></div>
							<p className="mt-3 text-xs text-muted-foreground">For local development, add <code>{variableName}</code> to <code>.dev.vars</code>. Never commit that file or the generated value.</p>
							<div className="mt-3 flex items-center gap-2 rounded-lg border border-border p-3"><code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-xs">{localValue}</code><Button variant="ghost" size="icon-sm" aria-label="Copy local environment value" disabled={!secret} onClick={() => copy(localValue, "Local environment value")}><CopyIcon aria-hidden="true" /></Button></div>
						</section>

						<section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
							<div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center"><div className="flex items-start gap-3"><Badge>3</Badge><div><h2 className="font-semibold">Verify the configuration</h2><p className="mt-1 text-sm text-muted-foreground">After Wrangler updates the Worker secret, check that the active key can be decrypted.</p></div></div><Button onClick={() => refetch()} disabled={isFetching}>{isFetching ? <Spinner className="size-4" /> : <ArrowClockwiseIcon aria-hidden="true" />}Check again</Button></div>
						</section>
					</div>
				)}
			</div>
		</main>
	);
}
