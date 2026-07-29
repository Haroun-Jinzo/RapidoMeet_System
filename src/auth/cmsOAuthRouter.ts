import {
  buildTokenRequestHeaders,
  getCmsOAuthConfig,
  isCmsOAuthClientConfigured,
  requireCmsClientId,
  validateMcpUrl,
} from "./cmsOAuthConfig";
import { connectionsStore } from "../integrations/ConnectionsStore";
import { mcpDispatcher } from "../dispatcher";
import { createRapidoOAuthRouter } from "./createRapidoOAuthRouter";

export const cmsOAuthRouter = createRapidoOAuthRouter({
  provider: "rapidocms",
  logLabel: "CMS OAuth",
  productName: "RapidoCMS",
  successParam: "cms",
  getConfig: getCmsOAuthConfig,
  isClientConfigured: isCmsOAuthClientConfigured,
  requireClientId: requireCmsClientId,
  buildTokenRequestHeaders,
  validateMcpUrl,
  invalidateClient: (userId) => mcpDispatcher.invalidateCmsClient(userId),
  getConnection: (userId) => connectionsStore.getCMSConnection(userId),
  updateMcpUrl: (userId, mcpUrl) => connectionsStore.updateCmsMcpUrl(userId, mcpUrl),
  resolveMcpUrl: (metadata) => connectionsStore.resolveCmsMcpUrl(metadata),
  notConfiguredMessage:
    "RapidoCMS OAuth is not configured on the server. Set a valid RAPIDOCMS_CLIENT_ID in openclaw-server/.env.",
  networkErrorMessage:
    "Could not reach RapidoCMS token server (network/SSL). Check your connection and try again.",
  reconnectHint:
    "OAuth session expired or was lost. Click Connect RapidoCMS again (do not refresh during login).",
});
