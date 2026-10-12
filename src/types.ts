export type ContextItemKind =
  | "fact"
  | "decision"
  | "constraint"
  | "goal"
  | "project_state"
  | "preference"
  | "person"
  | "relationship";

export type ContextItemStatus = "current" | "superseded" | "conflict";

export interface ContextItem {
  id: string;
  kind: ContextItemKind;
  statement: string;
  source: string;
  status: ContextItemStatus;
  observed_at: string;
  confidence?: "high" | "medium" | "low" | "unknown";
  supersedes_id?: string;
  coexists_with_ids?: string[];
}

export type SandboxContextItem = ContextItem;

export type SandboxSessionCapability =
  | "context:read"
  | "context:propose"
  | "context:contribute:project";

export interface SandboxSessionInput {
  external_user_id: string;
  callback_url: string;
  state: string;
  code_challenge: string;
  capabilities: SandboxSessionCapability[];
}

export interface SandboxSessionResult {
  data: {
    session_id: string;
    consent_url: string;
    expires_at: string;
  };
  request_id: string;
}

export interface SandboxExchangeInput {
  session_id: string;
  code: string;
  callback_url: string;
  code_verifier: string;
}

export interface SandboxConnection {
  id: string;
  product_id: string;
  external_user_id: string;
  capabilities: string[];
  status: "active" | "revoked";
  environment: "sandbox" | "production" | "development";
}

export interface SandboxConnectionResult {
  data: SandboxConnection;
  request_id: string;
}

export interface SandboxQueryInput {
  query?: string;
  limit?: number;
}

export interface SandboxContextResult {
  data: {
    current: SandboxContextItem[];
    history: SandboxContextItem[];
    personal_context?: Array<{ id: string; statement: string; category?: string }>;
    environment: "sandbox" | "production" | "development";
  };
  request_id: string;
}

export interface SandboxContributionInput {
  idempotency_key: string;
  kind: ContextItemKind;
  statement: string;
  supersedes_id?: string;
  coexists_with_ids?: string[];
}

export interface SandboxContributionResult {
  data: {
    outcome: "accepted" | "superseded" | "conflict";
    replayed?: boolean;
    item_id?: string;
  };
  request_id: string;
}

export interface SandboxStatusResult {
  data: {
    status: "active" | "revoked" | "disconnected";
  };
  request_id: string;
}

// Development types alias to sandbox definitions
export type DevelopmentConnectionResult = SandboxConnectionResult;
export type DevelopmentContextResult = SandboxContextResult;
export type DevelopmentContributionInput = SandboxContributionInput;
export type DevelopmentContributionResult = SandboxContributionResult;
export type DevelopmentQueryInput = SandboxQueryInput;
