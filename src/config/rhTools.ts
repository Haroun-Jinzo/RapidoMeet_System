/**
 * Rapido RH tool helpers.
 * Tool names follow: rh_<mcp_snake_name> (see rhMcpToolMap.ts).
 * Refresh the map with: npm run list-rh-tools
 */

import { RH_MCP_TOOL_NAMES } from "./rhMcpToolMap";

export const ALL_RH_TOOL_NAMES = Object.keys(RH_MCP_TOOL_NAMES) as string[];

export type RhToolName = string;

export function isRhTool(tool: string): boolean {
  return tool.startsWith("rh_") || tool in RH_MCP_TOOL_NAMES;
}

/** Create / update / delete RH tools require confirmation by default. */
export function isRhCriticalTool(tool: string): boolean {
  if (!isRhTool(tool)) return false;
  const name = tool.replace(/^rh_/, "");
  return (
    name.startsWith("create_") ||
    name.startsWith("update_") ||
    name.startsWith("delete_") ||
    name.startsWith("ajouter_") ||
    name.startsWith("modifier_") ||
    name.startsWith("supprimer_") ||
    name.startsWith("log_")
  );
}

export function isRhReadTool(tool: string): boolean {
  if (!isRhTool(tool)) return false;
  const name = tool.replace(/^rh_/, "");
  return (
    name.startsWith("get_") ||
    name.startsWith("list_") ||
    name.startsWith("search_") ||
    name.startsWith("read_")
  );
}

export function buildRhToolsPromptTable(): string {
  return ALL_RH_TOOL_NAMES.map((tool) => {
    const mcp = RH_MCP_TOOL_NAMES[tool] ?? tool.replace(/^rh_/, "");
    const critical = isRhCriticalTool(tool);
    const risk = critical ? "HIGH" : "LOW — read only";
    return `| ${tool} | Rapido RH: ${mcp.replace(/_/g, " ")} | ${risk} |`;
  }).join("\n");
}
