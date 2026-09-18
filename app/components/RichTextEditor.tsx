// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import {
	ArrowClockwiseIcon,
	ArrowCounterClockwiseIcon,
	LinkBreakIcon,
	LinkSimpleIcon,
	ListBulletsIcon,
	ListNumbersIcon,
	MinusIcon,
	QuotesIcon,
	TextBIcon,
	TextItalicIcon,
	TextStrikethroughIcon,
	TextUnderlineIcon,
} from "@phosphor-icons/react";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TiptapImage from "@tiptap/extension-image";
import LinkExtension from "@tiptap/extension-link";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useCallback, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

interface RichTextEditorProps {
	value: string;
	onChange: (value: string) => void;
}

interface EditorToolbarButtonProps {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}

function EditorToolbarButton({
	label,
	active,
	disabled,
	onClick,
	children,
}: EditorToolbarButtonProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						variant={active ? "secondary" : "ghost"}
						size="icon-sm"
						onClick={onClick}
						disabled={disabled}
						aria-label={label}
					/>
				}
			>
				{children}
			</TooltipTrigger>
			<TooltipPopup side="bottom">{label}</TooltipPopup>
		</Tooltip>
	);
}

export default function RichTextEditor({
	value,
	onChange,
}: RichTextEditorProps) {
	const editor = useEditor({
		extensions: [
			StarterKit,
			Underline,
			TextAlign.configure({ types: ["heading", "paragraph"] }),
			LinkExtension.configure({ openOnClick: false }),
			TiptapImage,
			TextStyle,
			Color,
			Highlight.configure({ multicolor: true }),
		],
		content: value,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm max-w-none focus:outline-none min-h-[180px] p-3 text-sm [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:bg-accent [&_blockquote]:py-1 [&_blockquote]:my-2 [&_blockquote]:text-xs [&_blockquote]:rounded-r-sm",
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML());
		},
	});

	useEffect(() => {
		if (editor && !editor.isDestroyed && value !== editor.getHTML()) {
			editor.commands.setContent(value);
			// Place cursor at the start of the document (above quoted text)
			const rafId = requestAnimationFrame(() => {
				if (!editor.isDestroyed) {
					editor.commands.focus('start');
				}
			});
			return () => cancelAnimationFrame(rafId);
		}
	}, [value, editor]);

	const setLink = useCallback(() => {
		if (!editor) return;
		const previousUrl = editor.getAttributes("link").href;
		const url = window.prompt("URL", previousUrl);
		if (url === null) return;
		if (url === "") {
			editor.chain().focus().extendMarkRange("link").unsetLink().run();
			return;
		}
		editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
	}, [editor]);

	if (!editor) return null;

	return (
		<div className="rounded-lg border border-border overflow-hidden flex flex-col h-full">
			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-0.5 bg-muted px-2 py-1.5 border-b border-border shrink-0">
				{/* Text formatting */}
				<EditorToolbarButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
					<TextBIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
					<TextItalicIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
					<TextUnderlineIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
					<TextStrikethroughIcon size={16} />
				</EditorToolbarButton>

				<div className="mx-1 h-5 w-px bg-muted" />

				{/* Lists */}
				<EditorToolbarButton label="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
					<ListBulletsIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
					<ListNumbersIcon size={16} />
				</EditorToolbarButton>

				<div className="mx-1 h-5 w-px bg-muted" />

				{/* Block formatting */}
				<EditorToolbarButton label="Blockquote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
					<QuotesIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Link" active={editor.isActive("link")} onClick={setLink}>
					<LinkSimpleIcon size={16} />
				</EditorToolbarButton>
				{editor.isActive("link") && (
					<EditorToolbarButton label="Remove link" onClick={() => editor.chain().focus().unsetLink().run()}>
						<LinkBreakIcon size={16} />
					</EditorToolbarButton>
				)}
				<EditorToolbarButton label="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
					<MinusIcon size={16} />
				</EditorToolbarButton>

				<div className="mx-1 h-5 w-px bg-muted" />

				{/* Undo/Redo */}
				<EditorToolbarButton label="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
					<ArrowCounterClockwiseIcon size={16} />
				</EditorToolbarButton>
				<EditorToolbarButton label="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
					<ArrowClockwiseIcon size={16} />
				</EditorToolbarButton>
			</div>

			{/* Editor content */}
			<div className="flex-1 overflow-y-auto">
				<EditorContent editor={editor} />
			</div>
		</div>
	);
}
