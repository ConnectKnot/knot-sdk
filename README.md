# @knot/sdk

Official server-side TypeScript SDK for **Knot** — the Cross-Agent Context & Continuity Bus for AI apps.

Knot gives your AI product instant cross-tool shared memory. When a user connects Knot, your AI app can query their existing project decisions, tech stack, constraints, and preferences established in ChatGPT, Claude, and Cursor on **Turn 0** — without cold-start friction or manual prompt copy-pasting.

---

## Installation

```bash
npm install @knot/sdk
# or
pnpm add @knot/sdk
# or
yarn add @knot/sdk
```

---

## Quickstart

### 1. Initialize the Client

```typescript
import { KnotClient } from '@knot/sdk';

// Automatically infers environment (production vs sandbox) from your secret prefix:
const knot = new KnotClient({
  secret: process.env.KNOT_SECRET!, // 'knot_prod_...' or 'knot_sandbox_...'
  baseUrl: process.env.KNOT_API_URL, // Optional: defaults to 'https://production.connectknot.com/api'
});
```

---

### 2. User Connect Session (One-Time Consent)

Direct your user to Knot's hosted consent screen to link their context:

```typescript
// On your server (e.g., Next.js API route or Express handler)
const session = await knot.createConnectSession({
  external_user_id: user.id, // Your app's internal user ID
  callback_url: 'https://yourapp.com/api/knot/callback',
  capabilities: ['context:read', 'context:contribute:project'],
  state: generatedState,
  code_challenge: pkceChallenge,
});

// Redirect user to the hosted consent URL:
res.redirect(session.consent_url);
```

After the user approves, exchange the authorization code in your callback handler:

```typescript
const connection = await knot.exchangeConnectCode({
  session_id: req.query.session_id,
  code: req.query.code,
  callback_url: 'https://yourapp.com/api/knot/callback',
  code_verifier: storedVerifier,
  state: req.query.state,
  expected_state: storedState,
});

// Save connection.id to your database alongside the user's record
await db.users.update(user.id, { knotConnectionId: connection.id });
```

---

### 3. Ambient Turn-0 Context Injection

Whenever the user prompts your AI app, fetch their active project context before generating:

```typescript
// Query relevant context for the user's prompt
const { current } = await knot.query(user.knotConnectionId, {
  query: userPrompt,
  limit: 5,
});

// Inject into your LLM's system prompt (OpenAI, Anthropic, Gemini, Vercel AI SDK)
const systemPrompt = `You are a helpful assistant.
User's cross-tool project context:
${current.map((item) => `- [${item.kind.toUpperCase()}] ${item.statement}`).join('\n')}`;
```

---

### 4. Ambient Context Contribution

When your AI generates a key architectural decision, wireframe, or milestone, save it back to Knot:

```typescript
await knot.contribute(user.knotConnectionId, {
  kind: 'decision',
  statement: 'Adopted Tailwind CSS and Lucide icons for the design system.',
  idempotency_key: 'design-system-decision-v1',
});
```

Now, the next time the user asks Claude Desktop, Cursor, or ChatGPT about their project, those tools will already know about this decision.

---

## Environments

| Environment | Key Prefix | Base URL | Usage |
| :--- | :--- | :--- | :--- |
| **Production** | `knot_prod_...` / `knot_live_...` | `https://production.connectknot.com/api` | Real user context across live integrations. |
| **Sandbox** | `knot_sandbox_...` | `https://production.connectknot.com/api` | Isolated synthetic environment for integration testing. |
| **Development** | `knot_development_...` | `http://localhost:3000/api` | Local loopback development mode. |

---

## Error Handling

All API errors throw instances of `KnotError`:

```typescript
import { KnotError } from '@knot/sdk';

try {
  await knot.query(connectionId, { query: 'stack' });
} catch (err) {
  if (err instanceof KnotError) {
    console.error('Status:', err.status); // e.g. 403, 429
    console.error('Code:', err.code);     // e.g. 'insufficient_permission'
    console.error('Request ID:', err.requestId);
    if (err.retryAfter) {
      console.warn(`Rate limited. Retry after ${err.retryAfter}s`);
    }
  }
}
```

---

## License

MIT © [Knot Team](https://connectknot.com)
