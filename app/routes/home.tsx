// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { Button, Dialog, Empty, Input, Loader, Select, Text, useKumoToastManager } from "@cloudflare/kumo";
import { EnvelopeIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import api from "~/services/api";
import { useCreateMailbox, useDeleteMailbox, useMailboxes } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";

export function meta() { return [{ title: "Agentic Inbox" }]; }

export default function HomeRoute() {
	const toast = useKumoToastManager();
	const navigate = useNavigate();
	const { data: mailboxes = [], isLoading: mailboxesLoading } = useMailboxes();
	const createMailbox = useCreateMailbox();
	const deleteMailbox = useDeleteMailbox();
	const { data: domainConfigs = [], isLoading: domainsLoading } = useQuery({
		queryKey: queryKeys.domains.all,
		queryFn: api.listDomains,
	});
	const domains = domainConfigs.map((item) => item.domain);

	const [isCreateOpen, setIsCreateOpen] = useState(false);
	const [newPrefix, setNewPrefix] = useState("");
	const [selectedDomain, setSelectedDomain] = useState("");
	const [newName, setNewName] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [mailboxToDelete, setMailboxToDelete] = useState<{ id: string; email: string } | null>(null);

	useEffect(() => {
		if (domains.length && !domains.includes(selectedDomain)) setSelectedDomain(domains[0]);
	}, [domains, selectedDomain]);

	const handleCreate = async (event: FormEvent) => {
		event.preventDefault();
		setError(null);
		try {
			await createMailbox.mutateAsync({
				email: `${newPrefix.trim()}@${selectedDomain}`,
				name: newName.trim() || newPrefix.trim(),
			});
			toast.add({ title: "Mailbox created" });
			setIsCreateOpen(false);
			setNewPrefix(""); setNewName("");
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to create mailbox"); }
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toast.add({ title: "Mailbox deleted" });
			setMailboxToDelete(null);
		} catch { toast.add({ title: "Failed to delete mailbox", variant: "error" }); }
	};

	const loading = mailboxesLoading || domainsLoading;
	return (
		<div className="min-h-screen bg-kumo-recessed">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8 flex items-center justify-between">
					<div><h1 className="text-2xl font-bold text-kumo-default">Mailboxes</h1><p className="mt-1 text-sm text-kumo-subtle">Send and receive mail for your configured domains.</p></div>
					<div className="flex gap-2">
						<Button variant="secondary" icon={<GlobeIcon size={16} />} onClick={() => navigate("/domains")}>Domains</Button>
						<Button variant="primary" icon={<PlusIcon size={16} />} disabled={!domains.length} onClick={() => setIsCreateOpen(true)}>New Mailbox</Button>
					</div>
				</div>
				{loading ? <div className="flex justify-center py-20"><Loader size="lg" /></div> : mailboxes.length ? (
					<div className="overflow-hidden rounded-xl border border-kumo-line bg-kumo-base">
						{mailboxes.map((mailbox, index) => <RouterLink key={mailbox.id} to={`/mailbox/${mailbox.id}`} className={`group flex items-center gap-4 px-5 py-4 no-underline hover:bg-kumo-tint ${index ? "border-t border-kumo-line" : ""}`}>
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-kumo-fill font-bold">{mailbox.email.charAt(0).toUpperCase()}</div>
							<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-kumo-default">{mailbox.name}</div><div className="text-sm text-kumo-subtle">{mailbox.email}</div></div>
							<Button variant="ghost" size="sm" shape="square" icon={<TrashIcon size={16} />} aria-label={`Delete ${mailbox.email}`} onClick={(event) => { event.preventDefault(); setMailboxToDelete(mailbox); }} />
						</RouterLink>)}
					</div>
				) : <div className="rounded-xl border border-kumo-line bg-kumo-base py-16"><Empty title={domains.length ? "No mailboxes yet" : "Add a domain first"} description={domains.length ? "Create a mailbox to get started." : "Open Domains and add the domain used by Email Routing."} icon={<EnvelopeIcon />} /></div>}
			</div>

			<Dialog.Root open={isCreateOpen} onOpenChange={setIsCreateOpen}><Dialog size="sm" className="p-6"><Dialog.Title className="mb-5 text-base font-semibold">Create mailbox</Dialog.Title>
				<form onSubmit={handleCreate} className="space-y-4">{error && <Text variant="error" size="sm">{error}</Text>}
					<div><span className="mb-1.5 block text-sm font-medium">Email address</span><div className="flex items-center gap-2"><Input aria-label="Address prefix" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} required /><span>@</span><Select aria-label="Domain" value={selectedDomain} onValueChange={(value) => value && setSelectedDomain(value)}>{domains.map((domain) => <Select.Option key={domain} value={domain}>{domain}</Select.Option>)}</Select></div></div>
					<Input label="Display name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} />
					<div className="flex justify-end gap-2"><Dialog.Close render={(props) => <Button {...props} variant="secondary">Cancel</Button>} /><Button type="submit" variant="primary" loading={createMailbox.isPending}>Create</Button></div>
				</form></Dialog></Dialog.Root>

			<Dialog.Root open={Boolean(mailboxToDelete)} onOpenChange={(open) => !open && setMailboxToDelete(null)}><Dialog size="sm" className="p-6"><Dialog.Title className="mb-2 text-base font-semibold">Delete mailbox</Dialog.Title><Dialog.Description className="mb-5 text-sm text-kumo-subtle">Delete <strong>{mailboxToDelete?.email}</strong>? This cannot be undone.</Dialog.Description><div className="flex justify-end gap-2"><Dialog.Close render={(props) => <Button {...props} variant="secondary">Cancel</Button>} /><Button variant="destructive" loading={deleteMailbox.isPending} onClick={handleDelete}>Delete</Button></div></Dialog></Dialog.Root>
		</div>
	);
}
