// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

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
import { downloadFile } from "~/lib/utils";
import type { Email } from "~/types";

interface PreviewImage {
	url: string;
	filename: string;
}

interface EmailPanelDialogsProps {
	sourceViewEmail: Email | null;
	previewImage: PreviewImage | null;
	onCloseSource: () => void;
	onClosePreview: () => void;
}

function getSourceHeaders(msg: Email): { key: string; value: string }[] {
	if (msg.raw_headers) {
		try {
			const parsed = JSON.parse(msg.raw_headers);
			if (Array.isArray(parsed)) {
				return parsed.map((header) => ({
					key: header.key || header.name || "",
					value: String(header.value || ""),
				}));
			}
			if (typeof parsed === "object" && parsed !== null) {
				return Object.entries(parsed).map(([key, value]) => ({
					key,
					value: String(value),
				}));
			}
		} catch {
			// Fall through to field-based headers.
		}
	}

	const headers: { key: string; value: string }[] = [];
	if (msg.sender) headers.push({ key: "From", value: msg.sender });
	if (msg.recipient) headers.push({ key: "To", value: msg.recipient });
	if (msg.cc) headers.push({ key: "Cc", value: msg.cc });
	if (msg.bcc) headers.push({ key: "Bcc", value: msg.bcc });
	if (msg.subject) headers.push({ key: "Subject", value: msg.subject });
	if (msg.date) headers.push({ key: "Date", value: msg.date });
	if (msg.message_id) headers.push({ key: "Message-ID", value: msg.message_id });
	if (msg.in_reply_to) headers.push({ key: "In-Reply-To", value: msg.in_reply_to });
	if (msg.email_references) {
		headers.push({ key: "References", value: msg.email_references });
	}
	if (msg.thread_id) headers.push({ key: "X-Thread-ID", value: msg.thread_id });
	return headers;
}

export default function EmailPanelDialogs({
	sourceViewEmail,
	previewImage,
	onCloseSource,
	onClosePreview,
}: EmailPanelDialogsProps) {
	const sourceHeaders = sourceViewEmail ? getSourceHeaders(sourceViewEmail) : [];

	return (
		<>
			<Dialog
				open={sourceViewEmail !== null}
				onOpenChange={(open) => {
					if (!open) onCloseSource();
				}}
			>
				<DialogPopup className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>
							Email Source Headers
							{sourceViewEmail && (
								<span className="text-sm font-normal text-muted-foreground ml-2">
									{sourceViewEmail.subject}
								</span>
							)}
						</DialogTitle>
					</DialogHeader>
					<DialogPanel>
						{sourceViewEmail && (
							<div className="max-h-[60vh] overflow-y-auto">
								<table className="w-full text-sm border-collapse">
									<tbody>
										{sourceHeaders.map((header, idx) => (
											<tr
												key={`${header.key}-${idx}`}
												className={idx % 2 === 0 ? "bg-accent/50" : ""}
											>
												<td className="py-1.5 px-3 font-mono font-semibold text-foreground whitespace-nowrap align-top w-[160px]">
													{header.key}
												</td>
												<td className="py-1.5 px-3 font-mono text-muted-foreground break-all">
													{header.value}
												</td>
											</tr>
										))}
									</tbody>
								</table>
								{sourceHeaders.length === 0 && (
									<p className="text-sm text-muted-foreground text-center py-8">
										No header data available for this email.
									</p>
								)}
							</div>
						)}
					</DialogPanel>
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" size="sm" />}>
							Close
						</DialogClose>
					</DialogFooter>
				</DialogPopup>
			</Dialog>

			<Dialog
				open={previewImage !== null}
				onOpenChange={(open) => {
					if (!open) onClosePreview();
				}}
			>
				<DialogPopup className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>{previewImage?.filename}</DialogTitle>
					</DialogHeader>
					<DialogPanel>
						{previewImage && (
							<div className="flex flex-col items-center justify-center bg-accent/30 rounded-lg p-4 min-h-[200px]">
								<img
									src={previewImage.url}
									alt={previewImage.filename}
									className="max-w-full max-h-[70vh] object-contain rounded shadow-sm"
								/>
							</div>
						)}
					</DialogPanel>
					<DialogFooter>
						<div className="flex w-full items-center justify-between">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => {
									if (previewImage) {
										downloadFile(previewImage.url, previewImage.filename);
									}
								}}
							>
								Download Original
							</Button>
							<DialogClose render={<Button size="sm" />}>
								Close
							</DialogClose>
						</div>
					</DialogFooter>
				</DialogPopup>
			</Dialog>
		</>
	);
}
