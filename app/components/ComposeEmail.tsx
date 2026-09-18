// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { FloppyDiskIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react";
import { useParams } from "react-router";
import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import {
	Dialog,
	DialogFooter,
	DialogHeader,
	DialogPanel,
	DialogPopup,
	DialogTitle,
} from "~/components/ui/dialog";
import { Field, FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { useComposeForm } from "~/hooks/useComposeForm";
import RichTextEditor from "./RichTextEditor";
import { useUIStore } from "~/hooks/useUIStore";

export default function ComposeEmail() {
	const { mailboxId, folder } = useParams<{
		mailboxId: string;
		folder: string;
	}>();
	
	const { isComposeModalOpen, closeComposeModal } = useUIStore();

	const {
		to,
		setTo,
		cc,
		setCc,
		bcc,
		setBcc,
		showCcBcc,
		setShowCcBcc,
		subject,
		setSubject,
		body,
		setBody,
		error,
		isSavingDraft,
		isSending,
		formTitle,
		handleSaveDraft,
		handleSend,
	} = useComposeForm(mailboxId, folder);

	return (
		<Dialog
			open={isComposeModalOpen}
			onOpenChange={(open) => !open && !isSending && closeComposeModal()}
		>
			<DialogPopup className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{formTitle}</DialogTitle>
				</DialogHeader>
				<form onSubmit={(e) => handleSend(e, closeComposeModal)} className="contents">
					<DialogPanel className="flex flex-col gap-4">
						{error && (
							<Alert variant="error">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}
						<div className="flex items-center gap-2">
							<div className="flex-1">
								<Field>
									<FieldLabel>To</FieldLabel>
									<Input
										type="text"
										placeholder="recipient@example.com, another@example.com"
										size="sm"
										value={to}
										onChange={(e) => setTo(e.target.value)}
										required
									/>
								</Field>
							</div>
							{!showCcBcc && (
								<button
									type="button"
									onClick={() => setShowCcBcc(true)}
									className="shrink-0 text-xs text-info hover:text-info/80 font-medium mt-5"
								>
									CC / BCC
								</button>
							)}
						</div>
						{showCcBcc && (
							<Field>
								<FieldLabel>CC</FieldLabel>
								<Input
									type="text"
									size="sm"
									value={cc}
									onChange={(e) => setCc(e.target.value)}
									placeholder="Separate multiple addresses with commas"
								/>
							</Field>
						)}
						{showCcBcc && (
							<Field>
								<FieldLabel>BCC</FieldLabel>
								<Input
									type="text"
									size="sm"
									value={bcc}
									onChange={(e) => setBcc(e.target.value)}
									placeholder="Separate multiple addresses with commas"
								/>
							</Field>
						)}
						<Field>
							<FieldLabel>Subject</FieldLabel>
							<Input
								type="text"
								placeholder="Email subject"
								size="sm"
								value={subject}
								onChange={(e) => setSubject(e.target.value)}
								required
							/>
						</Field>
						<div>
							<div className="mb-1.5 text-sm font-medium">
								Message
							</div>
							<RichTextEditor value={body} onChange={setBody} />
						</div>
					</DialogPanel>
					<DialogFooter>
						<div className="flex w-full items-center justify-between">
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={closeComposeModal}
								disabled={isSending}
							>
								Discard
							</Button>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									variant="secondary"
									size="sm"
									loading={isSavingDraft}
									disabled={isSending}
									onClick={handleSaveDraft}
								>
									<FloppyDiskIcon size={14} aria-hidden="true" />
									{isSavingDraft ? "Saving..." : "Save as Draft"}
								</Button>
								<Button
									type="submit"
									size="sm"
									loading={isSending}
									disabled={isSavingDraft || isSending}
								>
									<PaperPlaneTiltIcon size={14} aria-hidden="true" />
									{isSending ? "Sending..." : "Send"}
								</Button>
							</div>
						</div>
					</DialogFooter>
				</form>
			</DialogPopup>
		</Dialog>
	);
}
