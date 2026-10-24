import React, { useState, useEffect } from "react";
import type {
  ContextCapability,
  ContextReach,
  ActiveStateEnvelopeTelemetry,
  KnotConsentResult,
} from "../types.js";

export interface ConnectedAiProvider {
  id: string;
  name: string;
  category: "assistant" | "ide" | "agent";
  iconSlug?: string;
  threadsCount: number;
}

export interface ProjectEntityItem {
  id: string;
  name: string;
  decisionsCount: number;
}

export interface ContinueWithKnotProps {
  /**
   * The registered OAuth 2.1 client ID for your B2B app.
   * In "oauth" mode, if clientId is omitted or a non-UUID placeholder, Dynamic Client Registration (/api/oauth/register) is used automatically.
   */
  clientId?: string;
  /**
   * The unique identifier of the user in your host system.
   */
  externalUserId?: string;
  /**
   * Knot backend API URL or origin. Defaults to https://production.connectknot.com
   */
  knotUrl?: string;
  /**
   * Authorization mode:
   * - "preview" (default): Opens the inline interactive consent sheet preview modal.
   * - "oauth": Performs real OAuth 2.1 S256 PKCE authorization against `knotUrl` (/api/oauth/register -> /api/oauth/authorize -> /authorize -> /api/oauth/token) where the user logs into their real Knot account and selects which projects and permissions to share.
   */
  mode?: "preview" | "oauth";
  /**
   * OAuth 2.1 redirect URI. Defaults to current page URL (`window.location.origin + window.location.pathname`) when in browser.
   */
  redirectUri?: string;
  /**
   * App name displayed in the consent sheet. Defaults to "This Application"
   */
  appName?: string;
  /**
   * Logged in user email or display identifier to show authenticated status.
   */
  userEmail?: string;
  /**
   * Whether the user is actively authenticated. Defaults to false.
   */
  isAuthenticated?: boolean;
  /**
   * Default reach preset. Defaults to "project_slice_only"
   */
  initialReach?: ContextReach;
  /**
   * Default capabilities requested. Defaults to ["context:read", "context:propose"]
   */
  initialCapabilities?: ContextCapability[];
  /**
   * Initial active state envelope telemetry. Defaults to standard 44-token envelope.
   */
  envelope?: Partial<ActiveStateEnvelopeTelemetry>;
  /**
   * Initial connected providers to show. Defaults to ChatGPT, Claude, and Cursor.
   */
  providers?: ConnectedAiProvider[];
  /**
   * Initial projects to show. Defaults to typical active project slices.
   */
  projects?: ProjectEntityItem[];
  /**
   * Optional custom async authorizer. When provided, ContinueWithKnot awaits
   * this callback (showing a loading spinner) before closing the modal.
   * Useful for triggering real sandbox session/connection creation or custom backend flows.
   */
  onAuthorize?: (result: KnotConsentResult) => Promise<void | KnotConsentResult | string>;
  /**
   * Callback fired when consent is granted.
   */
  onSuccess?: (result: KnotConsentResult) => void;
  /**
   * Callback fired when an OAuth error occurs.
   */
  onError?: (error: Error) => void;
  /**
   * Callback fired when the user cancels or closes the consent sheet.
   */
  onCancel?: () => void;
  /**
   * Custom trigger button class name.
   */
  className?: string;
  /**
   * Trigger button variant. Defaults to "primary"
   */
  variant?: "primary" | "secondary" | "minimal";
  /**
   * Custom label for the trigger button. Defaults to "Continue with Knot"
   */
  label?: string;
  /**
   * Optional custom logo URL. Defaults to "/knot-mark.webp".
   */
  logoUrl?: string;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function generateBrowserPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifierBytes = new Uint8Array(32);
  window.crypto.getRandomValues(verifierBytes);
  const verifier = toBase64Url(verifierBytes);

  const stateBytes = new Uint8Array(24);
  window.crypto.getRandomValues(stateBytes);
  const state = toBase64Url(stateBytes);

  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = toBase64Url(new Uint8Array(digest));

  return { verifier, challenge, state };
}

const OAUTH_PENDING_STORAGE_KEY = "knot_sdk_oauth_pending_v1";

/**
 * Knot's actual mark component with high-contrast badge container.
 */
export const KnotLogo: React.FC<{
  src?: string;
  size?: number;
  className?: string;
  inDarkButton?: boolean;
}> = ({ src = "/knot-mark.webp", size = 18, className = "", inDarkButton = false }) => {
  return (
    <img
      src={src}
      alt="Knot"
      width={Math.round(size * 1.55)}
      height={size}
      className={`inline-block object-contain shrink-0 ${
        inDarkButton
          ? "brightness-0 invert"
          : "mix-blend-multiply dark:invert dark:mix-blend-screen"
      } ${className}`}
      style={{
        height: `${size}px`,
        width: "auto",
        filter: inDarkButton ? "brightness(0) invert(1)" : undefined,
      }}
    />
  );
};

const DEFAULT_ENVELOPE: ActiveStateEnvelopeTelemetry = {
  sharedDecisionsCount: 4,
  sharedThreadsCount: 2,
  shieldedPersonalItemsCount: 14,
  shieldedApiKeysCount: 3,
  totalTokens: 44,
};

const DEFAULT_CONNECTED_PROVIDERS: ConnectedAiProvider[] = [
  { id: "chatgpt", name: "ChatGPT (GPT-4o)", category: "assistant", threadsCount: 3 },
  { id: "claude", name: "Claude (Opus/Sonnet)", category: "assistant", threadsCount: 2 },
  { id: "cursor", name: "Cursor / Windsurf", category: "ide", threadsCount: 1 },
];

const DEFAULT_PROJECT_SLICES: ProjectEntityItem[] = [
  { id: "proj_core", name: "Knot Core & Protocol Spec", decisionsCount: 4 },
  { id: "proj_client", name: "Next.js / React Frontend", decisionsCount: 2 },
  { id: "proj_infra", name: "PostgreSQL & AES Encryption", decisionsCount: 3 },
];

export const ContinueWithKnot: React.FC<ContinueWithKnotProps> = ({
  clientId,
  knotUrl = "https://production.connectknot.com",
  mode = "preview",
  redirectUri,
  appName = "AI Co-pilot",
  userEmail,
  isAuthenticated = false,
  initialReach = "project_slice_only",
  initialCapabilities = ["context:read", "context:propose"],
  envelope: customEnvelope,
  providers = DEFAULT_CONNECTED_PROVIDERS,
  projects = DEFAULT_PROJECT_SLICES,
  onAuthorize,
  onSuccess,
  onError,
  onCancel,
  className = "",
  variant = "primary",
  label = "Continue with Knot",
  logoUrl,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [reach, setReach] = useState<ContextReach>(initialReach);
  const [capabilities, setCapabilities] = useState<Set<ContextCapability>>(
    new Set(initialCapabilities)
  );

  const [selectedProviderIds, setSelectedProviderIds] = useState<Set<string>>(
    () => new Set(providers.map((p) => p.id))
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    () => new Set(projects.map((p) => p.id))
  );

  useEffect(() => {
    setSelectedProviderIds(new Set(providers.map((p) => p.id)));
  }, [providers]);

  useEffect(() => {
    setSelectedProjectIds(new Set(projects.map((p) => p.id)));
  }, [projects]);

  const [activeTab, setActiveTab] = useState<"summary" | "connections">("summary");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dynamic token calculations based on active selection
  const activeDecisionsCount = projects
    .filter((p) => selectedProjectIds.has(p.id))
    .reduce((acc, p) => acc + p.decisionsCount, 0);

  const activeThreadsCount = providers
    .filter((p) => selectedProviderIds.has(p.id))
    .reduce((acc, p) => acc + p.threadsCount, 0);

  const envelope: ActiveStateEnvelopeTelemetry = {
    ...DEFAULT_ENVELOPE,
    ...customEnvelope,
    sharedDecisionsCount: activeDecisionsCount || (customEnvelope?.sharedDecisionsCount ?? 4),
    sharedThreadsCount: activeThreadsCount || (customEnvelope?.sharedThreadsCount ?? 2),
    shieldedPersonalItemsCount:
      reach === "zero_personal" ? 22 : (customEnvelope?.shieldedPersonalItemsCount ?? 14),
    totalTokens: Math.max(16, (activeDecisionsCount * 6) + (activeThreadsCount * 5) + (reach === "zero_personal" ? 4 : 10)),
  };

  // Real OAuth 2.1 callback exchange on mount when mode="oauth"
  useEffect(() => {
    if (mode !== "oauth" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");

    if (!code && !oauthError) return;

    const rawPending = window.localStorage.getItem(OAUTH_PENDING_STORAGE_KEY);
    if (!rawPending) return;

    let pending: {
      verifier: string;
      state: string;
      clientId: string;
      redirectUri: string;
      knotOrigin: string;
      capabilities: ContextCapability[];
    } | null = null;
    try {
      pending = JSON.parse(rawPending);
    } catch {
      window.localStorage.removeItem(OAUTH_PENDING_STORAGE_KEY);
      return;
    }

    if (!pending || (returnedState && pending.state !== returnedState)) {
      return;
    }

    // Clean OAuth parameters from URL immediately
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("code");
    cleanUrl.searchParams.delete("state");
    cleanUrl.searchParams.delete("error");
    cleanUrl.searchParams.delete("error_description");
    window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
    window.localStorage.removeItem(OAUTH_PENDING_STORAGE_KEY);

    if (oauthError) {
      onError?.(new Error(params.get("error_description") || `OAuth error: ${oauthError}`));
      return;
    }

    if (!code) return;

    setIsSubmitting(true);
    void (async () => {
      try {
        const tokenRes = await fetch(`${pending.knotOrigin}/api/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            grant_type: "authorization_code",
            client_id: pending.clientId,
            code,
            redirect_uri: pending.redirectUri,
            code_verifier: pending.verifier,
          }),
        });
        const tokenData = await tokenRes.json().catch(() => ({}));
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || tokenData.error || "Failed to exchange Knot authorization code");
        }
        const grantedScopes: string[] = typeof tokenData.scope === "string"
          ? tokenData.scope.split(/\s+/).filter(Boolean)
          : [];
        onSuccess?.({
          connectionId: `knot_oauth_${pending.clientId.slice(0, 8)}`,
          reach: initialReach,
          capabilities: pending.capabilities,
          envelope,
          selectedProviders: [],
          selectedProjects: [],
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token,
          grantedScopes,
        });
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error("Failed to complete Knot OAuth exchange"));
      } finally {
        setIsSubmitting(false);
      }
    })();
  }, [mode]);

  const startRealOAuthRedirect = async () => {
    if (typeof window === "undefined") return;
    setIsSubmitting(true);
    try {
      const knotOrigin = knotUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
      const targetRedirectUri = redirectUri || `${window.location.origin}${window.location.pathname}`;
      const isUuid = clientId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId);

      let resolvedClientId = isUuid ? clientId! : "";
      if (!resolvedClientId) {
        const regRes = await fetch(`${knotOrigin}/api/oauth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_name: appName,
            redirect_uris: [targetRedirectUri],
          }),
        });
        const regData = await regRes.json().catch(() => ({}));
        if (!regRes.ok || !regData.client_id) {
          throw new Error(regData.error_description || regData.message || "Could not register OAuth client with Knot");
        }
        resolvedClientId = regData.client_id;
      }

      const { verifier, challenge, state } = await generateBrowserPkce();
      const requestedCaps = Array.from(capabilities);
      const scopeList = Array.from(
        new Set(["knot:connect", "active_state:read", "active_state:contribute", "context:contribute:project", ...requestedCaps])
      );

      window.localStorage.setItem(
        OAUTH_PENDING_STORAGE_KEY,
        JSON.stringify({
          verifier,
          state,
          clientId: resolvedClientId,
          redirectUri: targetRedirectUri,
          knotOrigin,
          capabilities: requestedCaps,
        })
      );

      const authUrl = new URL(`${knotOrigin}/api/oauth/authorize`);
      authUrl.searchParams.set("client_id", resolvedClientId);
      authUrl.searchParams.set("redirect_uri", targetRedirectUri);
      authUrl.searchParams.set("response_type", "code");
      authUrl.searchParams.set("state", state);
      authUrl.searchParams.set("code_challenge", challenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
      authUrl.searchParams.set("scope", scopeList.join(" "));

      window.location.assign(authUrl.toString());
    } catch (err) {
      setIsSubmitting(false);
      onError?.(err instanceof Error ? err : new Error("Failed to initiate Knot OAuth"));
    }
  };

  const toggleCapability = (cap: ContextCapability) => {
    setCapabilities((prev) => {
      const next = new Set(prev);
      if (next.has(cap)) {
        if (next.size > 1) {
          next.delete(cap);
        }
      } else {
        next.add(cap);
      }
      return next;
    });
  };

  const toggleProvider = (id: string) => {
    setSelectedProviderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleProject = (id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        if (next.size > 1) next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleAuthorize = async () => {
    if (mode === "oauth" && !onAuthorize) {
      await startRealOAuthRedirect();
      return;
    }
    setIsSubmitting(true);
    try {
      const initialResult: KnotConsentResult = {
        connectionId: `knot_conn_${Math.random().toString(36).substring(2, 10)}`,
        reach,
        capabilities: Array.from(capabilities),
        envelope,
        selectedProviders: Array.from(selectedProviderIds),
        selectedProjects: Array.from(selectedProjectIds),
      };

      let finalResult = initialResult;
      if (onAuthorize) {
        const customOut = await onAuthorize(initialResult);
        if (typeof customOut === "string") {
          finalResult = { ...initialResult, connectionId: customOut };
        } else if (customOut && typeof customOut === "object") {
          finalResult = customOut as KnotConsentResult;
        }
      } else {
        await new Promise((resolve) => setTimeout(resolve, 380));
      }

      setIsOpen(false);
      onSuccess?.(finalResult);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    onCancel?.();
  };

  return (
    <>
      {/* 3-Line Drop-In Trigger Button */}
      <button
        type="button"
        disabled={isSubmitting}
        onClick={() => {
          if (mode === "oauth" && !onAuthorize) {
            void startRealOAuthRedirect();
          } else {
            setIsOpen(true);
          }
        }}
        className={`knot-button ${
          variant === "secondary"
            ? "knot-button-secondary"
            : variant === "minimal"
            ? "knot-button-outline"
            : ""
        } ${className} disabled:opacity-60`}
        data-testid="continue-with-knot-button"
      >
        {/* Clean Knot logo inverted on dark button without tacky double background */}
        <KnotLogo src={logoUrl} size={16} inDarkButton={variant === "primary"} />
        <span>{isSubmitting && mode === "oauth" ? "Connecting to Knot..." : label}</span>
      </button>

      {/* Knot Native Consent Sheet Modal */}
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#151714]/50 p-4 backdrop-blur-sm animate-in fade-in duration-200"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) handleClose();
          }}
        >
          {/* Modal Container: Matches Knot's warm cream/paper aesthetic */}
          <div
            className="w-full max-w-[520px] rounded-[22px] bg-card text-card-foreground border border-foreground/15 shadow-2xl overflow-hidden font-sans"
            data-testid="knot-consent-sheet"
          >
            {/* Header */}
            <div className="p-6 sm:p-7 pb-4 border-b border-foreground/10">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                    <KnotLogo src={logoUrl} size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="knot-display text-xl sm:text-2xl text-foreground font-semibold leading-tight m-0">
                        Connect Knot
                      </h2>
                      <span className="knot-mono text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/25">
                        OAuth 2.1
                      </span>
                      {isAuthenticated && userEmail && (
                        <span className="knot-mono text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {userEmail}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Share approved memory continuity with{" "}
                      <strong className="text-foreground font-semibold">{appName}</strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  aria-label="Close dialog"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>

              {/* Navigation View Switcher (Like Plaid's Accounts & Summary View) */}
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-foreground/10">
                <button
                  type="button"
                  onClick={() => setActiveTab("summary")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${
                    activeTab === "summary"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Context Summary
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("connections")}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors flex items-center gap-1.5 ${
                    activeTab === "connections"
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <span>Connected Tools &amp; Projects</span>
                  <span className="knot-mono text-[10px] px-1.5 py-0.2 rounded-full bg-primary/20 text-primary">
                    {selectedProviderIds.size + selectedProjectIds.size}
                  </span>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 sm:p-7 space-y-5 max-h-[60vh] overflow-y-auto">
              {activeTab === "summary" && (
                <>
                  {/* Visualizing the Value: Active State Envelope */}
                  <div className="rounded-2xl border border-foreground/15 bg-secondary/35 p-4 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
                        <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                        Active State Preview
                      </div>
                      <span className="knot-mono text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-background border border-foreground/15 text-primary">
                        {envelope.totalTokens} Tokens
                      </span>
                    </div>

                    <div className="text-xs leading-relaxed text-foreground/80 bg-card p-3 rounded-xl border border-foreground/10 flex items-start gap-2.5">
                      <svg className="w-4 h-4 text-primary mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <div>
                        <span className="font-semibold text-primary">Sharing:</span>{" "}
                        <strong>{envelope.sharedDecisionsCount} Architecture Decisions</strong> &amp;{" "}
                        <strong>{envelope.sharedThreadsCount} Active Threads</strong>
                        <span className="mx-2 text-muted-foreground/50">·</span>
                        <span className="font-semibold text-muted-foreground">Shielding:</span>{" "}
                        <span>{envelope.shieldedPersonalItemsCount} Personal Items &amp; {envelope.shieldedApiKeysCount} API Keys</span>
                      </div>
                    </div>
                  </div>

                  {/* Context Reach */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="knot-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block">
                        Context Reach
                      </label>
                      <button
                        type="button"
                        onClick={() => setActiveTab("connections")}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        Customize tools &amp; projects →
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      {[
                        {
                          id: "project_slice_only" as ContextReach,
                          title: "Project Slice Only",
                          desc: "Recommended for repo & project continuity",
                          recommended: true,
                        },
                        {
                          id: "selected_invariants" as ContextReach,
                          title: "Selected Invariants",
                          desc: "Architecture & cryptographic rules",
                        },
                        {
                          id: "zero_personal" as ContextReach,
                          title: "Zero Personal Context",
                          desc: "Strict sandbox isolation",
                        },
                      ].map((preset) => {
                        const isSelected = reach === preset.id;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => setReach(preset.id)}
                            className={`text-left p-3 rounded-xl border transition-all text-xs relative flex flex-col justify-between cursor-pointer ${
                              isSelected
                                ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/20 text-foreground"
                                : "bg-card border-foreground/15 text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                            }`}
                          >
                            {preset.recommended && (
                              <span className="absolute -top-2 right-2 text-[9px] font-semibold uppercase bg-primary text-primary-foreground px-2 py-0.5 rounded-full shadow-2xs">
                                Preset
                              </span>
                            )}
                            <span className={`font-semibold block mb-1 text-[12px] ${isSelected ? "text-primary" : "text-foreground"}`}>
                              {preset.title}
                            </span>
                            <span className="text-[10px] leading-tight text-muted-foreground">
                              {preset.desc}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Capability Scopes */}
                  <div className="space-y-2">
                    <label className="knot-mono text-[10px] font-semibold text-muted-foreground uppercase tracking-widest block">
                      Permissions
                    </label>
                    <div className="space-y-2">
                      {[
                        {
                          id: "context:read" as ContextCapability,
                          label: "context:read",
                          desc: "Read approved project memory slices & decisions",
                          badge: "Read Only",
                        },
                        {
                          id: "context:propose" as ContextCapability,
                          label: "context:propose",
                          desc: "Propose new context updates (quarantined in human approval queue)",
                          badge: "Governed",
                          highlight: true,
                        },
                        {
                          id: "context:contribute:project" as ContextCapability,
                          label: "context:contribute:project",
                          desc: "Direct canonical write to shared project continuity bus",
                          badge: "Write",
                        },
                      ].map((cap) => {
                        const isChecked = capabilities.has(cap.id);
                        return (
                          <div
                            key={cap.id}
                            onClick={() => toggleCapability(cap.id)}
                            className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-all ${
                              isChecked
                                ? "bg-secondary/40 border-foreground/20"
                                : "bg-card border-foreground/10 opacity-70"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {}}
                              className="mt-1 size-4 shrink-0 accent-primary cursor-pointer"
                            />
                            <div className="flex-1">
                              <div className="flex items-center justify-between">
                                <span className="knot-mono text-xs font-semibold text-foreground">
                                  {cap.label}
                                </span>
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded-full font-mono ${
                                    cap.highlight
                                      ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                                      : "bg-secondary text-muted-foreground border border-foreground/10"
                                  }`}
                                >
                                  {cap.badge}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                {cap.desc}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Plaid-Style Provider & Project Granular Selection */}
              {activeTab === "connections" && (
                <div className="space-y-6">
                  {/* Connected AI Providers (Banks) */}
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                          Connected AI Tools
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Select which existing AI tool memories can share context with {appName}.
                        </p>
                      </div>
                      <span className="knot-mono text-[10px] text-muted-foreground">
                        {selectedProviderIds.size} of {providers.length} enabled
                      </span>
                    </div>

                    <div className="space-y-2">
                      {providers.map((provider) => {
                        const isConnected = selectedProviderIds.has(provider.id);
                        return (
                          <div
                            key={provider.id}
                            onClick={() => toggleProvider(provider.id)}
                            className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                              isConnected
                                ? "bg-card border-primary/30 shadow-xs"
                                : "bg-card/40 border-foreground/10 opacity-60"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isConnected}
                                onChange={() => {}}
                                className="size-4 shrink-0 accent-primary cursor-pointer"
                              />
                              <div>
                                <span className="font-semibold text-xs text-foreground block">
                                  {provider.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {provider.threadsCount} active project threads synced
                                </span>
                              </div>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                isConnected
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {isConnected ? "Linked" : "Opted Out"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Project Slices (Accounts) */}
                  <div className="space-y-2.5 pt-4 border-t border-foreground/10">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                          Project Slices
                        </h4>
                        <p className="text-[11px] text-muted-foreground">
                          Choose which projects this application can access.
                        </p>
                      </div>
                      <span className="knot-mono text-[10px] text-muted-foreground">
                        {selectedProjectIds.size} of {projects.length} enabled
                      </span>
                    </div>

                    <div className="space-y-2">
                      {projects.map((project) => {
                        const isSelected = selectedProjectIds.has(project.id);
                        return (
                          <div
                            key={project.id}
                            onClick={() => toggleProject(project.id)}
                            className={`flex items-center justify-between p-3.5 rounded-xl border cursor-pointer select-none transition-all ${
                              isSelected
                                ? "bg-card border-primary/30 shadow-xs"
                                : "bg-card/40 border-foreground/10 opacity-60"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}}
                                className="size-4 shrink-0 accent-primary cursor-pointer"
                              />
                              <div>
                                <span className="font-semibold text-xs text-foreground block">
                                  {project.name}
                                </span>
                                <span className="text-[11px] text-muted-foreground">
                                  {project.decisionsCount} recorded decisions &amp; guidelines
                                </span>
                              </div>
                            </div>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                                isSelected
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : "bg-secondary text-muted-foreground"
                              }`}
                            >
                              {isSelected ? "Active" : "Excluded"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-5 sm:p-6 border-t border-foreground/10 bg-secondary/20 flex items-center justify-between gap-4">
              <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                Zero-Knowledge Shielding
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="knot-button knot-button-outline min-h-[2.35rem] py-1.5 px-4 text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleAuthorize}
                  disabled={isSubmitting}
                  className="knot-button min-h-[2.35rem] py-1.5 px-5 text-xs font-semibold disabled:opacity-50"
                  data-testid="authorize-consent-button"
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-background border-t-transparent rounded-full animate-spin" />
                      Authorizing...
                    </>
                  ) : (
                    "Authorize & Connect"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
