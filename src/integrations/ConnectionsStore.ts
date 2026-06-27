import { createClient } from "@supabase/supabase-js";
import {
  buildTokenRequestHeaders,
  getCrmOAuthConfig,
  RAPIDOCRM_PROVIDER,
  validateMcpUrl,
} from "../auth/crmOAuthConfig";
import { decryptCredential, encryptCredential } from "./credentialCrypto";

/**
 * Uses existing public.user_connections (same table as API keys in RapidoMeet).
 * OAuth tokens are stored encrypted in credentials.encrypted (AES-GCM).
 */

const supabaseService = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface UserConnectionRow {
  id: string;
  user_id: string;
  integration_id: string;
  status: string;
  connection_type: string;
  credentials: { encrypted?: string } | null;
  config: Record<string, unknown> | null;
  account_label: string | null;
  connected_at: string | null;
  updated_at: string | null;
}

export interface ConnectionRecord {
  id: string;
  user_id: string;
  provider: string;
  status: string;
  metadata: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface OAuthTokenPayload {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
}

export interface CRMConnectionContext {
  accessToken: string;
  mcpUrl: string;
  connectionId: string;
}

function mapRow(row: UserConnectionRow): ConnectionRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.integration_id,
    status: row.status,
    metadata: row.config,
    created_at: row.connected_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
  };
}

function isConnectedStatus(status: string): boolean {
  return status === "connected" || status === "active";
}

export class ConnectionsStore {
  private async getRowById(connectionId: string): Promise<UserConnectionRow | null> {
    const { data, error } = await supabaseService
      .from("user_connections")
      .select("*")
      .eq("id", connectionId)
      .maybeSingle();

    if (error) {
      console.warn(`[ConnectionsStore] Lookup by id failed:`, error.message);
      return null;
    }

    return (data as UserConnectionRow) ?? null;
  }

  async getConnection(connectionId: string): Promise<ConnectionRecord | null> {
    const row = await this.getRowById(connectionId);
    return row ? mapRow(row) : null;
  }

  async getUserConnection(
    userId: string,
    provider: string
  ): Promise<ConnectionRecord | null> {
    const { data, error } = await supabaseService
      .from("user_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("integration_id", provider)
      .maybeSingle();

    if (error) {
      console.warn(`[ConnectionsStore] Lookup failed for ${provider}:`, error.message);
      return null;
    }

    return data ? mapRow(data as UserConnectionRow) : null;
  }

  async hasActiveConnection(userId: string, provider: string): Promise<boolean> {
    const conn = await this.getUserConnection(userId, provider);
    return !!conn && isConnectedStatus(conn.status);
  }

  async hasConnection(connectionId: string): Promise<boolean> {
    const conn = await this.getConnection(connectionId);
    return !!conn && isConnectedStatus(conn.status);
  }

  /** Decrypt credentials for a user_connections row (by connection id). */
  async getVaultSecret(connectionId: string): Promise<string | null> {
    try {
      const row = await this.getRowById(connectionId);
      if (!row?.credentials) return null;

      const encrypted = (row.credentials as { encrypted?: string }).encrypted;
      if (encrypted) {
        return decryptCredential(encrypted);
      }

      if (typeof row.credentials === "object") {
        const asToken = row.credentials as Record<string, string>;
        if (asToken.refresh_token) return asToken.refresh_token;
        if (asToken.access_token) return asToken.access_token;
        if (asToken.bot_token) return asToken.bot_token;
      }

      return null;
    } catch (err) {
      console.error("Error decrypting connection credentials:", err);
      return null;
    }
  }

  private async readOAuthTokens(connectionId: string): Promise<OAuthTokenPayload | null> {
    const raw = await this.getVaultSecret(connectionId);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as OAuthTokenPayload;
    } catch {
      return null;
    }
  }

  private async writeEncryptedCredentials(
    connectionId: string,
    payload: string
  ): Promise<void> {
    const { error } = await supabaseService
      .from("user_connections")
      .update({
        credentials: { encrypted: encryptCredential(payload) },
        updated_at: new Date().toISOString(),
      })
      .eq("id", connectionId);

    if (error) {
      throw new Error(`[ConnectionsStore] credentials update failed: ${error.message}`);
    }
  }

  resolveMcpUrl(metadata?: Record<string, unknown> | null): string {
    const config = getCrmOAuthConfig();
    const fromMeta = metadata?.mcp_url;
    if (typeof fromMeta === "string" && fromMeta.trim()) {
      return fromMeta.trim().replace(/\/$/, "");
    }
    return config.defaultMcpUrl;
  }

  async storeOAuthTokens(
    userId: string,
    provider: string,
    tokens: OAuthTokenPayload,
    extraMetadata?: Record<string, unknown>
  ): Promise<void> {
    const config = getCrmOAuthConfig();
    const existing = await this.getUserConnection(userId, provider);
    const secretJson = JSON.stringify(tokens);

    const configPatch = {
      ...(existing?.metadata ?? {}),
      ...(extraMetadata ?? {}),
      connected_at: (existing?.metadata?.connected_at as string) ?? new Date().toISOString(),
      mcp_url: this.resolveMcpUrl({
        ...(existing?.metadata ?? {}),
        mcp_url: extraMetadata?.mcp_url ?? existing?.metadata?.mcp_url ?? config.defaultMcpUrl,
      }),
    };

    if (existing) {
      await this.writeEncryptedCredentials(existing.id, secretJson);

      const { error: updateError } = await supabaseService
        .from("user_connections")
        .update({
          status: "connected",
          connection_type: "oauth",
          config: configPatch,
          account_label: "RapidoCRM",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        throw new Error(`[ConnectionsStore] user_connections update failed: ${updateError.message}`);
      }
      return;
    }

    const encrypted = encryptCredential(secretJson);
    const { error: insertError } = await supabaseService.from("user_connections").insert({
      user_id: userId,
      integration_id: provider,
      status: "connected",
      connection_type: "oauth",
      credentials: { encrypted },
      config: configPatch,
      account_label: "RapidoCRM",
      connected_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertError) {
      throw new Error(`[ConnectionsStore] user_connections insert failed: ${insertError.message}`);
    }
  }

  async updateConnectionMetadata(
    userId: string,
    provider: string,
    patch: Record<string, unknown>
  ): Promise<ConnectionRecord> {
    const existing = await this.getUserConnection(userId, provider);
    if (!existing) {
      throw new Error("Connection not found");
    }

    const config = { ...(existing.metadata ?? {}), ...patch };

    const { data, error } = await supabaseService
      .from("user_connections")
      .update({ config, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to update connection metadata: ${error?.message}`);
    }

    return mapRow(data as UserConnectionRow);
  }

  async getCRMConnection(userId: string): Promise<CRMConnectionContext> {
    const accessToken = await this.getCRMAccessToken(userId);
    const conn = await this.getUserConnection(userId, RAPIDOCRM_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "RapidoCRM is not connected. Go to Settings → Integrations and connect your CRM account."
      );
    }

    return {
      accessToken,
      mcpUrl: this.resolveMcpUrl(conn.metadata),
      connectionId: conn.id,
    };
  }

  async getCRMAccessToken(userId: string): Promise<string> {
    const conn = await this.getUserConnection(userId, RAPIDOCRM_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "RapidoCRM is not connected. Go to Settings → Integrations and connect your CRM account."
      );
    }

    const tokens = await this.readOAuthTokens(conn.id);
    if (!tokens) {
      throw new Error("RapidoCRM credentials missing. Please reconnect.");
    }

    const refreshBufferMs = 5 * 60 * 1000;
    if (Date.now() + refreshBufferMs >= tokens.expires_at) {
      return this.refreshCRMToken(userId, conn.id, tokens);
    }

    return tokens.access_token;
  }

  private async refreshCRMToken(
    userId: string,
    connectionId: string,
    currentTokens: OAuthTokenPayload
  ): Promise<string> {
    const config = getCrmOAuthConfig();

    if (!config.clientId) {
      throw new Error("RAPIDOCRM_CLIENT_ID is not configured on the server.");
    }

    if (!currentTokens.refresh_token) {
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "RapidoCRM session expired and no refresh token is available. Please reconnect in Settings."
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: currentTokens.refresh_token,
      client_id: config.clientId,
      scope: config.scope,
    });

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: buildTokenRequestHeaders(config.clientId, config.clientSecret),
      body,
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      console.error("[ConnectionsStore] CRM token refresh failed:", data);
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "RapidoCRM session expired. Please reconnect your account in Settings → Integrations."
      );
    }

    const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
    const updated: OAuthTokenPayload = {
      access_token: String(data.access_token),
      refresh_token: String(data.refresh_token ?? currentTokens.refresh_token),
      token_type: String(data.token_type ?? currentTokens.token_type ?? "Bearer"),
      expires_at: Date.now() + expiresIn * 1000,
    };

    await this.writeEncryptedCredentials(connectionId, JSON.stringify(updated));

    await supabaseService
      .from("user_connections")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", connectionId);

    console.log(`[ConnectionsStore] Refreshed RapidoCRM token for user ${userId}`);
    return updated.access_token;
  }

  private async markConnectionExpired(connectionId: string): Promise<void> {
    await supabaseService
      .from("user_connections")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  }

  async revokeConnection(userId: string, provider: string): Promise<void> {
    const conn = await this.getUserConnection(userId, provider);
    if (!conn) return;

    await supabaseService
      .from("user_connections")
      .update({
        status: "disconnected",
        credentials: {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
  }

  async updateMcpUrl(userId: string, mcpUrl: string): Promise<ConnectionRecord> {
    const validated = validateMcpUrl(mcpUrl);
    return this.updateConnectionMetadata(userId, RAPIDOCRM_PROVIDER, { mcp_url: validated });
  }

  async touchConnection(connectionId: string): Promise<void> {
    await supabaseService
      .from("user_connections")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  }
}

export const connectionsStore = new ConnectionsStore();
