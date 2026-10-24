import { createHash, randomBytes } from "node:crypto";
import type {
  DevelopmentConnectionResult, DevelopmentContextResult, DevelopmentContributionInput,
  DevelopmentContributionResult, DevelopmentQueryInput,
  SandboxSessionInput, SandboxExchangeInput, SandboxSessionResult, SandboxConnectionResult,
  SandboxContextResult, SandboxQueryInput, SandboxContributionInput, SandboxContributionResult,
  SandboxStatusResult, KnotEnvironment, PkcePair,
} from "./types.js";

export * from "./types.js";

export class KnotError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
    public readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "KnotError";
  }
}

/**
 * Generate a cryptographically secure RFC 7636 PKCE pair (S256).
 * Suitable for initializing partner connect sessions with Knot.
 */
export function generatePkcePair(length = 64): PkcePair {
  const byteLength = Math.max(32, Math.min(96, Math.floor((length * 3) / 4)));
  const verifier = randomBytes(byteLength)
    .toString("base64url")
    .slice(0, Math.max(43, Math.min(128, length)));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return {
    verifier,
    challenge,
    method: "S256",
  };
}

export interface KnotClientOptions {
  /** Server-only environment credential (knot_prod_*, knot_live_*, knot_sandbox_*, or knot_development_*). */
  secret: string;
  /** Explicit trusted origin + /api. Defaults to https://production.connectknot.com/api if omitted. */
  baseUrl?: string;
  /** Explicit target environment. Inferred automatically from secret prefix if omitted. */
  environment?: KnotEnvironment;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

type Envelope<T> = { data: T; request_id: string };

// Zod's generated server models use Date. HTTP JSON carries ISO strings.
export type Wire<T> = T extends Date
  ? string
  : T extends readonly (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T;

function inferEnvironment(secret: string): KnotEnvironment {
  if (secret.startsWith("knot_sandbox_")) return "sandbox";
  if (secret.startsWith("knot_development_")) return "development";
  if (secret.startsWith("knot_prod_") || secret.startsWith("knot_live_")) return "production";
  throw new Error("Invalid credential prefix. Expected knot_prod_*, knot_live_*, knot_sandbox_*, or knot_development_*");
}

function validateSecret(secret: string, environment: KnotEnvironment): void {
  if (environment === "sandbox") {
    if (!/^knot_sandbox_[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new Error("A valid sandbox credential (knot_sandbox_*) is required.");
    }
  } else if (environment === "development") {
    if (!/^knot_development_[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new Error("A valid development credential (knot_development_*) is required.");
    }
  } else {
    if (!/^knot_(prod|live)_[A-Za-z0-9_-]{43}$/.test(secret)) {
      throw new Error("A valid production credential (knot_prod_* or knot_live_*) is required.");
    }
  }
}

/** Server SDK for Knot. No transcript storage, implicit cache or automatic writes. */
class KnotTransport {
  protected readonly baseUrl: string;
  protected readonly secret: string;
  protected readonly fetcher: typeof fetch;
  protected readonly timeoutMs: number;
  protected readonly environment: KnotEnvironment;

  constructor(options: KnotClientOptions, explicitEnvironment?: KnotEnvironment) {
    if ("window" in globalThis) throw new Error("KnotClient is server-only. Open hosted consent from browser code instead.");
    const env = explicitEnvironment ?? options.environment ?? inferEnvironment(options.secret ?? "");
    if (explicitEnvironment === "sandbox" && env !== "sandbox" && env !== "production") {
      throw new Error("A valid sandbox or production credential is required.");
    }
    validateSecret(options.secret ?? "", env);
    this.environment = env;

    const rawBase = options.baseUrl ?? "https://production.connectknot.com/api";
    const base = new URL(rawBase);
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
    if (
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      (base.protocol !== "https:" && !(loopback && base.protocol === "http:")) ||
      !base.pathname.replace(/\/$/, "").endsWith("/api")
    ) {
      throw new Error("Use an HTTPS API base URL, or a loopback HTTP development URL, ending in /api.");
    }
    this.baseUrl = base.toString().replace(/\/$/, "");
    this.secret = options.secret;
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) throw new Error("timeoutMs must be positive.");
  }

  protected async request<T>(path: string, method: string, body?: unknown, retry = false): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const envPrefix = this.environment === "development" ? "/development" : "";
        const response = await this.fetcher(`${this.baseUrl}/partner/v1${envPrefix}${path}`, {
          method,
          redirect: "error",
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${this.secret}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        let result: unknown;
        try {
          result = await response.json();
        } catch {
          throw new KnotError(response.status, "invalid_response", "Knot returned an invalid response.");
        }
        if (!result || typeof result !== "object" || Array.isArray(result)) {
          throw new KnotError(response.status, "invalid_response", "Knot returned an invalid response.");
        }
        const envelope = result as Envelope<T> & { error?: { code?: string; message?: string } };
        if (!response.ok) {
          const rawRetry = response.headers.get("Retry-After");
          const retryAfter = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined;
          throw new KnotError(
            response.status,
            envelope.error?.code ?? "request_failed",
            envelope.error?.message ?? "Knot request failed.",
            envelope.request_id,
            retryAfter,
          );
        }
        if (!("data" in envelope)) throw new KnotError(response.status, "invalid_response", "Knot returned an invalid response.");
        return envelope.data;
      } catch (error) {
        const canRetry = retry && attempt < 2 && (!(error instanceof KnotError) || [429, 503].includes(error.status));
        // Never retry permission errors, consent exchanges or malformed successful responses.
        if (!canRetry) {
          if (error instanceof KnotError) throw error;
          throw new KnotError(0, "transport_error", "Knot could not be reached; no successful save is assumed.");
        }
        const delay = error instanceof KnotError && error.retryAfter
          ? Math.min(error.retryAfter * 1000, 2000)
          : 150 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw new KnotError(0, "transport_error", "Knot could not be reached.");
  }
}

export class KnotClient extends KnotTransport {
  constructor(options: KnotClientOptions) {
    const env = options.environment ?? inferEnvironment(options.secret ?? "");
    if (env === "development") {
      throw new Error("Use KnotDevelopmentClient for development environment credentials.");
    }
    super(options, env);
  }

  createConnectSession(input: SandboxSessionInput): Promise<Wire<SandboxSessionResult["data"]>> {
    return this.request("/connect-sessions", "POST", input);
  }

  exchangeConnectCode(input: SandboxExchangeInput & { state: string; expected_state: string }): Promise<Wire<SandboxConnectionResult["data"]>> {
    if (!input.expected_state || input.state !== input.expected_state) {
      throw new KnotError(400, "state_mismatch", "The authorization state does not match.");
    }
    const { state: _state, expected_state: _expected, ...body } = input;
    return this.request("/connect-exchanges", "POST", body);
  }

  getConnection(id: string): Promise<Wire<SandboxConnectionResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "GET", undefined, true);
  }

  query(id: string, input: SandboxQueryInput): Promise<Wire<SandboxContextResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}/context/query`, "POST", input, true);
  }

  contribute(id: string, input: SandboxContributionInput): Promise<Wire<SandboxContributionResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}/contributions`, "POST", input, true);
  }

  /** Sequentially submit multiple contribution items under this connection. */
  async batchContribute(id: string, items: SandboxContributionInput[]): Promise<Wire<SandboxContributionResult["data"]>[]> {
    const results: Wire<SandboxContributionResult["data"]>[] = [];
    for (const item of items) {
      results.push(await this.contribute(id, item));
    }
    return results;
  }

  /**
   * Zero-LLM Context Seeder: deterministically decomposes Markdown bullets/rules
   * (e.g. from GitHub PRs, CLAUDE.md, Notion exports, or Linear specs) into typed,
   * idempotent context atoms and submits them under this connection.
   */
  async seedFromMarkdown(
    id: string,
    markdown: string,
    options?: { prefix?: string; maxItems?: number },
  ): Promise<Wire<SandboxContributionResult["data"]>[]> {
    const items = compileSeedMarkdown(markdown, options);
    return this.batchContribute(id, items);
  }

  /**
   * B2B Decision Compiler for GitHub Pull Requests: compiles a merged PR into
   * canonical architectural decision and constraint atoms under this connection.
   */
  async ingestGitHubPullRequest(
    id: string,
    pr: GitHubPullRequestDecisionInput,
  ): Promise<Wire<SandboxContributionResult["data"]>[]> {
    const items = compileGitHubPullRequest(pr);
    return this.batchContribute(id, items);
  }

  /** Read historical changes and audit entries for this connection. */
  async changes(id: string, options?: { query?: string; limit?: number }): Promise<Wire<SandboxContextResult["data"]["history"]>> {
    const res = await this.query(id, { query: options?.query ?? "context", limit: options?.limit });
    return res.history;
  }

  disconnect(id: string): Promise<Wire<SandboxStatusResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "DELETE", undefined, true);
  }
}

export interface GitHubPullRequestDecisionInput {
  repo: string;
  number: number;
  title: string;
  body?: string | null;
  mergedAt?: string | null;
  labels?: string[];
}

function classifyMarkdownStatement(line: string): SandboxContributionInput["kind"] {
  const lower = line.toLowerCase();
  if (/\b(never|must|strictly|do not|don't|prohibited|mandatory|always|forbid)\b/.test(lower)) {
    return "constraint";
  }
  if (/\b(decided|migrated|chose|switched|selected|standardized|replaced|adopted)\b/.test(lower)) {
    return "decision";
  }
  if (/\b(prefer|preference|style|tone|concise|formatting)\b/.test(lower)) {
    return "preference";
  }
  if (/\b(stack|database|deploy|architecture|schema|endpoint|runtime|framework|monorepo|typescript|postgres|neon)\b/.test(lower)) {
    return "project_state";
  }
  return "fact";
}

/**
 * Deterministically compiles raw Markdown text into typed, idempotent Knot contribution inputs.
 */
export function compileSeedMarkdown(
  markdown: string,
  options?: { prefix?: string; maxItems?: number },
): SandboxContributionInput[] {
  const maxItems = Math.max(1, Math.min(options?.maxItems ?? 25, 50));
  const prefix = options?.prefix ? `${options.prefix.trim()}: ` : "";
  const lines = markdown.split(/\r?\n/);
  const items: SandboxContributionInput[] = [];
  const seen = new Set<string>();
  let inCodeFence = false;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence || !trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--") || /^[-=*_]{3,}$/.test(trimmed)) {
      continue;
    }
    const cleaned = trimmed
      .replace(/^(?:[-*•+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX]\]\s+/, "")
      .trim();
    if (cleaned.length < 10 || cleaned.length > 1500) continue;

    const statement = `${prefix}${cleaned}`;
    const dedupeKey = statement.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const hash = createHash("sha256").update(statement).digest("base64url").slice(0, 24);
    items.push({
      idempotency_key: `seed_${hash}`,
      kind: classifyMarkdownStatement(cleaned),
      statement,
    });
    if (items.length >= maxItems) break;
  }

  return items;
}

/**
 * Deterministically compiles a merged GitHub Pull Request into canonical decision and constraint atoms.
 * Designed for zero-LLM GitHub Actions (`pull_request.closed` when `merged == true`) and B2B webhook pipelines.
 */
export function compileGitHubPullRequest(
  pr: GitHubPullRequestDecisionInput,
): SandboxContributionInput[] {
  const repo = pr.repo.trim();
  const title = pr.title.trim();
  if (!repo || !title || !Number.isInteger(pr.number) || pr.number <= 0) {
    throw new Error("compileGitHubPullRequest requires a valid repo, positive PR number, and title.");
  }

  const rawBody = (pr.body ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  const firstParagraph = rawBody
    .split(/\r?\n\s*\r?\n/)[0]
    ?.replace(/^#+\s+/gm, "")
    .replace(/\r?\n+/g, " ")
    .trim()
    .slice(0, 320);

  const primaryStatement = `[${repo} PR #${pr.number}] Decided and merged: ${title}${firstParagraph ? ` — ${firstParagraph}` : ""}`;
  const prHash = createHash("sha256").update(`${repo}#${pr.number}:${title}`).digest("base64url").slice(0, 20);

  const atoms: SandboxContributionInput[] = [
    {
      idempotency_key: `gh_pr_${pr.number}_${prHash}`,
      kind: "decision",
      statement: primaryStatement,
    },
  ];

  if (rawBody) {
    const bulletAtoms = compileSeedMarkdown(rawBody, {
      prefix: `[${repo} PR #${pr.number}]`,
      maxItems: 5,
    }).filter((item) => item.kind === "decision" || item.kind === "constraint" || item.kind === "project_state");
    for (const atom of bulletAtoms) {
      if (atom.statement !== primaryStatement) {
        atoms.push(atom);
      }
    }
  }

  return atoms;
}

/** Explicit real-user development client. */
export class KnotDevelopmentClient extends KnotTransport {
  constructor(options: KnotClientOptions) {
    super(options, "development");
  }

  createConnectSession(input: SandboxSessionInput): Promise<Wire<SandboxSessionResult["data"]>> {
    return this.request("/connect-sessions", "POST", input);
  }

  exchangeConnectCode(input: SandboxExchangeInput & { state: string; expected_state: string }): Promise<Wire<DevelopmentConnectionResult["data"]>> {
    if (!input.expected_state || input.state !== input.expected_state) {
      throw new KnotError(400, "state_mismatch", "The authorization state does not match.");
    }
    const { state: _state, expected_state: _expected, ...body } = input;
    return this.request("/connect-exchanges", "POST", body);
  }

  getConnection(id: string): Promise<Wire<DevelopmentConnectionResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "GET", undefined, true);
  }

  query(id: string, input: DevelopmentQueryInput): Promise<Wire<DevelopmentContextResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}/context/query`, "POST", input, true);
  }

  contribute(id: string, input: DevelopmentContributionInput): Promise<Wire<DevelopmentContributionResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}/contributions`, "POST", input, true);
  }

  /** Sequentially submit multiple contribution items under this real-user connection. */
  async batchContribute(id: string, items: DevelopmentContributionInput[]): Promise<Wire<DevelopmentContributionResult["data"]>[]> {
    const results: Wire<DevelopmentContributionResult["data"]>[] = [];
    for (const item of items) {
      results.push(await this.contribute(id, item));
    }
    return results;
  }

  /**
   * Zero-LLM Context Seeder for real-user development connections.
   */
  async seedFromMarkdown(
    id: string,
    markdown: string,
    options?: { prefix?: string; maxItems?: number; entity_id?: string },
  ): Promise<Wire<DevelopmentContributionResult["data"]>[]> {
    const items = compileSeedMarkdown(markdown, options).map((item) => ({
      ...item,
      ...(options?.entity_id ? { entity_id: options.entity_id } : {}),
    }));
    return this.batchContribute(id, items);
  }

  /**
   * B2B Decision Compiler for GitHub Pull Requests on real-user development connections.
   */
  async ingestGitHubPullRequest(
    id: string,
    pr: GitHubPullRequestDecisionInput & { entity_id?: string },
  ): Promise<Wire<DevelopmentContributionResult["data"]>[]> {
    const items = compileGitHubPullRequest(pr).map((item) => ({
      ...item,
      ...(pr.entity_id ? { entity_id: pr.entity_id } : {}),
    }));
    return this.batchContribute(id, items);
  }

  /** Read historical changes and audit entries for this real-user connection. */
  async changes(id: string, options?: { query?: string; limit?: number }): Promise<Wire<DevelopmentContextResult["data"]["history"]>> {
    const res = await this.query(id, { query: options?.query ?? "context", limit: options?.limit });
    return res.history;
  }

  disconnect(id: string): Promise<Wire<SandboxStatusResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "DELETE", undefined, true);
  }
}
