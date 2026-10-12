import assert from "node:assert/strict";
import { test } from "node:test";
import { KnotClient, KnotDevelopmentClient, KnotError } from "./index.js";

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
