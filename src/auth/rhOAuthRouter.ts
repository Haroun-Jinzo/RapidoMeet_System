import {
  buildRhTokenRequestHeaders,
  getRhOAuthConfig,
  isRhOAuthClientConfigured,
  requireRhClientId,
  validateRhMcpUrl,
} from "./rhOAuthConfig";
import { connectionsStore } from "../integrations/ConnectionsStore";
import { mcpDispatcher } from "../dispatcher";
import { createRapidoOAuthRouter } from "./createRapidoOAuthRouter";

export const rhOAuthRouter = createRapidoOAuthRouter({
  provider: "rapidorh",
  logLabel: "RH OAuth",
  productName: "Rapido RH",
  successParam: "rh",
  getConfig: getRhOAuthConfig,
  isClientConfigured: isRhOAuthClientConfigured,
  requireClientId: requireRhClientId,
  buildTokenRequestHeaders: buildRhTokenRequestHeaders,
  validateMcpUrl: validateRhMcpUrl,
  invalidateClient: (userId) => mcpDispatcher.invalidateRhClient(userId),
  getConnection: (userId) => connectionsStore.getRHConnection(userId),
  updateMcpUrl: (userId, mcpUrl) => connectionsStore.updateRhMcpUrl(userId, mcpUrl),
  resolveMcpUrl: (metadata) => connectionsStore.resolveRhMcpUrl(metadata),
  notConfiguredMessage:
    "Rapido RH OAuth is not configured on the server. Set a valid RAPIDORH_CLIENT_ID in openclaw-server/.env.",
  networkErrorMessage:
    "Could not reach Rapido RH token server (network/SSL). Check your connection and try again.",
  reconnectHint:
    "OAuth session expired or was lost. Click Connect Rapido RH again (do not refresh during login).",
});
