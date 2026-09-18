// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { ArrowLeftIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "~/components/ui/dialog";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "~/components/ui/empty";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

export default function DomainsRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { data: domains = [], isLoading } = useQuery({ queryKey: queryKeys.domains.all, queryFn: api.listDomains });
	const { data: encryptionStatus } = useQuery({ queryKey: queryKeys.domains.encryption, queryFn: api.getEncryptionStatus, retry: false });
	const [open, setOpen] = useState(false);
	const [domain, setDomain] = useState("");
	const [error, setError] = useState<string | null>(null);
	const create = useMutation({ mutationFn: api.createDomain, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }); setOpen(false); setDomain(""); toastManager.add({ title: "Domain added" }); } });
	const remove = useMutation({ mutationFn: api.deleteDomain, onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }) });
	const migrate = useMutation({
		mutationFn: api.migrateEncryptionMaster,
		onSuccess: async (status) => {
			queryClient.setQueryData(queryKeys.domains.encryption, status);
			await queryClient.invalidateQueries({ queryKey: ["encryption-health"] });
			toastManager.add({ title: `Encryption master migrated to ${status.active.toUpperCase()}` });
		},
		onError: (err) => toastManager.add({ title: err instanceof Error ? err.message : "Migration failed", type: "error" }),
	});
	const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); try { await create.mutateAsync(domain); } catch (err) { setError(err instanceof Error ? err.message : "Could not add domain"); } };

	return <div className="min-h-screen bg-muted"><div className="mx-auto max-w-3xl px-4 py-8 md:py-14">
		<div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-3"><Button variant="ghost" size="icon" onClick={() => navigate("/")} aria-label="Back"><ArrowLeftIcon aria-hidden="true" /></Button><div><h1 className="text-2xl font-bold text-foreground">Domains</h1><p className="text-sm text-muted-foreground">Manage routing, allowed addresses, and sending providers.</p></div></div><Button onClick={() => setOpen(true)}><PlusIcon aria-hidden="true" />Add domain</Button></div>
		{encryptionStatus && <div className="mb-6 flex items-center justify-between rounded-xl border border-border bg-card p-5"><div><div className="flex items-center gap-2 font-medium text-foreground">Encryption master <Badge>{encryptionStatus.active.toUpperCase()}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Server-generated private keys are encrypted with the active master secret.</p></div><Button variant="secondary" disabled={!encryptionStatus.canMigrate} loading={migrate.isPending} onClick={() => migrate.mutate()}>Migrate to {encryptionStatus.target.toUpperCase()}</Button></div>}
		{isLoading ? <div className="flex justify-center py-20"><Spinner /></div> : domains.length ? <div className="overflow-hidden rounded-xl border border-border bg-card">{domains.map((item, index) => <Link key={item.domain} to={`/domains/${item.domain}`} className={`flex items-center gap-4 px-5 py-4 no-underline hover:bg-accent ${index ? "border-t border-border" : ""}`}><GlobeIcon size={22} className="text-muted-foreground" /><div className="flex-1"><div className="font-medium text-foreground">{item.domain}</div><div className="mt-1 flex gap-2"><Badge variant="secondary">Receive: Cloudflare</Badge><Badge variant={item.outboundProvider === "none" ? "secondary" : "default"}>Send: {item.outboundProvider === "none" ? "Off" : item.outboundProvider}</Badge></div></div><Button variant="ghost" size="icon" aria-label={`Delete ${item.domain}`} loading={remove.isPending} onClick={async (event) => { event.preventDefault(); if (confirm(`Delete ${item.domain}? Mailboxes are not deleted.`)) await remove.mutateAsync(item.domain); }}><TrashIcon aria-hidden="true" /></Button></Link>)}</div> : <div className="rounded-xl border border-border bg-card py-16"><Empty><EmptyHeader><EmptyMedia variant="icon"><GlobeIcon aria-hidden="true" /></EmptyMedia><EmptyTitle>No domains</EmptyTitle><EmptyDescription>Add a domain configured with Cloudflare Email Routing.</EmptyDescription></EmptyHeader></Empty></div>}
	</div>
	<Dialog open={open} onOpenChange={setOpen}>
		<DialogPopup className="sm:max-w-md">
			<DialogHeader>
				<DialogTitle>Add domain</DialogTitle>
			</DialogHeader>
			<form onSubmit={submit} className="contents">
				<DialogPanel className="flex flex-col gap-4">
					{error && <p className="text-sm text-destructive-foreground">{error}</p>}
					<Field>
						<FieldLabel>Domain</FieldLabel>
						<Input placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required />
					</Field>
					<p className="text-xs text-muted-foreground">Configure a catch-all Email Routing rule for this domain to point to this Worker.</p>
				</DialogPanel>
				<DialogFooter>
					<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
					<Button type="submit" loading={create.isPending}>Add</Button>
				</DialogFooter>
			</form>
		</DialogPopup>
	</Dialog>
	</div>;
}
