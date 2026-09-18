// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { EnvelopeIcon, GlobeIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogDescription,
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
import {
	Select,
	SelectItem,
	SelectPopup,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Spinner } from "~/components/ui/spinner";
import { toastManager } from "~/components/ui/toast";
import api from "~/services/api";
import { useCreateMailbox, useDeleteMailbox, useMailboxes } from "~/queries/mailboxes";
import { queryKeys } from "~/queries/keys";

export function meta() { return [{ title: "Agentic Inbox" }]; }

export default function HomeRoute() {
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
			toastManager.add({ title: "Mailbox created" });
			setIsCreateOpen(false);
			setNewPrefix(""); setNewName("");
		} catch (err) { setError(err instanceof Error ? err.message : "Failed to create mailbox"); }
	};

	const handleDelete = async () => {
		if (!mailboxToDelete) return;
		try {
			await deleteMailbox.mutateAsync(mailboxToDelete.id);
			toastManager.add({ title: "Mailbox deleted" });
			setMailboxToDelete(null);
		} catch { toastManager.add({ title: "Failed to delete mailbox", type: "error" }); }
	};

	const loading = mailboxesLoading || domainsLoading;
	return (
		<div className="min-h-screen bg-muted">
			<div className="mx-auto max-w-2xl px-4 py-8 md:px-6 md:py-16">
				<div className="mb-8 flex items-center justify-between">
					<div><h1 className="text-2xl font-bold text-foreground">Mailboxes</h1><p className="mt-1 text-sm text-muted-foreground">Send and receive mail for your configured domains.</p></div>
					<div className="flex gap-2">
						<Button variant="secondary" onClick={() => navigate("/domains")}>
							<GlobeIcon size={16} aria-hidden="true" />
							Domains
						</Button>
						<Button disabled={!domains.length} onClick={() => setIsCreateOpen(true)}>
							<PlusIcon size={16} aria-hidden="true" />
							New Mailbox
						</Button>
					</div>
				</div>
				{loading ? <div className="flex justify-center py-20"><Spinner className="size-6" /></div> : mailboxes.length ? (
					<div className="overflow-hidden rounded-xl border border-border bg-card">
						{mailboxes.map((mailbox, index) => <RouterLink key={mailbox.id} to={`/mailbox/${mailbox.id}`} className={`group flex items-center gap-4 px-5 py-4 no-underline hover:bg-accent ${index ? "border-t border-border" : ""}`}>
							<div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted font-bold">{mailbox.email.charAt(0).toUpperCase()}</div>
							<div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-foreground">{mailbox.name}</div><div className="text-sm text-muted-foreground">{mailbox.email}</div></div>
							<Button variant="ghost" size="icon-sm" aria-label={`Delete ${mailbox.email}`} onClick={(event) => { event.preventDefault(); setMailboxToDelete(mailbox); }}>
								<TrashIcon size={16} aria-hidden="true" />
							</Button>
						</RouterLink>)}
					</div>
				) : <div className="rounded-xl border border-border bg-card py-16"><Empty><EmptyHeader><EmptyMedia variant="icon"><EnvelopeIcon aria-hidden="true" /></EmptyMedia><EmptyTitle>{domains.length ? "No mailboxes yet" : "Add a domain first"}</EmptyTitle><EmptyDescription>{domains.length ? "Create a mailbox to get started." : "Open Domains and add the domain used by Email Routing."}</EmptyDescription></EmptyHeader></Empty></div>}
			</div>

			<Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
				<DialogPopup className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Create mailbox</DialogTitle>
					</DialogHeader>
					<form onSubmit={handleCreate} className="contents">
						<DialogPanel className="flex flex-col gap-4">
							{error && <p className="text-sm text-destructive-foreground">{error}</p>}
							<div>
								<span className="mb-1.5 block text-sm font-medium">Email address</span>
								<div className="flex items-center gap-2">
									<Input aria-label="Address prefix" value={newPrefix} onChange={(e) => setNewPrefix(e.target.value)} required />
									<span>@</span>
									<Select
										items={domains.map((domain) => ({ label: domain, value: domain }))}
										value={selectedDomain}
										onValueChange={(value) => value && setSelectedDomain(value)}
									>
										<SelectTrigger aria-label="Domain">
											<SelectValue />
										</SelectTrigger>
										<SelectPopup>
											{domains.map((domain) => (
												<SelectItem key={domain} value={domain}>{domain}</SelectItem>
											))}
										</SelectPopup>
									</Select>
								</div>
							</div>
							<Field>
								<FieldLabel>Display name (optional)</FieldLabel>
								<Input value={newName} onChange={(e) => setNewName(e.target.value)} />
							</Field>
						</DialogPanel>
						<DialogFooter>
							<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
							<Button type="submit" loading={createMailbox.isPending}>Create</Button>
						</DialogFooter>
					</form>
				</DialogPopup>
			</Dialog>

			<Dialog open={Boolean(mailboxToDelete)} onOpenChange={(open) => !open && setMailboxToDelete(null)}>
				<DialogPopup className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Delete mailbox</DialogTitle>
						<DialogDescription>
							Delete <strong>{mailboxToDelete?.email}</strong>? This cannot be undone.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
						<Button variant="destructive" loading={deleteMailbox.isPending} onClick={handleDelete}>Delete</Button>
					</DialogFooter>
				</DialogPopup>
			</Dialog>
		</div>
	);
}
