import assert from "node:assert/strict";
import { test } from "node:test";
import { KnotClient, KnotDevelopmentClient, KnotError, compileGitHubPullRequest, compileSeedMarkdown, generatePkcePair } from "./index";

const secret = `knot_sandbox_${"x".repeat(43)}`;
test("development SDK has a distinct audience, rejects other environment keys and verifies state before exchange", async () => {
  const key = `knot_development_${"y".repeat(43)}`;
  let calls = 0;
  const client = new KnotDevelopmentClient({ secret: key, baseUrl: "https://example.com/api", fetch: async (url, init) => {
    calls++;
    assert.equal(String(url), "https://example.com/api/partner/v1/development/connections/id/context/query");
    assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify({ data: { current: [], history: [], personal_context: [], environment: "development" }, request_id: "safe-id" }));
  } });
  assert.throws(() => new KnotDevelopmentClient({ secret, baseUrl: "https://example.com/api" }));
  assert.throws(() => new KnotClient({ secret: key, baseUrl: "https://example.com/api" }));
  assert.throws(() => client.exchangeConnectCode({ session_id: "id", code: "code", callback_url: "https://example.com/callback", code_verifier: "x".repeat(43), state: "wrong", expected_state: "expected" }));
  assert.equal(calls, 0);
  assert.equal((await client.query("id", { query: "launch" })).environment, "development");
  assert.equal(calls, 1);
});
test("SDK never sends a key to redirects or validates state after a network call", async () => {
  let calls = 0;
  const client = new KnotClient({ secret, baseUrl: "https://example.com/api", fetch: async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, "error");
    return new Response(JSON.stringify({ error: { code: "insufficient_permission", message: "Denied" }, request_id: "safe-id" }), { status: 403 });
  } });
  assert.throws(() => client.exchangeConnectCode({ session_id: "id", code: "code", callback_url: "https://example.com/callback", code_verifier: "x".repeat(43), state: "wrong", expected_state: "expected" }));
  assert.equal(calls, 0);
  await assert.rejects(() => client.query("id", { query: "launch" }), (error: unknown) => error instanceof KnotError && error.code === "insufficient_permission" && error.requestId === "safe-id");
  assert.equal(calls, 1, "permission errors must not retry");
  assert.throws(() => new KnotClient({ secret, baseUrl: "http://example.com/api" }));
  assert.throws(() => new KnotClient({ secret, baseUrl: "https://example.com/wrong-base" }));
});
test("SDK bounded retries preserve input and never claim a timeout saved a contribution", async () => {
  const requests: unknown[] = [];
  const client = new KnotClient({ secret, baseUrl: "https://example.com/api", fetch: async (_url, init) => {
    requests.push(init?.body);
    if (requests.length < 3) throw new Error("Network timeout");
    return new Response(JSON.stringify({ data: { outcome: "accepted", replayed: true }, request_id: "safe-id" }));
  } });
  const input = { idempotency_key: "same-key", kind: "decision" as const, statement: "Synthetic decision" };
  assert.equal((await client.contribute("id", input)).replayed, true);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request === JSON.stringify(input)));
  let count = 0;
  const unreachable = new KnotClient({ secret, baseUrl: "https://example.com/api", fetch: async () => { count++; throw new Error("Network unavailable"); } });
  await assert.rejects(() => unreachable.contribute("id", input), (error: unknown) => error instanceof KnotError && error.code === "transport_error");
  assert.equal(count, 3);
});

test("production credentials work with default baseUrl and auto-inferred environment", async () => {
  const prodKey = `knot_prod_${"z".repeat(43)}`;
  let capturedUrl = "";
  const client = new KnotClient({
    secret: prodKey,
    fetch: async (url) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({
        data: { current: [], history: [], personal_context: [], environment: "production" },
        request_id: "prod-req-1",
      }));
    },
  });
  const res = await client.query("conn-123", { query: "tech stack" });
  assert.equal(capturedUrl, "https://production.connectknot.com/api/partner/v1/connections/conn-123/context/query");
  assert.equal(res.environment, "production");
});

test("generatePkcePair creates valid RFC 7636 S256 verifier and challenge", () => {
  const pair = generatePkcePair();
  assert.equal(pair.method, "S256");
  assert.ok(/^[A-Za-z0-9_-]{43,128}$/.test(pair.verifier), "verifier matches PKCE spec");
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(pair.challenge), "challenge is base64url sha256");
});

test("batchContribute sequentially submits items and changes retrieves history", async () => {
  const itemsSent: string[] = [];
  const client = new KnotClient({
    secret,
    baseUrl: "https://example.com/api",
    fetch: async (url, init) => {
      const urlStr = String(url);
      if (urlStr.includes("/contributions")) {
        const body = JSON.parse(String(init?.body));
        itemsSent.push(body.statement);
        return new Response(JSON.stringify({
          data: { outcome: "accepted", replayed: false },
          request_id: `req-${itemsSent.length}`,
        }));
      }
      if (urlStr.includes("/context/query")) {
        return new Response(JSON.stringify({
          data: {
            current: [],
            history: [{ id: "hist-1", kind: "decision", statement: "Historical item", status: "active", source: "test", created_at: new Date().toISOString(), supersedes_id: null }],
            environment: "sandbox",
          },
          request_id: "req-hist",
        }));
      }
      throw new Error(`Unexpected url: ${urlStr}`);
    },
  });

  const batchResults = await client.batchContribute("conn-abc", [
    { idempotency_key: "k1", kind: "fact", statement: "Fact 1" },
    { idempotency_key: "k2", kind: "decision", statement: "Decision 2" },
  ]);
  assert.equal(batchResults.length, 2);
  assert.deepEqual(itemsSent, ["Fact 1", "Decision 2"]);

  const history = await client.changes("conn-abc");
  assert.equal(history.length, 1);
  assert.equal(history[0].statement, "Historical item");
});

test("compileSeedMarkdown and seedFromMarkdown decompose markdown into classified idempotent contributions", async () => {
  const markdown = [
    "# Architecture Decisions",
    "- Decided to migrate billing webhooks from Stripe v1 to Paddle",
    "- Never store plaintext embeddings without orthogonal rotation",
    "- Prefer concise technical responses with code links",
    "- Primary database runs on Neon Serverless Postgres 16",
  ].join("\n");

  const compiled = compileSeedMarkdown(markdown, { prefix: "Knot Core" });
  assert.equal(compiled.length, 4);
  assert.equal(compiled[0]!.kind, "decision");
  assert.equal(compiled[1]!.kind, "constraint");
  assert.equal(compiled[2]!.kind, "preference");
  assert.equal(compiled[3]!.kind, "project_state");
  assert.ok(compiled.every((item) => item.idempotency_key.startsWith("seed_")));

  const payloads: unknown[] = [];
  const client = new KnotClient({
    secret,
    baseUrl: "https://example.com/api",
    fetch: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        data: { outcome: "accepted", replayed: false },
        request_id: "req-seed",
      }));
    },
  });

  const results = await client.seedFromMarkdown("conn-seed", markdown, { prefix: "Knot Core" });
  assert.equal(results.length, 4);
  assert.equal(payloads.length, 4);
});

test("compileGitHubPullRequest and ingestGitHubPullRequest compile merged PRs into decision and constraint atoms", async () => {
  const prInput = {
    repo: "units-studio/knot",
    number: 108,
    title: "Enforce orthogonal rotation on all pgvector embeddings",
    body: [
      "Mitigates Vec2Text inversion attacks across tenant vector stores.",
      "",
      "## Architecture",
      "- Decided to derive per-tenant orthogonal matrices via HKDF-SHA256",
      "- Never persist unrotated embeddings in structured_context_items",
    ].join("\n"),
    mergedAt: "2026-10-20T12:00:00Z",
  };

  const atoms = compileGitHubPullRequest(prInput);
  assert.equal(atoms.length, 3);
  assert.equal(atoms[0]!.kind, "decision");
  assert.ok(atoms[0]!.idempotency_key.startsWith("gh_pr_108_"));
  assert.ok(atoms[0]!.statement.includes("[units-studio/knot PR #108] Decided and merged: Enforce orthogonal rotation"));
  assert.equal(atoms[1]!.kind, "decision");
  assert.equal(atoms[2]!.kind, "constraint");

  const payloads: unknown[] = [];
  const client = new KnotClient({
    secret,
    baseUrl: "https://example.com/api",
    fetch: async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({
        data: { outcome: "accepted", replayed: false },
        request_id: "req-pr",
      }));
    },
  });

  const results = await client.ingestGitHubPullRequest("conn-gh", prInput);
  assert.equal(results.length, 3);
  assert.equal(payloads.length, 3);
});

