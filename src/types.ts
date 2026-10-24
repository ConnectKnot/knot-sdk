/**
 * Official TypeScript definitions for @knot/sdk.
 * Self-contained without workspace dependencies for standalone npm distribution.
 */

export type ContextCapability =
  | "context:read"
  | "context:propose"
  | "context:contribute:project"
  | "active_state:read"
  | "active_state:contribute";

export type ContextItemKind =
  | "fact"
  | "decision"
  | "goal"
  | "constraint"
  | "project_state"
  | "preference"
  | "person"
  | "relationship";

export type ContextConfidence = "high" | "medium" | "low" | "unknown";

export type ConnectionStatus = "active" | "revoked" | "expired" | "pending";

export type KnotEnvironment = "production" | "sandbox" | "development";

// --- Sandbox Types ---

export interface SandboxSessionInput {
  external_user_id: string;
  callback_url: string;
  state: string;
  code_challenge: string;
  capabilities: ContextCapability[];
}

export interface SandboxSessionResultData {
  session_id: string;
  consent_url: string;
  expires_at: string;
}

export interface SandboxSessionResult {
  request_id: string;
  data: SandboxSessionResultData;
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
  status: ConnectionStatus;
  environment: KnotEnvironment;
}

export interface SandboxConnectionResult {
  request_id: string;
  data: SandboxConnection;
}

export interface SandboxContextItem {
  id: string;
  kind: ContextItemKind | string;
  statement: string;
  status: string;
  source: string;
  created_at: string;
  supersedes_id: string | null;
}

export interface SandboxContextResultData {
  current: SandboxContextItem[];
  history: SandboxContextItem[];
  environment: KnotEnvironment;
}

export interface SandboxContextResult {
  request_id: string;
  data: SandboxContextResultData;
}

export interface SandboxQueryInput {
  query: string;
  limit?: number;
}

export interface SandboxContributionInput {
  idempotency_key: string;
  kind: ContextItemKind;
  statement: string;
  supersedes_id?: string;
  coexists_with_ids?: string[];
}

export interface SandboxContributionResultData {
  outcome: "accepted" | "needs_clarification" | "rejected";
  replayed: boolean;
  item?: SandboxContextItem;
  current_ids?: string[];
  message?: string;
}

export interface SandboxContributionResult {
  request_id: string;
  data: SandboxContributionResultData;
}

export interface SandboxStatusResultData {
  status: "disconnected" | "revoked" | "active";
}

export interface SandboxStatusResult {
  request_id: string;
  data: SandboxStatusResultData;
}

// --- Development Types ---

export interface DevelopmentConnection {
  id: string;
  product_id: string;
  external_user_id: string;
  capabilities: string[];
  status: ConnectionStatus;
  environment: "development";
}

export interface DevelopmentConnectionResult {
  request_id: string;
  data: DevelopmentConnection;
}

export interface DevelopmentContextItem {
  id: string;
  entity_id: string;
  entity_name: string;
  kind: ContextItemKind | string;
  statement: string;
  status: string;
  confidence: ContextConfidence;
  supersedes_id: string | null;
  observed_at: string;
  created_at: string;
}

export interface DevelopmentPersonalItem {
  id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface DevelopmentContextResultData {
  current: DevelopmentContextItem[];
  history: DevelopmentContextItem[];
  personal_context: DevelopmentPersonalItem[];
  history_incomplete: boolean;
  more_available: boolean;
  interpretation: string;
  environment: "development";
}

export interface DevelopmentContextResult {
  request_id: string;
  data: DevelopmentContextResultData;
}

export interface DevelopmentQueryInput {
  query: string;
  limit?: number;
}

export interface DevelopmentContributionInput {
  entity_id?: string;
  kind: ContextItemKind;
  statement: string;
  idempotency_key: string;
  supersedes_id?: string;
  coexists_with_ids?: string[];
}

export interface DevelopmentContributionResultData {
  outcome: "accepted" | "needs_clarification" | "rejected";
  replayed: boolean;
  proposal_id?: string;
  context_id?: string;
  current_ids?: string[];
  message?: string;
}

export interface DevelopmentContributionResult {
  request_id: string;
  data: DevelopmentContributionResultData;
}

// --- PKCE Types ---

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: "S256";
}

// --- Consent & Active State Envelope Types ---

export type ContextReach =
  | "project_slice_only"
  | "selected_invariants"
  | "zero_personal";

export interface ActiveStateEnvelopeTelemetry {
  sharedDecisionsCount: number;
  sharedThreadsCount: number;
  shieldedPersonalItemsCount: number;
  shieldedApiKeysCount: number;
  totalTokens: number;
}

export interface KnotConsentPreferences {
  reach: ContextReach;
  capabilities: ContextCapability[];
}

export interface ConnectedProvider {
  id: string;
  name: string;
  category: "ide" | "assistant" | "agent";
  enabled: boolean;
  activeThreadsCount: number;
}

export interface ProjectSlice {
  id: string;
  name: string;
  enabled: boolean;
  decisionsCount: number;
}

export interface KnotConsentResult {
  connectionId: string;
  reach: ContextReach;
  capabilities: ContextCapability[];
  envelope: ActiveStateEnvelopeTelemetry;
  selectedProviders: string[];
  selectedProjects: string[];
  accessToken?: string;
  refreshToken?: string;
  grantedScopes?: string[];
}

