// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Email sending with pluggable providers.
 *
 * Supported outbound providers are selected independently for each domain:
 *
 * - `resend`: sends via the Resend HTTP API.
 *   Uses the domain's encrypted API key.
 *   See: https://resend.com/docs/api-reference/emails/send-email
 *
 * - `cloudflare`: sends via the Cloudflare Email Service `send_email`
 *   Worker binding (`env.EMAIL`). Requires the `EMAIL` binding in
 *   wrangler.jsonc.
 *   See: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
 */

import type { Env } from "./types";
import type { OutboundProvider } from "./domain-config";

export interface SendEmailParams {
	to: string | string[];
	from: string | { email: string; name: string };
	subject: string;
	html?: string;
	text?: string;
	cc?: string | string[];
	bcc?: string | string[];
	replyTo?: string | { email: string; name: string };
	attachments?: {
		content: string; // base64 encoded
		filename: string;
		type: string;
		disposition: "attachment" | "inline";
		contentId?: string;
	}[];
	headers?: Record<string, string>;
}

export type EmailProvider = Exclude<OutboundProvider, "none">;

export interface EmailProviderConfig {
	provider: OutboundProvider;
	resendApiKey?: string;
}

/**
 * Send an email using the domain's configured provider.
 *
 * @param env     - Worker env (provider config + credentials/binding)
 * @param params  - Email parameters (to, from, subject, body, etc.)
 * @returns The send result with messageId
 * @throws On misconfiguration, validation or delivery errors
 */
export async function sendEmail(
	env: Env,
	params: SendEmailParams,
	config: EmailProviderConfig,
): Promise<{ messageId: string }> {
	if (config.provider === "none") {
		throw new Error("Outbound email is not enabled for this domain");
	}
	switch (config.provider) {
		case "cloudflare": {
			// Accessed defensively: the EMAIL binding only exists when
			// deploying with wrangler.cloudflare.toml, so it is absent
			// from the generated Cloudflare.Env types.
			const binding = (env as unknown as Record<string, unknown>).EMAIL as
				| SendEmail
				| undefined;
			return sendViaCloudflare(binding, params);
		}
		case "resend":
			return sendViaResend(config.resendApiKey, params);
	}
}

// ── Resend provider ────────────────────────────────────────────────

const RESEND_API_URL = "https://api.resend.com/emails";

function formatAddress(addr: string | { email: string; name: string }): string {
	return typeof addr === "string" ? addr : `${addr.name} <${addr.email}>`;
}

function toAddressList(
	addr: string | string[] | undefined,
): string[] | undefined {
	if (!addr) return undefined;
	return Array.isArray(addr) ? addr : [addr];
}

async function sendViaResend(
	apiKey: string | undefined,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	if (!apiKey) {
		throw new Error("A Resend API key is not configured for this domain");
	}

	const message: Record<string, unknown> = {
		from: formatAddress(params.from),
		to: toAddressList(params.to),
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;

	const cc = toAddressList(params.cc);
	if (cc) message.cc = cc;
	const bcc = toAddressList(params.bcc);
	if (bcc) message.bcc = bcc;
	if (params.replyTo) message.reply_to = [formatAddress(params.replyTo)];

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			filename: att.filename,
			content: att.content, // base64
			content_type: att.type,
			...(att.disposition === "inline" && att.contentId
				? { content_id: att.contentId }
				: {}),
		}));
	}

	const response = await fetch(RESEND_API_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(message),
	});

	if (!response.ok) {
		let detail = response.statusText;
		try {
			const error = (await response.json()) as { message?: string };
			if (error.message) detail = error.message;
		} catch {
			// ignore non-JSON error bodies
		}
		throw new Error(`Resend API error (${response.status}): ${detail}`);
	}

	const result = (await response.json()) as { id: string };
	return { messageId: result.id };
}

// ── Cloudflare Email Service provider ──────────────────────────────

async function sendViaCloudflare(
	binding: SendEmail | undefined,
	params: SendEmailParams,
): Promise<{ messageId: string }> {
	if (!binding) {
		throw new Error("The EMAIL send_email binding is not configured");
	}

	const message: Record<string, unknown> = {
		to: params.to,
		from: params.from,
		subject: params.subject,
	};

	if (params.html) message.html = params.html;
	if (params.text) message.text = params.text;
	if (params.cc) message.cc = params.cc;
	if (params.bcc) message.bcc = params.bcc;
	if (params.replyTo) message.replyTo = params.replyTo;

	if (params.headers && Object.keys(params.headers).length > 0) {
		message.headers = params.headers;
	}

	if (params.attachments && params.attachments.length > 0) {
		message.attachments = params.attachments.map((att) => ({
			content: att.content,
			filename: att.filename,
			type: att.type,
			disposition: att.disposition,
			...(att.contentId ? { contentId: att.contentId } : {}),
		}));
	}

	const result = await binding.send(message as any);
	return { messageId: result.messageId };
}
