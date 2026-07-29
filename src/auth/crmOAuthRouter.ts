import {
  buildTokenRequestHeaders,
  getCrmOAuthConfig,
  isCrmOAuthClientConfigured,
  requireCrmClientId,
  validateMcpUrl,
} from "./crmOAuthConfig";
import { connectionsStore } from "../integrations/ConnectionsStore";
import { mcpDispatcher } from "../dispatcher";
import { createRapidoOAuthRouter } from "./createRapidoOAuthRouter";

export const crmOAuthRouter = createRapidoOAuthRouter({
  provider: "rapidocrm",
  logLabel: "CRM OAuth",
  productName: "RapidoCRM",
  successParam: "crm",
  getConfig: getCrmOAuthConfig,
  isClientConfigured: isCrmOAuthClientConfigured,
  requireClientId: requireCrmClientId,
  buildTokenRequestHeaders,
  validateMcpUrl,
  invalidateClient: (userId) => mcpDispatcher.invalidateCrmClient(userId),
  getConnection: (userId) => connectionsStore.getCRMConnection(userId),
  updateMcpUrl: (userId, mcpUrl) => connectionsStore.updateMcpUrl(userId, mcpUrl),
  resolveMcpUrl: (metadata) => connectionsStore.resolveMcpUrl(metadata),
  notConfiguredMessage:
    "RapidoCRM OAuth is not configured on the server. Set a valid RAPIDOCRM_CLIENT_ID in openclaw-server/.env (register an OAuth app in RapidoCRM admin).",
  networkErrorMessage:
    "Could not reach RapidoCRM token server (network/SSL). Check your connection and try again.",
  reconnectHint:
    "OAuth session expired or was lost. Click Connect RapidoCRM again (do not refresh during login).",
});
