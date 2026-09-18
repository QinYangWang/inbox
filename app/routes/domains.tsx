// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Badge, Button, Dialog, Empty, Input, Loader, Text, useKumoToastManager } from "@cloudflare/kumo";
import { ArrowLeftIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { queryKeys } from "~/queries/keys";
import api from "~/services/api";

export default function DomainsRoute() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const toast = useKumoToastManager();
	const { data: domains = [], isLoading } = useQuery({ queryKey: queryKeys.domains.all, queryFn: api.listDomains });
	const { data: encryptionStatus } = useQuery({ queryKey: queryKeys.domains.encryption, queryFn: api.getEncryptionStatus, retry: false });
	const [open, setOpen] = useState(false);
	const [domain, setDomain] = useState("");
	const [error, setError] = useState<string | null>(null);
	const create = useMutation({ mutationFn: api.createDomain, onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }); setOpen(false); setDomain(""); toast.add({ title: "Domain added" }); } });
	const remove = useMutation({ mutationFn: api.deleteDomain, onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.domains.all }) });
	const migrate = useMutation({
		mutationFn: api.migrateEncryptionMaster,
		onSuccess: async (status) => {
			queryClient.setQueryData(queryKeys.domains.encryption, status);
			await queryClient.invalidateQueries({ queryKey: ["encryption-health"] });
			toast.add({ title: `Encryption master migrated to ${status.active.toUpperCase()}` });
		},
		onError: (err) => toast.add({ title: err instanceof Error ? err.message : "Migration failed", variant: "error" }),
	});
	const submit = async (event: FormEvent) => { event.preventDefault(); setError(null); try { await create.mutateAsync(domain); } catch (err) { setError(err instanceof Error ? err.message : "Could not add domain"); } };

	return <div className="min-h-screen bg-kumo-recessed"><div className="mx-auto max-w-3xl px-4 py-8 md:py-14">
		<div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-3"><Button variant="ghost" shape="square" icon={<ArrowLeftIcon />} onClick={() => navigate("/")} aria-label="Back" /><div><h1 className="text-2xl font-bold text-kumo-default">Domains</h1><p className="text-sm text-kumo-subtle">Manage routing, allowed addresses, and sending providers.</p></div></div><Button variant="primary" icon={<PlusIcon />} onClick={() => setOpen(true)}>Add domain</Button></div>
		{encryptionStatus && <div className="mb-6 flex items-center justify-between rounded-xl border border-kumo-line bg-kumo-base p-5"><div><div className="flex items-center gap-2 font-medium text-kumo-default">Encryption master <Badge variant="primary">{encryptionStatus.active.toUpperCase()}</Badge></div><p className="mt-1 text-xs text-kumo-subtle">Server-generated private keys are encrypted with the active master secret.</p></div><Button variant="secondary" disabled={!encryptionStatus.canMigrate} loading={migrate.isPending} onClick={() => migrate.mutate()}>Migrate to {encryptionStatus.target.toUpperCase()}</Button></div>}
		{isLoading ? <div className="flex justify-center py-20"><Loader /></div> : domains.length ? <div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">{domains.map((item, index) => <Link key={item.domain} to={`/domains/${item.domain}`} className={`flex items-center gap-4 px-5 py-4 no-underline hover:bg-kumo-tint ${index ? "border-t border-kumo-line" : ""}`}><GlobeIcon size={22} className="text-kumo-subtle" /><div className="flex-1"><div className="font-medium text-kumo-default">{item.domain}</div><div className="mt-1 flex gap-2"><Badge variant="secondary">Receive: Cloudflare</Badge><Badge variant={item.outboundProvider === "none" ? "secondary" : "primary"}>Send: {item.outboundProvider === "none" ? "Off" : item.outboundProvider}</Badge></div></div><Button variant="ghost" shape="square" icon={<TrashIcon />} aria-label={`Delete ${item.domain}`} loading={remove.isPending} onClick={async (event) => { event.preventDefault(); if (confirm(`Delete ${item.domain}? Mailboxes are not deleted.`)) await remove.mutateAsync(item.domain); }} /></Link>)}</div> : <div className="rounded-xl border border-kumo-line bg-kumo-base py-16"><Empty icon={<GlobeIcon size={44} />} title="No domains" description="Add a domain configured with Cloudflare Email Routing." /></div>}
	</div>
	<Dialog.Root open={open} onOpenChange={setOpen}><Dialog size="sm" className="p-6"><Dialog.Title className="mb-5 font-semibold">Add domain</Dialog.Title><form className="space-y-4" onSubmit={submit}>{error && <Text variant="error">{error}</Text>}<Input label="Domain" placeholder="example.com" value={domain} onChange={(e) => setDomain(e.target.value)} required /><p className="text-xs text-kumo-subtle">Configure a catch-all Email Routing rule for this domain to point to this Worker.</p><div className="flex justify-end gap-2"><Dialog.Close render={(props) => <Button {...props} variant="secondary">Cancel</Button>} /><Button type="submit" variant="primary" loading={create.isPending}>Add</Button></div></form></Dialog></Dialog.Root>
	</div>;
}
