// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { useEffect, useRef, useState } from "react";
import {
	ArrowBendUpLeftIcon,
	ArrowBendUpRightIcon,
	ArrowLeftIcon,
	ChatCircleIcon,
	CodeIcon,
	EnvelopeOpenIcon,
	EnvelopeSimpleIcon,
	FolderSimpleIcon,
	PaperPlaneTiltIcon,
	PencilSimpleIcon,
	StarIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import type { Folder, Email } from "~/types";

interface EmailPanelToolbarProps {
	email: Email;
	mailboxId?: string;
	isDraftFolder: boolean;
	isSending: boolean;
	moveToFolders: Folder[];
	lastReceivedMessage?: Email;
	onBack: () => void;
	onSendDraft: () => void;
	onEditDraft: () => void;
	onReply: () => void;
	onReplyAll: () => void;
	onForward: () => void;
	onToggleStar: () => void;
	onToggleRead: () => void;
	onMove: (folderId: string) => void;
	onViewSource: () => void;
	onDelete: () => void;
}

function IconToolbarButton({
	label,
	onClick,
	disabled,
	className,
	children,
}: {
	label: string;
	onClick: () => void;
	disabled?: boolean;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={onClick}
						disabled={disabled}
						aria-label={label}
						className={className}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipPopup side="bottom">{label}</TooltipPopup>
		</Tooltip>
	);
}

export default function EmailPanelToolbar({
	email,
	mailboxId,
	isDraftFolder,
	isSending,
	moveToFolders,
	onBack,
	onSendDraft,
	onEditDraft,
	onReply,
	onReplyAll,
	onForward,
	onToggleStar,
	onToggleRead,
	onMove,
	onViewSource,
	onDelete,
}: EmailPanelToolbarProps) {
	return (
		<div className="flex items-center gap-1 px-3 py-2 border-b border-border shrink-0 md:px-4">
			<Button
				variant="ghost"
				size="icon-sm"
				onClick={onBack}
				aria-label="Back to list"
				className="md:hidden shrink-0"
			>
				<ArrowLeftIcon size={18} aria-hidden="true" />
			</Button>

			{isDraftFolder ? (
				<>
					<Button
						size="sm"
						onClick={onSendDraft}
						loading={isSending}
					>
						<PaperPlaneTiltIcon size={16} aria-hidden="true" />
						{isSending ? "Sending..." : "Send"}
					</Button>
					<Button
						variant="secondary"
						size="sm"
						onClick={onEditDraft}
					>
						<PencilSimpleIcon size={16} aria-hidden="true" />
						Edit
					</Button>
				</>
			) : (
				<>
					<IconToolbarButton label="Reply" onClick={onReply}>
						<ArrowBendUpLeftIcon size={18} />
					</IconToolbarButton>
					<IconToolbarButton label="Reply All" onClick={onReplyAll}>
						<ChatCircleIcon size={18} />
					</IconToolbarButton>
					<IconToolbarButton label="Forward" onClick={onForward}>
						<ArrowBendUpRightIcon size={18} />
					</IconToolbarButton>
				</>
			)}

			<div className="h-5 w-px bg-muted mx-0.5" />

			<IconToolbarButton
				label={email.starred ? "Unstar" : "Star"}
				onClick={onToggleStar}
			>
				<StarIcon
					size={18}
					weight={email.starred ? "fill" : "regular"}
					className={email.starred ? "text-warning" : ""}
				/>
			</IconToolbarButton>

			<IconToolbarButton
				label={email.read ? "Mark as unread" : "Mark as read"}
				onClick={onToggleRead}
			>
				{email.read ? <EnvelopeSimpleIcon size={18} /> : <EnvelopeOpenIcon size={18} />}
			</IconToolbarButton>

			<MoveToFolderMenu folders={moveToFolders} onMove={onMove} />

			<div className="ml-auto flex items-center gap-0.5">
				<IconToolbarButton label="View source" onClick={onViewSource}>
					<CodeIcon size={18} />
				</IconToolbarButton>
				<IconToolbarButton label="Delete" onClick={onDelete}>
					<TrashIcon size={18} />
				</IconToolbarButton>
				<IconToolbarButton
					label="Close"
					onClick={onBack}
					className="hidden md:inline-flex"
				>
					<XIcon size={18} />
				</IconToolbarButton>
			</div>
		</div>
	);
}

function MoveToFolderMenu({ folders, onMove }: { folders: Folder[]; onMove: (id: string) => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const handler = (e: MouseEvent) => {
			if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
		};
		document.addEventListener("mousedown", handler);
		return () => document.removeEventListener("mousedown", handler);
	}, [open]);

	return (
		<div ref={ref} className="relative">
			<IconToolbarButton label="Move to folder" onClick={() => setOpen((o) => !o)}>
				<FolderSimpleIcon size={18} />
			</IconToolbarButton>
			{open && (
				<div className="absolute top-full left-0 z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-popover shadow-lg py-1">
					<div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Move to</div>
					<div className="h-px bg-border my-1" />
					{folders.map((f) => (
						<button
							key={f.id}
							type="button"
							className="w-full text-left px-3 py-1.5 text-sm text-foreground hover:bg-accent transition-colors"
							onClick={() => { onMove(f.id); setOpen(false); }}
						>
							{f.name}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
