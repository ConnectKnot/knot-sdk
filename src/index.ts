import type {
  DevelopmentConnectionResult, DevelopmentContextResult, DevelopmentContributionInput,
  DevelopmentContributionResult, DevelopmentQueryInput,
  SandboxSessionInput, SandboxExchangeInput, SandboxSessionResult, SandboxConnectionResult,
  SandboxContextResult, SandboxQueryInput, SandboxContributionInput, SandboxContributionResult,
  SandboxStatusResult,
} from "./types.js";

export class KnotError extends Error {
  constructor(
    public readonly status: number, public readonly code: string, message: string,
    public readonly requestId?: string, public readonly retryAfter?: number,
  ) { super(message); this.name = "KnotError"; }
}

export type KnotEnvironment = "production" | "sandbox" | "development";

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
export type Wire<T> = T extends Date ? string : T extends readonly (infer U)[]
  ? Wire<U>[] : T extends object ? { [K in keyof T]: Wire<T[K]> } : T;

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
    if (base.username || base.password || base.search || base.hash ||
      (base.protocol !== "https:" && !(loopback && base.protocol === "http:")) ||
      !base.pathname.replace(/\/$/, "").endsWith("/api")) {
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
          method, redirect: "error", cache: "no-store",
          headers: {
            Authorization: `Bearer ${this.secret}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        let result: unknown;
        try { result = await response.json(); } catch { throw new KnotError(response.status, "invalid_response", "Knot returned an invalid response."); }
        if (!result || typeof result !== "object" || Array.isArray(result)) throw new KnotError(response.status, "invalid_response", "Knot returned an invalid response.");
        const envelope = result as Envelope<T> & { error?: { code?: string; message?: string } };
        if (!response.ok) {
          const rawRetry = response.headers.get("Retry-After");
          const retryAfter = rawRetry && /^\d+$/.test(rawRetry) ? Number(rawRetry) : undefined;
          throw new KnotError(response.status, envelope.error?.code ?? "request_failed",
            envelope.error?.message ?? "Knot request failed.", envelope.request_id, retryAfter);
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
          ? Math.min(error.retryAfter * 1000, 2000) : 150 * 2 ** attempt;
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
    if (!input.expected_state || input.state !== input.expected_state) throw new KnotError(400, "state_mismatch", "The authorization state does not match.");
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

  disconnect(id: string): Promise<Wire<SandboxStatusResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "DELETE", undefined, true);
  }
}
export type { SandboxSessionInput, SandboxExchangeInput, SandboxQueryInput, SandboxContributionInput };

/** Explicit real-user development client. */
export class KnotDevelopmentClient extends KnotTransport {
  constructor(options: KnotClientOptions) {
    super(options, "development");
  }

  createConnectSession(input: SandboxSessionInput): Promise<Wire<SandboxSessionResult["data"]>> {
    return this.request("/connect-sessions", "POST", input);
  }

  exchangeConnectCode(input: SandboxExchangeInput & { state: string; expected_state: string }): Promise<Wire<DevelopmentConnectionResult["data"]>> {
    if (!input.expected_state || input.state !== input.expected_state) throw new KnotError(400, "state_mismatch", "The authorization state does not match.");
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

  disconnect(id: string): Promise<Wire<SandboxStatusResult["data"]>> {
    return this.request(`/connections/${encodeURIComponent(id)}`, "DELETE", undefined, true);
  }
}
export type { DevelopmentContributionInput, DevelopmentQueryInput };
export * from "./types.js";
