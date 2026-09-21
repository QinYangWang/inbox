# Cross-account Email Routing with Cloudflare OAuth

Cloudflare Email Routing can invoke only an Email Worker in the same Cloudflare account as the receiving zone. Agentic Inbox bridges other accounts by deploying a small signed relay Worker through Cloudflare self-managed OAuth.

The integration is managed entirely in the web application. It does not use a deployment CLI, user-created API tokens, shared relay secrets, or a long-lived relay administration token.

## One-time OAuth client setup

Create an OAuth client under **Cloudflare Dashboard → Manage Account → OAuth clients**.

Use these settings:

- Grant type: `authorization_code`
- Response type: `code`
- Token authentication method: `client_secret_basic`
- PKCE: `S256`
- Redirect URL: `https://YOUR_INBOX_HOST/api/v1/integrations/cloudflare/callback`

Select the minimum permissions required to discover zones, deploy the relay, and update Email Routing:

- Account Read
- Workers Scripts Edit
- Zone Read
- Email Routing Rules Edit
- DNS Edit if OAuth should also enable Email Routing and create its required DNS records

A private OAuth client can be authorized only by members of its owning Cloudflare account. To connect accounts belonging to other users, verify the OAuth client's publisher domain and permanently promote the client to public visibility.

Configure the central Worker:

```bash
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_ID
npx wrangler secret put CLOUDFLARE_OAUTH_CLIENT_SECRET
npx wrangler secret put CLOUDFLARE_OAUTH_REDIRECT_URI
```

The redirect URI value must exactly match the URL registered on the OAuth client.

## Cloudflare Access

Keep the OAuth management endpoints and callback protected by Cloudflare Access. The returning browser carries its Access session through the callback.

The remote Email Worker cannot complete an interactive Access login. If an upstream Access application protects the inbox hostname, add a bypass policy for this exact endpoint only:

```text
POST /api/v1/relay/email
```

Do not bypass Access for `/api/v1/integrations/*`, the UI, mailbox APIs, MCP, or agent routes. The relay endpoint still requires an Ed25519 signature, authorized recipient domain, fresh timestamp, and unused nonce.

## Connect an account

The fastest path is **Domains → Add domain**:

1. Enter the receiving domain.
2. Under **Receiving account**, choose an already-connected Cloudflare account or **Connect a new Cloudflare account**.
3. Select **Authorize with Cloudflare** and approve the requested permissions.

The domain record is created automatically when the callback succeeds; cancelling authorization leaves no trace. Choosing an existing account routes the new domain through that account's existing relay Worker — the zone must belong to the connected account. Choosing a new account deploys a fresh relay Worker.

Alternatively, add domains first and open **Domains → Cloudflare accounts** to select several already-configured domains that belong to one account and authorize them together.

After the callback, Agentic Inbox:

1. Creates domain records for any domains submitted from the Add domain dialog.
2. Verifies every selected zone belongs to the same authorized account (or to the selected connected account).
3. Generates an Ed25519 key pair in Worker memory (skipped when reusing a connected account's relay).
4. Uploads the relay module through the Workers Scripts API.
5. stores the private key only as a secret on that relay Worker.
6. Stores only the public key in the central Domain Config Durable Object.
7. Saves the existing catch-all configuration for each zone.
8. Points each catch-all rule to the relay Worker.
9. Revokes the short-lived Cloudflare OAuth access token.

No OAuth token or relay private key is persisted by Agentic Inbox.

## Remove an integration

Select **Remove integration** and authorize the owning Cloudflare account again. Agentic Inbox then:

1. Restores every saved catch-all configuration.
2. Deletes the remote relay Worker and its secret.
3. Deletes the central integration record, public key, and replay nonces.
4. Revokes the short-lived OAuth token.

The central integration record is retained if cleanup fails, allowing the operation to be retried. Worker deletion treats an already-removed Worker as successful.

## Relay request security

Each relay signs a canonical payload containing:

- Protocol version
- Relay ID
- Unix timestamp
- Random nonce
- SMTP envelope sender and recipient
- SHA-256 digest of the complete RFC 822 message

The central Worker verifies the Ed25519 signature, enforces a five-minute clock window, checks the relay's recipient-domain allowlist, reapplies the domain's allowed-address rules, and atomically claims the nonce in a Durable Object. Successfully processed nonces cannot be replayed.

## Troubleshooting

- **Cloudflare OAuth is not configured**: set all three `CLOUDFLARE_OAUTH_*` bindings and redeploy.
- **OAuth request is invalid or expired**: restart authorization; OAuth state is single-use and expires after ten minutes.
- **Could not uniquely resolve zone**: authorize the account that owns the selected domain and ensure Zone Read was granted.
- **Cloudflare API 403**: update the OAuth client's scopes and authorize again.
- **Different-account error**: connect domains from each Cloudflare account as separate integrations.
- **Does not belong to the connected account**: the domain's zone lives in another account; add it with **Connect a new Cloudflare account** instead.
- **Relay receives Access HTML/403**: configure an upstream Access bypass for `/api/v1/relay/email` only.
