<div align="center">
  <h1>Agentic Inbox</h1>
  <p><em>A self-hosted email client with an AI agent, running entirely on Cloudflare Workers</em></p>
</div>

Agentic Inbox lets you send, receive, and manage emails through a modern web interface -- all powered by your own Cloudflare account. Incoming emails arrive via [Cloudflare Email Routing](https://developers.cloudflare.com/email-routing/), each mailbox is isolated in its own [Durable Object](https://developers.cloudflare.com/durable-objects/) with a SQLite database, and attachments are stored in [R2](https://developers.cloudflare.com/r2/).

An **AI-powered Email Agent** can read your inbox, search conversations, and draft replies -- built with the [Cloudflare Agents SDK](https://developers.cloudflare.com/agents/) and [Workers AI](https://developers.cloudflare.com/workers-ai/).

![Agentic Inbox screenshot](./demo_app.png)


Read the blog post to learn more about Cloudflare Email Service and how to use it with the Agents SDK, MCP, and from the Wrangler CLI: [Email for Agents](https://blog.cloudflare.com/email-for-agents/).

## How to setup

**Important**: Clicking the 'Deploy to Cloudflare' button is only one part of the setup. You must follow the **After deploying** steps as well. For a full step-by-step guide with screenshots, refer to this comment: 
https://github.com/cloudflare/agentic-inbox/issues/4#issuecomment-4269118513

### To set up

1. Deploy to Cloudflare. The deploy flow automatically provisions R2, Durable Objects, and Workers AI. Open **Domains** in the app after deployment and add each domain you want to use.

     [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/cloudflare/agentic-inbox)

2. **Configure Cloudflare Access** -- Enable [one-click Cloudflare Access](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/) on your Worker under Settings > Domains & Routes. The modal will show your `POLICY_AUD` and `TEAM_DOMAIN` values. `TEAM_DOMAIN` can be either your Access team URL or the full `.../cdn-cgi/access/certs` URL. **You must set these as secrets for your Worker.**
3. **Set up Email Routing** -- In the Cloudflare dashboard, go to your domain > Email Routing and create a catch-all rule that forwards to this Worker
4. **Configure providers per domain** -- Incoming email uses Cloudflare Email Routing. Sending is off by default; enable Cloudflare Email Service or Resend from the domain management page. Make sure your domain is verified in [Resend](https://resend.com/domains) when using Resend.
5. **Create a mailbox** -- Visit your deployed app and create a mailbox for any address on your domain (e.g. `hello@example.com`)

### Troubleshooting Access

1. If you see `Invalid or expired Access token`, that usually means `POLICY_AUD` or `TEAM_DOMAIN` secrets are incorrect.
   * Resolution: [turn Access off and back on for the Worker to get the Access modal again](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then reset your Worker secrets to the latest `POLICY_AUD` and `TEAM_DOMAIN` values shown there.
2. If you see `Cloudflare Access must be configured in production`, this application is intentionally enforcing Cloudflare Access so your inbox is not exposed to anyone on the internet.
   * Resolution: enable Access using [one-click Cloudflare Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/), then set the `POLICY_AUD` and `TEAM_DOMAIN` Worker secrets from the modal values.

## Features

- **Full email client** — Send and receive emails via Cloudflare Email Routing with a rich text composer, reply/forward threading, folder organization, search, and attachments
- **Automatic mailbox creation** — The first valid incoming message for a configured domain creates its recipient mailbox automatically
- **Cross-account routing** — Connect and remove other Cloudflare accounts through OAuth without API tokens or a deployment CLI
- **Per-mailbox isolation** — Each mailbox runs in its own Durable Object with SQLite storage and R2 for attachments
- **Built-in AI agent** — Side panel with 9 email tools for reading, searching, drafting, and sending
- **Auto-draft on new email** — Agent automatically reads inbound emails and generates draft replies, always requiring explicit confirmation before sending
- **Configurable and persistent** — Custom system prompts per mailbox, persistent chat history, streaming markdown responses, and tool call visibility

## Stack

- **Frontend:** React 19, React Router v7, Tailwind CSS, Zustand, TipTap, COSS UI
- **Backend:** Hono, Cloudflare Workers, Durable Objects (SQLite), R2, Email Routing
- **AI Agent:** Cloudflare Agents SDK (`AIChatAgent`), AI SDK v6, Workers AI (`@cf/moonshotai/kimi-k2.5`), `react-markdown` + `remark-gfm`
- **Auth:** Cloudflare Access JWT validation (required outside local development)

## Getting Started

```bash
npm install
npm run dev
```

### Configuration

1. Create an R2 bucket named `agentic-inbox`: `wrangler r2 bucket create agentic-inbox`
2. Configure a random 256-bit master secret. The server generates its own RSA key pair and stores only its AES-256-GCM encrypted private key.

```bash
openssl rand -base64 32 | npx wrangler secret put DOMAIN_ENCRYPTION_MASTER_V1
```

For rotation, add the other slot:

```bash
openssl rand -base64 32 | npx wrangler secret put DOMAIN_ENCRYPTION_MASTER_V2
```

Then open **Domains** and click **Migrate to V2**. The button automatically changes to **Migrate to V1** when V2 is active, allowing the two independently generated secret slots to alternate. Migration decrypts and re-encrypts only the server-generated private key, verifies it before committing, and never decrypts stored Resend API keys. Do not delete the previously active secret until migration succeeds.

On every browser app startup, the Worker checks that the active secret exists, decrypts the stored private key, imports it, and verifies it against the public key with an RSA challenge. If the secret is missing, changed, or invalid, the app opens a dedicated setup page that can generate a secure value and provides deployment instructions.

The private key never leaves the Worker. The browser generates a random per-secret AES-256-GCM data key, authenticates the domain/provider as additional data, and wraps the data key with the server-generated RSA-OAEP/SHA-256 public key. Only the versioned envelope is stored.

### Deploy

```bash
npm run deploy              # Resend support
npm run deploy:cloudflare   # Resend + Cloudflare Email Service support
```

For local development with the remote Cloudflare Email Service binding, use `npm run dev:cloudflare` (Wrangler login is required). After startup, use the **Domains** page to add domains, restrict allowed addresses, and select a sending provider.

### Cross-account Email Routing

Cloudflare Email Routing can only select an Email Worker in the domain's own account. Agentic Inbox uses Cloudflare self-managed OAuth to connect other accounts directly from **Domains → Cloudflare accounts**. After consent, it deploys a small Relay Worker, installs its private Ed25519 key as a secret, configures Email Routing, and immediately revokes the short-lived OAuth token. No API token or CLI is required.

Create a confidential Cloudflare OAuth client using Authorization Code, PKCE S256, and the callback below. Grant Account Read, Workers Scripts Edit, Zone Read, Email Routing Rules Edit, and DNS Edit when Email Routing activation is required.

```text
https://YOUR_INBOX_HOST/api/v1/integrations/cloudflare/callback
```

Configure the three `CLOUDFLARE_OAUTH_*` bindings on the central Worker. Removing an integration starts another short OAuth authorization, restores the previous catch-all rules, deletes the Relay Worker, and removes its central public key.

Relay requests use `POST /api/v1/relay/email`, Ed25519 signatures, a five-minute timestamp, per-relay domain restrictions, and Durable Object nonce replay protection. If an upstream Cloudflare Access application protects the hostname, configure a bypass for the ingestion endpoint only; OAuth management and callback routes remain Access-protected. See [Cross-account Email Routing with Cloudflare OAuth](docs/cloudflare-oauth-relay.md) for OAuth client settings, permissions, Access policy requirements, lifecycle details, and troubleshooting.

## Prerequisites

- Cloudflare account with a domain
- [Email Routing](https://developers.cloudflare.com/email-routing/) enabled for receiving
- Optional outbound email: [Resend](https://resend.com/) or [Cloudflare Email Service](https://developers.cloudflare.com/email-service/), selected per domain
- [Workers AI](https://developers.cloudflare.com/workers-ai/) enabled (for the agent)
- [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) configured for deployed/shared environments (required in production)

Any user who passes the shared Cloudflare Access policy can access all mailboxes in this app by design. This includes the MCP server at `/mcp` -- external AI tools (Claude Code, Cursor, etc.) connected via MCP can operate on any mailbox by passing a `mailboxId` parameter. There is no per-mailbox authorization; the Cloudflare Access policy is the single trust boundary.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Browser    │────>│  Hono Worker     │────>│  MailboxDO      │
│  React SPA   │     │  (API + SSR)     │     │  (SQLite + R2)  │
│  Agent Panel │     │                  │     └─────────────────┘
└──────┬───────┘     │  /agents/* ──────┼────>┌─────────────────┐
       │             │                  │     │  EmailAgent DO  │
       │ WebSocket   │                  │     │  (AIChatAgent)  │
       └─────────────┤                  │     │  9 email tools  │
                     │                  │────>│  Workers AI     │
                     └──────────────────┘     └─────────────────┘
```

## License

Apache 2.0 -- see [LICENSE](LICENSE).
