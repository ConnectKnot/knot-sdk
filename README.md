# @knot-ai/sdk

Official server-side TypeScript SDK for **Knot** — the Shared Brain for all your AIs.

Knot gives your AI product instant access to your user's shared brain. When a user connects Knot, your AI app can query their existing project decisions, tech stack, constraints, and preferences established in ChatGPT, Claude, and Cursor on **Turn 0** without cold-start friction or manual prompt copy-pasting.

---

## Installation

Install via npm:
```bash
npm install @knot-ai/sdk
# or
pnpm add @knot-ai/sdk
```

Or install directly from GitHub (releases / repository):
```bash
# Direct from GitHub repository
npm install github:ConnectKnot/knot-sdk

# Direct from GitHub Release tarball
npm install https://github.com/ConnectKnot/knot-sdk/releases/download/v0.1.1/knot-ai-sdk-0.1.1.tgz
```

---

## ⚡ One-Shot AI Prompt (Cursor, Windsurf, Claude Code)

Copy and paste this prompt directly into **Cursor Composer (⌘I)**, **Claude Code**, **Windsurf Cascade**, or **Copilot Workspace** to integrate Knot in 60 seconds:

```markdown
Integrate "Continue with Knot" into this application using @knot-ai/sdk so our users can connect their cross-tool AI memory (tech stack, architectural decisions, and constraints from ChatGPT, Claude, and Cursor) seamlessly:

1. Install the SDK:
   Run `npm install @knot-ai/sdk`

2. Add Frontend "Continue with Knot" Button:
   In our authentication, user settings, or header component, add:
   ```tsx
   import { ContinueWithKnot } from '@knot-ai/sdk/react';

   <ContinueWithKnot
     clientId={process.env.NEXT_PUBLIC_KNOT_CLIENT_ID || 'client_demo'}
     externalUserId={currentUser.id}
     appName="Our App Name"
     onSuccess={async ({ connectionId, reach, capabilities }) => {
       // Save connectionId to our user profile API
       await fetch('/api/user/knot-connection', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ connectionId, reach, capabilities }),
       });
     }}
   />
   ```

3. Add Backend Context Injection on Turn-0:
   When generating AI completions or chatting with our models, initialize the Knot client and query the user's active context:
   ```ts
   import { KnotClient } from '@knot-ai/sdk';

   const knot = new KnotClient({
     secret: process.env.KNOT_SECRET!, // set KNOT_SECRET in .env (knot_prod_* or knot_sandbox_*)
   });

   // In our LLM route / chat handler:
   const userConnectionId = currentUser.knotConnectionId;
   let knotContext = "";
   if (userConnectionId) {
     const { current } = await knot.query(userConnectionId, { query: userPrompt, limit: 6 });
     knotContext = current.map((item) => `[${item.kind.toUpperCase()}] ${item.statement}`).join('\n');
   }

   // Prepend knotContext to our model's system prompt:
   const systemPrompt = `You are an AI assistant. User's verified project invariants:\n${knotContext}`;
   ```

4. Persist Ratified Decisions back to Knot:
   When the user or AI establishes a new project rule or architectural decision, call:
   ```ts
   await knot.contribute(userConnectionId, {
     kind: 'decision',
     statement: 'New architectural decision or constraint text',
     idempotency_key: `decision-${Date.now()}`,
   });
   ```

Keep implementation clean, type-safe, and gracefully handle cases where the user has not connected Knot yet.
```

---

## Frontend Drop-In Consent UI: `<ContinueWithKnot />`

### The Plaid of AI: Instant Turn-0 Shared Context

Just like **Plaid** allows fintech products to connect to users' bank accounts without storing raw login credentials, **Knot** allows AI apps to connect to users' existing cross-tool memory established in ChatGPT, Claude, and Cursor without asking users to copy-paste context or start from scratch on Turn 0.

### Why Support "Connect with Knot"?

1. **No More Copy-Pasting Background**:
   When users connect Knot, your app immediately knows what they're building, their tech stack, and their rules. No blank prompt boxes or repetitive explanations.
2. **Users See Exactly What They Share**:
   Instead of confusing permission lists, users see a clear preview of the project notes being shared. Personal details and secrets stay completely private.
3. **Two-Way Memory Across All Their AI Tools**:
   Any architecture decisions or constraints created in your app save back to Knot, synchronizing the user's IDE (Cursor, Windsurf) and assistant (Claude, ChatGPT) automatically.

### 3-Line React Drop-In

```tsx
import { ContinueWithKnot } from '@knot-ai/sdk/react';

export function ConnectMemoryBanner({ userId }: { userId: string }) {
  return (
    <ContinueWithKnot
      clientId="client_01j7b9k"
      externalUserId={userId}
      appName="My AI Studio"
      onSuccess={({ connectionId, reach, capabilities, envelope }) => {
        // Save connectionId alongside your user record:
        console.log('Connected Knot context:', connectionId, reach, capabilities);
      }}
    />
  );
}
```

### Visualizing the Value (44-Token Active State Envelope)
Instead of a boring wall of text, the consent sheet visualizes the exact active state envelope the user is handing to your app:
- **High-contrast telemetry badge**:
  > *"Sharing: 4 Architecture Decisions & 2 Active Threads · Shielding: 14 Personal Items & 3 API Keys"*
- **Live token counter**: Displays the compressed token envelope size (e.g. 44 Tokens) entering the app context.

### One-Click Context Reach & Scope Control
The user maintains sovereign control over their knowledge graph before any data moves:
- **Context Reach Selector**:
  - `Project Slice Only` *(Recommended)*: Repo, tech stack, and project-specific invariants.
  - `Selected Invariants`: High-level architecture and cryptographic constraints only.
  - `Zero Personal Context`: Complete isolation from personal background.
- **Granular Capability Scopes**:
  - `context:read`: Read authorized project memory slices.
  - `context:propose`: Write proposals quarantined in a human approval queue.
  - `context:contribute:project`: Direct canonical contribution to the project bus.

---

## Quickstart (Server-Side)

### 1. Initialize the Client

```typescript
import { KnotClient } from '@knot-ai/sdk';

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
