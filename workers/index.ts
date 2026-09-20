// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import PostalMime from "postal-mime";
import { z } from "zod";
import { sendEmail } from "./email-sender";
import { storeAttachments, type StoredAttachment } from "./lib/attachments";
import {
	validateSender,
	SenderValidationError,
	generateMessageId,
	buildThreadingHeaders,
	listMailboxes,
} from "./lib/email-helpers";
import { SendEmailRequestSchema } from "./lib/schemas";
import { handleReplyEmail, handleForwardEmail } from "./routes/reply-forward";
import { Folders } from "../shared/folders";
import type { Env } from "./types";
import { requireMailbox, type MailboxContext } from "./lib/mailbox";
import {
	getDomainConfigStub,
	getOutboundConfig,
	publicDomainConfig,
} from "./domain-config";
import {
	authenticateRelayRequest,
	RELAY_HEADERS,
	RELAY_MAX_CLOCK_SKEW_SECONDS,
	RELAY_MAX_EMAIL_SIZE,
} from "./relay-auth";
import { completeOAuth, createOAuthRequest } from "./cloudflare-integration";

type AppContext = Context<MailboxContext>;

// -- Request body schemas (kept for validation) ---------------------

const CreateMailboxBody = z.object({
	email: z.string().email(),
	name: z.string().min(1),
	settings: z.record(z.any()).optional(), // unvalidated — agentSystemPrompt goes straight to AI
});

const DraftBody = z.object({
	to: z.string().optional(),
	cc: z.string().optional(),
	bcc: z.string().optional(),
	subject: z.string().optional(),
	body: z.string(),
	in_reply_to: z.string().optional(),
	thread_id: z.string().optional(),
	draft_id: z.string().optional(),
});

// -- Helpers --------------------------------------------------------

function slugify(text: string) { // can return "" for non-alphanumeric input
	return text.toString().toLowerCase()
		.replace(/\s+/g, "-").replace(/[^\w-]+/g, "")
		.replace(/--+/g, "-").replace(/^-+/, "").replace(/-+$/, "");
}

function defaultMailboxSettings(name: string) {
	return {
		fromName: name,
		forwarding: { enabled: false, email: "" },
		signature: { enabled: false, text: "" },
		autoReply: { enabled: false, subject: "", message: "" },
	};
}

function intQuery(c: AppContext, key: string): number | undefined {
	const v = c.req.query(key);
	if (!v) return undefined;
	const n = Number(v);
	return Number.isNaN(n) ? undefined : n;
}

function boolQuery(c: AppContext, key: string): boolean | undefined {
	const v = c.req.query(key);
	if (v === undefined || v === "") return undefined;
	return v === "true" || v === "1";
}

// -- App & middleware -----------------------------------------------

const app = new Hono<MailboxContext>();
app.use("/api/*", cors({
	origin: (origin) => {
		// Same-origin requests have no Origin header — allow them.
		if (!origin) return origin;
		// In development, allow localhost for Vite dev server.
		try {
			const url = new URL(origin);
			if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
		} catch { /* invalid origin */ }
		// Block all other cross-origin requests. The app is served from the
		// same origin as the API, so legitimate browser requests never send
		// an Origin header. Returning undefined omits Access-Control-Allow-Origin.
		return undefined;
	},
}));
app.use("/api/v1/mailboxes/:mailboxId/*", requireMailbox);

// -- Encryption health ---------------------------------------------

app.get("/api/v1/encryption/health", async (c) => {
	return c.json(await getDomainConfigStub(c.env).checkEncryptionHealth());
});

// -- Cross-account inbound relay -----------------------------------

const CloudflareConnectBody = z.object({ domains: z.array(z.string().min(1)).min(1).max(100) });

app.get("/api/v1/integrations/cloudflare", async (c) => c.json(await getDomainConfigStub(c.env).listCloudflareIntegrations()));
app.post("/api/v1/integrations/cloudflare/connect", async (c) => {
	const { domains: rawDomains } = CloudflareConnectBody.parse(await c.req.json());
	const domains = [...new Set(rawDomains.map((domain) => domain.trim().toLowerCase()))];
	const stub = getDomainConfigStub(c.env);
	for (const domain of domains) if (!await stub.get(domain)) return c.json({ error: `Domain ${domain} is not configured` }, 422);
	const connected = new Set((await stub.listCloudflareIntegrations()).flatMap((item) => item.domains));
	if (domains.some((domain) => connected.has(domain))) return c.json({ error: "One or more domains are already connected" }, 409);
	return c.json({ authorizationUrl: await createOAuthRequest(c.env, stub, { operation: "connect", domains }) });
});
app.post("/api/v1/integrations/cloudflare/:id/disconnect", async (c) => {
	const stub = getDomainConfigStub(c.env), id = c.req.param("id");
	if (!await stub.getCloudflareIntegration(id)) return c.json({ error: "Integration not found" }, 404);
	return c.json({ authorizationUrl: await createOAuthRequest(c.env, stub, { operation: "disconnect", integrationId: id }) });
});
app.get("/api/v1/integrations/cloudflare/callback", async (c) => {
	const code = c.req.query("code"), state = c.req.query("state"), error = c.req.query("error");
	const destination = new URL("/integrations/cloudflare", c.req.url);
	if (!code || !state || error) { destination.searchParams.set("error", error || "OAuth authorization was cancelled"); return c.redirect(destination.toString()); }
	try { const result = await completeOAuth(c.env, getDomainConfigStub(c.env), code, state); destination.searchParams.set("status", result.operation); }
	catch (oauthError) { console.error("Cloudflare OAuth integration failed:", oauthError); destination.searchParams.set("error", (oauthError as Error).message); }
	return c.redirect(destination.toString());
});

app.post("/api/v1/relay/email", async (c) => {
	if (c.req.header("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "message/rfc822") {
		return c.json({ error: "Content-Type must be message/rfc822" }, 415);
	}
	if (Object.values(RELAY_HEADERS).some((header) => !c.req.header(header))) {
		return c.json({ error: "Missing relay authentication headers" }, 400);
	}
	const declaredSize = Number(c.req.header("content-length") ?? 0);
	if (Number.isFinite(declaredSize) && declaredSize > RELAY_MAX_EMAIL_SIZE) {
		return c.json({ error: "Email exceeds the 25 MiB relay limit" }, 413);
	}
	const rawEmail = await c.req.arrayBuffer();
	if (rawEmail.byteLength === 0) return c.json({ error: "Email body is empty" }, 400);
	if (rawEmail.byteLength > RELAY_MAX_EMAIL_SIZE) {
		return c.json({ error: "Email exceeds the 25 MiB relay limit" }, 413);
	}
	const relayId = c.req.header(RELAY_HEADERS.id)?.trim() ?? "";
	const relayConfig = /^[a-zA-Z0-9_-]{1,64}$/.test(relayId)
		? await getDomainConfigStub(c.env).getEmailRelay(relayId)
		: null;
	const authentication = await authenticateRelayRequest(c.req.raw, rawEmail, relayConfig);
	if (!authentication.ok) return c.json({ error: authentication.error }, authentication.status);
	const { id, nonce, timestamp, from, to } = authentication.metadata;
	const domainConfigStub = getDomainConfigStub(c.env);
	const recipientDomain = to.split("@")[1];
	const domainConfig = recipientDomain ? await domainConfigStub.get(recipientDomain) : null;
	if (!domainConfig || domainConfig.inboundProvider !== "cloudflare") {
		return c.json({ error: "Relay recipient domain is not configured" }, 422);
	}
	if (domainConfig.emailAddresses.length > 0 && !domainConfig.emailAddresses.includes(to)) {
		return c.json({ error: "Relay recipient is not in the domain allowed-address list" }, 422);
	}
	const claimed = await domainConfigStub.claimRelayNonce(
		id,
		nonce,
		Number(timestamp) + RELAY_MAX_CLOCK_SKEW_SECONDS,
	);
	if (!claimed) return c.json({ error: "Relay request has already been processed" }, 409);

	try {
		await receiveEmail({
			raw: new Response(rawEmail).body!,
			rawSize: rawEmail.byteLength,
			from,
			to,
		}, c.env, c.executionCtx as ExecutionContext);
		return c.json({ accepted: true }, 202);
	} catch (error) {
		// Permit an exact HTTP retry when ingestion fails before a response is
		// returned. Successfully accepted nonces remain blocked until expiry.
		await domainConfigStub.releaseRelayNonce(id, nonce);
		throw error;
	}
});

// -- Domains --------------------------------------------------------

const DomainName = z.string().trim().toLowerCase().regex(
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
	"Enter a valid domain name",
);
const CreateDomainBody = z.object({ domain: DomainName });
const UpdateDomainBody = z.object({
	emailAddresses: z.array(z.string().email()).max(1000),
	outboundProvider: z.enum(["none", "cloudflare", "resend"]),
	resendApiKeyEncrypted: z.string().min(1).max(4096).optional(),
	removeResendApiKey: z.boolean().optional(),
});

app.get("/api/v1/domains/encryption-key", async (c) => {
	try {
		return c.json(await getDomainConfigStub(c.env).getEncryptionPublicConfig());
	} catch (error) {
		return c.json({ error: (error as Error).message }, 503);
	}
});

app.get("/api/v1/domains/encryption/status", async (c) => {
	try {
		return c.json(await getDomainConfigStub(c.env).getMasterStatus());
	} catch (error) {
		return c.json({ error: (error as Error).message }, 503);
	}
});

app.post("/api/v1/domains/encryption/migrate", async (c) => {
	try {
		return c.json(await getDomainConfigStub(c.env).migrateMaster());
	} catch (error) {
		return c.json({ error: (error as Error).message }, 400);
	}
});

app.get("/api/v1/domains", async (c) =>
	c.json((await getDomainConfigStub(c.env).list()).map(publicDomainConfig)),
);

app.post("/api/v1/domains", async (c) => {
	const { domain } = CreateDomainBody.parse(await c.req.json());
	const stub = getDomainConfigStub(c.env);
	if (await stub.get(domain)) return c.json({ error: "Domain already exists" }, 409);
	return c.json(publicDomainConfig(await stub.create(domain)), 201);
});

app.get("/api/v1/domains/:domain", async (c) => {
	const config = await getDomainConfigStub(c.env).get(c.req.param("domain"));
	return config ? c.json(publicDomainConfig(config)) : c.json({ error: "Domain not found" }, 404);
});

app.put("/api/v1/domains/:domain", async (c) => {
	const domain = DomainName.parse(c.req.param("domain"));
	const body = UpdateDomainBody.parse(await c.req.json());
	const emailAddresses = [...new Set(body.emailAddresses.map((a) => a.trim().toLowerCase()))];
	if (emailAddresses.some((address) => !address.endsWith(`@${domain}`))) {
		return c.json({ error: `All allowed addresses must belong to ${domain}` }, 400);
	}
	if (body.outboundProvider === "resend" && !body.resendApiKeyEncrypted) {
		const current = await getDomainConfigStub(c.env).get(domain);
		if (!current?.resendApiKeyEncrypted || body.removeResendApiKey) {
			return c.json({ error: "A Resend API key is required" }, 400);
		}
	}
	const config = await getDomainConfigStub(c.env).update(domain, { ...body, emailAddresses });
	return config ? c.json(publicDomainConfig(config)) : c.json({ error: "Domain not found" }, 404);
});

app.delete("/api/v1/domains/:domain", async (c) => {
	const deleted = await getDomainConfigStub(c.env).delete(c.req.param("domain"));
	return deleted ? c.body(null, 204) : c.json({ error: "Domain not found" }, 404);
});

// -- Mailboxes ------------------------------------------------------

app.get("/api/v1/mailboxes", async (c) => {
	const allMailboxes = await listMailboxes(c.env.BUCKET);
	return c.json(allMailboxes.map((m) => ({ ...m, name: m.id })));
});

app.post("/api/v1/mailboxes", async (c) => {
	const { name, settings, email: rawEmail } = CreateMailboxBody.parse(await c.req.json());
	const email = rawEmail.toLowerCase();
	const domain = email.split("@")[1];
	const domainConfig = domain ? await getDomainConfigStub(c.env).get(domain) : null;
	if (!domainConfig) return c.json({ error: "The email domain is not configured" }, 403);
	if (domainConfig.emailAddresses.length > 0 && !domainConfig.emailAddresses.includes(email)) {
		return c.json({ error: "Mailbox creation is restricted by this domain's allowed-address list" }, 403);
	}
	const key = `mailboxes/${email}.json`;
	if (await c.env.BUCKET.head(key)) return c.json({ error: "Mailbox already exists" }, 409);
	const finalSettings = { ...defaultMailboxSettings(name), ...settings };
	await c.env.BUCKET.put(key, JSON.stringify(finalSettings));
	const stub = c.env.MAILBOX.get(c.env.MAILBOX.idFromName(email));
	await stub.getFolders();
	return c.json({ id: email, email, name, settings: finalSettings }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const obj = await c.env.BUCKET.get(`mailboxes/${mailboxId}.json`);
	if (!obj) return c.json({ error: "Not found" }, 404);
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings: await obj.json() });
});

app.put("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { settings } = (await c.req.json()) as { settings: Record<string, unknown> };
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.put(key, JSON.stringify(settings));
	return c.json({ id: mailboxId, name: mailboxId, email: mailboxId, settings });
});

app.delete("/api/v1/mailboxes/:mailboxId", async (c) => {
	const mailboxId = c.req.param("mailboxId")!;
	const key = `mailboxes/${mailboxId}.json`;
	if (!(await c.env.BUCKET.head(key))) return c.json({ error: "Not found" }, 404);
	await c.env.BUCKET.delete(key); // TODO: also delete DO data and R2 attachment blobs
	return c.body(null, 204);
});

// -- Emails ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const folder = c.req.query("folder");
	const thread_id = c.req.query("thread_id");
	const threaded = boolQuery(c, "threaded");
	const page = intQuery(c, "page");
	const limit = intQuery(c, "limit");
	const sortColumn = c.req.query("sortColumn") as any;
	const sortDirection = c.req.query("sortDirection") as "ASC" | "DESC" | undefined;
	const stub = c.var.mailboxStub;

	if (threaded && folder) {
		const emails = await (stub as any).getThreadedEmails({ folder, page, limit });
		const totalCount = await (stub as any).countThreadedEmails(folder);
		return c.json({ emails, totalCount });
	}
	const emails = await stub.getEmails({ folder, thread_id, page, limit, sortColumn, sortDirection });
	if (folder) {
		const totalCount = await stub.countEmails({ folder, thread_id });
		return c.json({ emails, totalCount });
	}
	return c.json(emails);
});

app.post("/api/v1/mailboxes/:mailboxId/emails", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const body = SendEmailRequestSchema.parse(await c.req.json());
	const { to, cc, bcc, from, subject, html, text, attachments, in_reply_to, references, thread_id } = body;

	let toStr: string, fromEmail: string, fromDomain: string;
	try {
		({ toStr, fromEmail, fromDomain } = validateSender(to, from, mailboxId));
	} catch (e) {
		if (e instanceof SenderValidationError) return c.json({ error: e.message }, 400);
		throw e;
	}

	let outboundConfig;
	try {
		outboundConfig = await getOutboundConfig(c.env, fromDomain);
		if (outboundConfig.provider === "none") return c.json({ error: "Outbound email is not enabled for this domain" }, 400);
	} catch (e) {
		return c.json({ error: (e as Error).message }, 400);
	}
	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = c.var.mailboxStub;
	const rateLimitError = await (stub as any).checkSendRateLimit();
	if (rateLimitError) return c.json({ error: rateLimitError }, 429);
	const attachmentData = await storeAttachments(c.env.BUCKET, messageId, attachments);

	await stub.createEmail(Folders.SENT, {
		id: messageId, subject, sender: fromEmail, recipient: toStr,
		cc: cc ? (Array.isArray(cc) ? cc.join(", ") : cc).toLowerCase() : null,
		bcc: bcc ? (Array.isArray(bcc) ? bcc.join(", ") : bcc).toLowerCase() : null,
		date: new Date().toISOString(), body: html || text || "",
		in_reply_to: in_reply_to || null, email_references: references ? JSON.stringify(references) : null,
		thread_id: thread_id || in_reply_to || messageId, message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: typeof from === "string" ? from : `${from.name} <${from.email}>` },
			{ key: "to", value: Array.isArray(to) ? to.join(", ") : to },
			...(cc ? [{ key: "cc", value: Array.isArray(cc) ? cc.join(", ") : cc }] : []),
			...(bcc ? [{ key: "bcc", value: Array.isArray(bcc) ? bcc.join(", ") : bcc }] : []),
			{ key: "subject", value: subject }, { key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
		]),
	}, attachmentData);

	c.executionCtx.waitUntil(
		sendEmail(c.env, {
			to, cc, bcc, from, subject, html, text,
			attachments: attachments?.map((att) => ({ content: att.content, filename: att.filename, type: att.type, disposition: att.disposition || "attachment", contentId: att.contentId })),
			...(in_reply_to ? { headers: buildThreadingHeaders(in_reply_to, references || []) } : {}),
		}, outboundConfig).catch((e) => console.error("Deferred email delivery failed:", (e as Error).message)),
	);
	return c.json({ id: messageId, status: "sent" }, 202);
});

app.post("/api/v1/mailboxes/:mailboxId/drafts", async (c: AppContext) => {
	const mailboxId = c.req.param("mailboxId")!;
	const { to, cc, bcc, subject, body, in_reply_to, thread_id, draft_id } = DraftBody.parse(await c.req.json());
	const stub = c.var.mailboxStub;
	if (draft_id) await stub.deleteEmail(draft_id); // not atomic — create-then-delete would be safer
	const messageId = crypto.randomUUID();
	const now = new Date().toISOString();
	await stub.createEmail(Folders.DRAFT, {
		id: messageId, subject: subject || "", sender: mailboxId.toLowerCase(),
		recipient: (to || "").toLowerCase(), cc: cc?.toLowerCase() || null, bcc: bcc?.toLowerCase() || null,
		date: now, body, in_reply_to: in_reply_to || null, email_references: null,
		thread_id: thread_id || in_reply_to || messageId,
	}, []);
	return c.json({ id: messageId, status: "draft", subject: subject || "", recipient: to || "", date: now }, 201);
});

app.get("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const email = await c.var.mailboxStub.getEmail(c.req.param("id")!);
	if (!email) return c.json({ error: "Email not found" }, 404);
	return new Response(JSON.stringify(email), {
		headers: { "Content-Type": "application/json" },
	});
});

app.put("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const { read, starred } = (await c.req.json()) as { read?: boolean; starred?: boolean };
	const email = await c.var.mailboxStub.updateEmail(c.req.param("id")!, { read, starred });
	return email ? c.json(email) : c.json({ error: "Email not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/emails/:id", async (c: AppContext) => {
	const id = c.req.param("id")!;
	const attachments = await c.var.mailboxStub.deleteEmail(id);
	if (attachments === null) return c.json({ error: "Not found" }, 404);
	if (attachments.length > 0) await c.env.BUCKET.delete(attachments.map((att: any) => `attachments/${id}/${att.id}/${att.filename}`));
	return c.body(null, 204);
});

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/move", async (c: AppContext) => {
	const { folderId } = (await c.req.json()) as { folderId: string };
	const success = await c.var.mailboxStub.moveEmail(c.req.param("id")!, folderId);
	return success ? c.json({ status: "moved" }) : c.json({ error: "Folder not found" }, 400);
});

// -- Threads --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/threads/:threadId", async (c: AppContext) => {
	return c.json(await (c.var.mailboxStub as any).getThreadEmails(c.req.param("threadId")!));
});

app.post("/api/v1/mailboxes/:mailboxId/threads/:threadId/read", async (c: AppContext) => {
	await c.var.mailboxStub.markThreadRead(c.req.param("threadId")!);
	return c.json({ status: "marked_read" });
});

// -- Reply / Forward ------------------------------------------------

app.post("/api/v1/mailboxes/:mailboxId/emails/:id/reply", handleReplyEmail);
app.post("/api/v1/mailboxes/:mailboxId/emails/:id/forward", handleForwardEmail);

// -- Folders --------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => c.json(await c.var.mailboxStub.getFolders()));

app.post("/api/v1/mailboxes/:mailboxId/folders", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const slug = slugify(name);
	if (!slug) return c.json({ error: "Folder name must contain alphanumeric characters" }, 400);
	const f = await c.var.mailboxStub.createFolder(slug, name);
	return f ? c.json(f, 201) : c.json({ error: "Folder with this name already exists" }, 409);
});

app.put("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const { name } = (await c.req.json()) as { name: string };
	const f = await c.var.mailboxStub.updateFolder(c.req.param("id")!, name);
	return f ? c.json(f) : c.json({ error: "Folder not found" }, 404);
});

app.delete("/api/v1/mailboxes/:mailboxId/folders/:id", async (c: AppContext) => {
	const ok = await c.var.mailboxStub.deleteFolder(c.req.param("id")!);
	return ok ? c.body(null, 204) : c.json({ error: "Folder not found or cannot be deleted" }, 400);
});

// -- Search ---------------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/search", async (c: AppContext) => {
	const searchOpts: Record<string, unknown> = {
		query: c.req.query("query") || "", folder: c.req.query("folder"), from: c.req.query("from"),
		to: c.req.query("to"), subject: c.req.query("subject"), date_start: c.req.query("date_start"),
		date_end: c.req.query("date_end"), is_read: boolQuery(c, "is_read"),
		is_starred: boolQuery(c, "is_starred"), has_attachment: boolQuery(c, "has_attachment"),
	};
	const stub = c.var.mailboxStub as any;
	const emails = await stub.searchEmails({ ...searchOpts, page: intQuery(c, "page"), limit: intQuery(c, "limit") });
	const totalCount = await stub.countSearchResults(searchOpts);
	return c.json({ emails, totalCount });
});

// -- Attachments ----------------------------------------------------

app.get("/api/v1/mailboxes/:mailboxId/emails/:emailId/attachments/:attachmentId", async (c: AppContext) => {
	const emailId = c.req.param("emailId")!;
	const attachmentId = c.req.param("attachmentId")!;
	const attachment = await c.var.mailboxStub.getAttachment(attachmentId);
	if (!attachment) return c.json({ error: "Attachment not found" }, 404);
	const obj = await c.env.BUCKET.get(`attachments/${emailId}/${attachmentId}/${attachment.filename}`);
	if (!obj) return c.json({ error: "Attachment file not found" }, 404);
	const headers = new Headers();
	headers.set("Content-Type", attachment.mimetype);
	const sanitized = attachment.filename.replace(/[\x00-\x1f"\\]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${sanitized}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`);
	return new Response(obj.body, { headers });
});

// -- Receive inbound email ------------------------------------------

const MAX_EMAIL_SIZE = 25 * 1024 * 1024;

interface InboundEmailEvent {
	raw: ReadableStream;
	rawSize: number;
	from?: string;
	to?: string;
}

async function streamToArrayBuffer(stream: ReadableStream, streamSize: number) {
	if (streamSize > MAX_EMAIL_SIZE) throw new Error(`Email too large: ${streamSize} bytes exceeds ${MAX_EMAIL_SIZE} byte limit`);
	if (streamSize <= 0) throw new Error(`Invalid stream size: ${streamSize}`);
	const result = new Uint8Array(streamSize);
	let bytesRead = 0;
	const reader = stream.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (bytesRead + value.length > streamSize) { reader.cancel(); throw new Error(`Stream exceeds declared size`); }
		result.set(value, bytesRead);
		bytesRead += value.length;
	}
	if (bytesRead !== streamSize) throw new Error(`Stream ended at ${bytesRead} bytes; expected ${streamSize}`);
	return result;
}

async function receiveEmail(event: InboundEmailEvent, env: Env, ctx: ExecutionContext) {
	const rawEmail = await streamToArrayBuffer(event.raw, event.rawSize);
	const parsedEmail = await new PostalMime().parse(rawEmail);

	const headerRecipients = (parsedEmail.to || []).map((recipient) => recipient.address?.toLowerCase()).filter(Boolean) as string[];
	const envelopeRecipient = event.to?.trim().toLowerCase();
	const allRecipients = [...new Set([...(envelopeRecipient ? [envelopeRecipient] : []), ...headerRecipients])];
	if (allRecipients.length === 0) throw new Error("received email with empty envelope and To header");
	const ccRecipients = (parsedEmail.cc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];
	const bccRecipients = (parsedEmail.bcc || []).map((e) => e.address?.toLowerCase()).filter(Boolean) as string[];

	let mailboxId: string | undefined;
	// Prefer the signed SMTP envelope recipient. This preserves catch-all and
	// BCC deliveries whose address may not appear in the message To header.
	for (const recipient of allRecipients) {
		const domain = recipient.split("@")[1];
		if (!domain) continue;
		const config = await getDomainConfigStub(env).get(domain);
		if (!config || config.inboundProvider !== "cloudflare") continue;
		if (config.emailAddresses.length === 0 || config.emailAddresses.includes(recipient)) {
			mailboxId = recipient;
			break;
		}
	}
	if (!mailboxId) { console.log("Ignoring email: no recipient matches a configured domain and allowed address."); return; }

	const messageId = crypto.randomUUID();
	const mailboxKey = `mailboxes/${mailboxId}.json`;
	const stub = env.MAILBOX.get(env.MAILBOX.idFromName(mailboxId));
	if (!(await env.BUCKET.head(mailboxKey))) {
		const localPart = mailboxId.split("@")[0] || mailboxId;
		await env.BUCKET.put(mailboxKey, JSON.stringify(defaultMailboxSettings(localPart)));
		// Initialize the mailbox Durable Object schema/folders before storing
		// the first message. Concurrent first deliveries are safe: both write
		// the same default R2 settings and the DO serializes initialization.
		await stub.getFolders();
		console.log(`Automatically created mailbox for ${mailboxId}`);
	}

	const attachmentData: StoredAttachment[] = [];
	if (parsedEmail.attachments) {
		for (const att of parsedEmail.attachments) {
			const attId = crypto.randomUUID();
			const filename = (att.filename || "untitled").replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_");
			await env.BUCKET.put(`attachments/${messageId}/${attId}/${filename}`, att.content);
			attachmentData.push({ id: attId, email_id: messageId, filename, mimetype: att.mimeType,
				size: typeof att.content === "string" ? att.content.length : att.content.byteLength,
				content_id: att.contentId || null, disposition: att.disposition || "attachment" });
		}
	}

	const extractMsgId = (s: string) => { const m = s.match(/<([^>]+)>/); return m ? m[1] : s.trim().split(/\s+/)[0]; };
	const inReplyTo = parsedEmail.inReplyTo ? extractMsgId(parsedEmail.inReplyTo) : null;
	const emailReferences = parsedEmail.references ? parsedEmail.references.split(/\s+/).filter(Boolean).map(extractMsgId) : [];
	let threadId = emailReferences[0] || inReplyTo || messageId;

	if (!inReplyTo && emailReferences.length === 0) {
		const subjectThread = await (stub as any).findThreadBySubject(parsedEmail.subject || "", parsedEmail.from?.address || undefined);
		if (subjectThread) threadId = subjectThread;
	}

	const originalMessageId = parsedEmail.messageId ? extractMsgId(parsedEmail.messageId) : null;

	await stub.createEmail(Folders.INBOX, {
		id: messageId, subject: parsedEmail.subject || "",
		sender: (parsedEmail.from?.address || "").toLowerCase(), recipient: allRecipients.join(", "),
		cc: ccRecipients.join(", ") || null, bcc: bccRecipients.join(", ") || null,
		date: new Date().toISOString(), // uses receive time, not the email's Date header
		body: parsedEmail.html || parsedEmail.text || "",
		in_reply_to: inReplyTo, email_references: emailReferences.length > 0 ? JSON.stringify(emailReferences) : null,
		thread_id: threadId, message_id: originalMessageId, raw_headers: JSON.stringify(parsedEmail.headers),
	}, attachmentData);

	const agentStub = env.EMAIL_AGENT.get(env.EMAIL_AGENT.idFromName(mailboxId));
	ctx.waitUntil(agentStub.fetch(new Request("https://agents/onNewEmail", {
		method: "POST", headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ mailboxId, emailId: messageId, sender: (parsedEmail.from?.address || "").toLowerCase(), subject: parsedEmail.subject || "", threadId }),
	})).catch((e) => console.error("Auto-draft trigger failed:", (e as Error).message)));
}

export { app, receiveEmail };
