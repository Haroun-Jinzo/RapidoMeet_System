import { createClient } from "@supabase/supabase-js";
import {
  buildTokenRequestHeaders,
  getCrmOAuthConfig,
  RAPIDOCRM_PROVIDER,
  validateMcpUrl,
} from "../auth/crmOAuthConfig";
import {
  buildTokenRequestHeaders as buildCmsTokenRequestHeaders,
  getCmsOAuthConfig,
  RAPIDOCMS_PROVIDER,
  validateMcpUrl as validateCmsMcpUrl,
} from "../auth/cmsOAuthConfig";
import {
  buildRhTokenRequestHeaders,
  getRhOAuthConfig,
  RAPIDORH_PROVIDER,
  validateRhMcpUrl,
} from "../auth/rhOAuthConfig";
import {
  getGoogleOAuthConfig,
  GOOGLE_CALENDAR_PROVIDER,
} from "../auth/googleOAuthConfig";
import { TELEGRAM_PROVIDER } from "../auth/telegramConfig";
import { decryptCredential, encryptCredential } from "./credentialCrypto";
import { logTokenRefreshFailure } from "./tokenRefreshLog";

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

export type CMSConnectionContext = CRMConnectionContext;
export type RHConnectionContext = CRMConnectionContext;

export interface GoogleCalendarConnectionContext {
  accessToken: string;
  connectionId: string;
}

export interface TelegramConnectionContext {
  botToken: string;
  chatId: string;
  connectionId: string;
  botUsername?: string | null;
}

function accountLabelForProvider(provider: string): string {
  if (provider === GOOGLE_CALENDAR_PROVIDER) return "Google Calendar";
  if (provider === RAPIDOCRM_PROVIDER) return "RapidoCRM";
  if (provider === RAPIDOCMS_PROVIDER) return "RapidoCMS";
  if (provider === RAPIDORH_PROVIDER) return "Rapido RH";
  if (provider === TELEGRAM_PROVIDER) return "Telegram";
  return provider;
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

  resolveCmsMcpUrl(metadata?: Record<string, unknown> | null): string {
    const config = getCmsOAuthConfig();
    const fromMeta = metadata?.mcp_url;
    if (typeof fromMeta === "string" && fromMeta.trim()) {
      return fromMeta.trim().replace(/\/$/, "");
    }
    return config.defaultMcpUrl;
  }

  resolveRhMcpUrl(metadata?: Record<string, unknown> | null): string {
    const config = getRhOAuthConfig();
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
    const existing = await this.getUserConnection(userId, provider);

    // Google may omit refresh_token on re-consent — preserve the stored one
    if (!tokens.refresh_token && existing) {
      const previous = await this.readOAuthTokens(existing.id);
      if (previous?.refresh_token) {
        tokens = { ...tokens, refresh_token: previous.refresh_token };
      }
    }

    const secretJson = JSON.stringify(tokens);

    const configPatch: Record<string, unknown> = {
      ...(existing?.metadata ?? {}),
      ...(extraMetadata ?? {}),
      connected_at:
        (extraMetadata?.connected_at as string) ??
        (existing?.metadata?.connected_at as string) ??
        new Date().toISOString(),
    };

    if (provider === RAPIDOCRM_PROVIDER) {
      const config = getCrmOAuthConfig();
      configPatch.mcp_url = this.resolveMcpUrl({
        ...(existing?.metadata ?? {}),
        mcp_url:
          extraMetadata?.mcp_url ?? existing?.metadata?.mcp_url ?? config.defaultMcpUrl,
      });
    }

    if (provider === RAPIDOCMS_PROVIDER) {
      const config = getCmsOAuthConfig();
      configPatch.mcp_url = this.resolveCmsMcpUrl({
        ...(existing?.metadata ?? {}),
        mcp_url:
          extraMetadata?.mcp_url ?? existing?.metadata?.mcp_url ?? config.defaultMcpUrl,
      });
    }

    if (provider === RAPIDORH_PROVIDER) {
      const config = getRhOAuthConfig();
      configPatch.mcp_url = this.resolveRhMcpUrl({
        ...(existing?.metadata ?? {}),
        mcp_url:
          extraMetadata?.mcp_url ?? existing?.metadata?.mcp_url ?? config.defaultMcpUrl,
      });
    }

    const label = accountLabelForProvider(provider);

    if (existing) {
      await this.writeEncryptedCredentials(existing.id, secretJson);

      const { error: updateError } = await supabaseService
        .from("user_connections")
        .update({
          status: "connected",
          connection_type: "oauth",
          config: configPatch,
          account_label: label,
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
      account_label: label,
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

  async getCMSConnection(userId: string): Promise<CMSConnectionContext> {
    const accessToken = await this.getCMSAccessToken(userId);
    const conn = await this.getUserConnection(userId, RAPIDOCMS_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "RapidoCMS is not connected. Go to Settings → Integrations and connect your CMS account."
      );
    }

    return {
      accessToken,
      mcpUrl: this.resolveCmsMcpUrl(conn.metadata),
      connectionId: conn.id,
    };
  }

  async getRHConnection(userId: string): Promise<RHConnectionContext> {
    const accessToken = await this.getRHAccessToken(userId);
    const conn = await this.getUserConnection(userId, RAPIDORH_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "Rapido RH is not connected. Go to Settings → Integrations and connect your RH account."
      );
    }

    return {
      accessToken,
      mcpUrl: this.resolveRhMcpUrl(conn.metadata),
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
      logTokenRefreshFailure("CRM", response, data);
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

  async getCMSAccessToken(userId: string): Promise<string> {
    const conn = await this.getUserConnection(userId, RAPIDOCMS_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "RapidoCMS is not connected. Go to Settings → Integrations and connect your CMS account."
      );
    }

    const tokens = await this.readOAuthTokens(conn.id);
    if (!tokens) {
      throw new Error("RapidoCMS credentials missing. Please reconnect.");
    }

    const refreshBufferMs = 5 * 60 * 1000;
    if (Date.now() + refreshBufferMs >= tokens.expires_at) {
      return this.refreshCMSToken(userId, conn.id, tokens);
    }

    return tokens.access_token;
  }

  private async refreshCMSToken(
    userId: string,
    connectionId: string,
    currentTokens: OAuthTokenPayload
  ): Promise<string> {
    const config = getCmsOAuthConfig();

    if (!config.clientId) {
      throw new Error("RAPIDOCMS_CLIENT_ID is not configured on the server.");
    }

    if (!currentTokens.refresh_token) {
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "RapidoCMS session expired and no refresh token is available. Please reconnect in Settings."
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
      headers: buildCmsTokenRequestHeaders(config.clientId, config.clientSecret),
      body,
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      logTokenRefreshFailure("CMS", response, data);
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "RapidoCMS session expired. Please reconnect your account in Settings → Integrations."
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

    console.log(`[ConnectionsStore] Refreshed RapidoCMS token for user ${userId}`);
    return updated.access_token;
  }

  async getRHAccessToken(userId: string): Promise<string> {
    const conn = await this.getUserConnection(userId, RAPIDORH_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "Rapido RH is not connected. Go to Settings → Integrations and connect your RH account."
      );
    }

    const tokens = await this.readOAuthTokens(conn.id);
    if (!tokens) {
      throw new Error("Rapido RH credentials missing. Please reconnect.");
    }

    const refreshBufferMs = 5 * 60 * 1000;
    if (Date.now() + refreshBufferMs >= tokens.expires_at) {
      return this.refreshRHToken(userId, conn.id, tokens);
    }

    return tokens.access_token;
  }

  private async refreshRHToken(
    userId: string,
    connectionId: string,
    currentTokens: OAuthTokenPayload
  ): Promise<string> {
    const config = getRhOAuthConfig();

    if (!config.clientId) {
      throw new Error("RAPIDORH_CLIENT_ID is not configured on the server.");
    }

    if (!currentTokens.refresh_token) {
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "Rapido RH session expired and no refresh token is available. Please reconnect in Settings."
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
      headers: buildRhTokenRequestHeaders(config.clientId, config.clientSecret),
      body,
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok) {
      logTokenRefreshFailure("RH", response, data);
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "Rapido RH session expired. Please reconnect your account in Settings → Integrations."
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

    console.log(`[ConnectionsStore] Refreshed Rapido RH token for user ${userId}`);
    return updated.access_token;
  }

  async getGoogleCalendarConnection(userId: string): Promise<GoogleCalendarConnectionContext> {
    const accessToken = await this.getGoogleAccessToken(userId);
    const conn = await this.getUserConnection(userId, GOOGLE_CALENDAR_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "Google Calendar is not connected. Go to Settings → Integrations and connect your Google account."
      );
    }

    return {
      accessToken,
      connectionId: conn.id,
    };
  }

  async getGoogleAccessToken(userId: string): Promise<string> {
    const conn = await this.getUserConnection(userId, GOOGLE_CALENDAR_PROVIDER);

    if (!conn || !isConnectedStatus(conn.status)) {
      throw new Error(
        "Google Calendar is not connected. Go to Settings → Integrations and connect your Google account."
      );
    }

    const tokens = await this.readOAuthTokens(conn.id);
    if (!tokens) {
      throw new Error("Google Calendar credentials missing. Please reconnect.");
    }

    const refreshBufferMs = 5 * 60 * 1000;
    if (Date.now() + refreshBufferMs >= tokens.expires_at) {
      return this.refreshGoogleToken(userId, conn.id, tokens);
    }

    return tokens.access_token;
  }

  private async refreshGoogleToken(
    userId: string,
    connectionId: string,
    currentTokens: OAuthTokenPayload
  ): Promise<string> {
    const config = getGoogleOAuthConfig();

    if (!config.clientId || !config.clientSecret) {
      throw new Error("Google OAuth is not configured on the server.");
    }

    if (!currentTokens.refresh_token) {
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "Google Calendar session expired and no refresh token is available. Please reconnect in Settings."
      );
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: currentTokens.refresh_token,
    });

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body,
    });

    const data = (await response.json()) as Record<string, unknown>;

    if (!response.ok || response.status === 401 || response.status === 400) {
      logTokenRefreshFailure("Google", response, data);
      await this.markConnectionExpired(connectionId);
      throw new Error(
        "Google Calendar session expired. Please reconnect your account in Settings → Integrations."
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

    console.log(`[ConnectionsStore] Refreshed Google Calendar token for user ${userId}`);
    return updated.access_token;
  }

  async markConnectionExpired(connectionId: string): Promise<void> {
    await supabaseService
      .from("user_connections")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  }

  async revokeConnection(
    userId: string,
    provider: string,
    options?: { status?: string }
  ): Promise<void> {
    const conn = await this.getUserConnection(userId, provider);
    if (!conn) return;

    await supabaseService
      .from("user_connections")
      .update({
        status: options?.status ?? "disconnected",
        credentials: {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
  }

  async updateMcpUrl(userId: string, mcpUrl: string): Promise<ConnectionRecord> {
    const validated = validateMcpUrl(mcpUrl);
    return this.updateConnectionMetadata(userId, RAPIDOCRM_PROVIDER, { mcp_url: validated });
  }

  async updateCmsMcpUrl(userId: string, mcpUrl: string): Promise<ConnectionRecord> {
    const validated = validateCmsMcpUrl(mcpUrl);
    return this.updateConnectionMetadata(userId, RAPIDOCMS_PROVIDER, { mcp_url: validated });
  }

  async updateRhMcpUrl(userId: string, mcpUrl: string): Promise<ConnectionRecord> {
    const validated = validateRhMcpUrl(mcpUrl);
    return this.updateConnectionMetadata(userId, RAPIDORH_PROVIDER, { mcp_url: validated });
  }

  async touchConnection(connectionId: string): Promise<void> {
    await supabaseService
      .from("user_connections")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", connectionId);
  }

  private async readTelegramCredentials(
    connectionId: string
  ): Promise<{ bot_token: string; chat_id: string } | null> {
    const raw = await this.getVaultSecret(connectionId);
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw) as { bot_token?: string; chat_id?: string };
      if (parsed.bot_token && parsed.chat_id) {
        return { bot_token: parsed.bot_token, chat_id: parsed.chat_id };
      }
    } catch {
      // fall through
    }

    return null;
  }

  async getTelegramConnection(userId: string): Promise<TelegramConnectionContext | null> {
    const conn = await this.getUserConnection(userId, TELEGRAM_PROVIDER);
    if (!conn || !isConnectedStatus(conn.status)) {
      return null;
    }

    const creds = await this.readTelegramCredentials(conn.id);
    if (!creds) {
      return null;
    }

    const chatIdFromConfig =
      typeof conn.metadata?.chat_id === "string" ? conn.metadata.chat_id : creds.chat_id;

    return {
      botToken: creds.bot_token,
      chatId: chatIdFromConfig,
      connectionId: conn.id,
      botUsername:
        typeof conn.metadata?.bot_username === "string" ? conn.metadata.bot_username : null,
    };
  }

  async storeTelegramCredentials(
    userId: string,
    botToken: string,
    chatId: string,
    botUsername?: string | null
  ): Promise<ConnectionRecord> {
    const existing = await this.getUserConnection(userId, TELEGRAM_PROVIDER);
    const secretJson = JSON.stringify({ bot_token: botToken, chat_id: chatId });
    const label = botUsername ? `@${botUsername}` : "Telegram bot";
    const configPatch: Record<string, unknown> = {
      ...(existing?.metadata ?? {}),
      chat_id: chatId,
      bot_username: botUsername ?? null,
      connected_at:
        (existing?.metadata?.connected_at as string) ?? new Date().toISOString(),
    };

    if (existing) {
      await this.writeEncryptedCredentials(existing.id, secretJson);

      const { data, error } = await supabaseService
        .from("user_connections")
        .update({
          status: "connected",
          connection_type: "api_key",
          config: configPatch,
          account_label: label,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();
        
      if (error || !data) {
        throw new Error(`[ConnectionsStore] Telegram update failed: ${error?.message}`);
      }

      return mapRow(data as UserConnectionRow);
    }

    const encrypted = encryptCredential(secretJson);
    const { data, error } = await supabaseService
      .from("user_connections")
      .insert({
        user_id: userId,
        integration_id: TELEGRAM_PROVIDER,
        status: "connected",
        connection_type: "api_key",
        credentials: { encrypted },
        config: configPatch,
        account_label: label,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`[ConnectionsStore] Telegram insert failed: ${error?.message}`);
    }

    return mapRow(data as UserConnectionRow);
  }
}

export const connectionsStore = new ConnectionsStore();
