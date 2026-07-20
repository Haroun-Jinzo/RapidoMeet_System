/**
 * RapidoCMS tool helpers.
 * Tool names follow: cms_<mcp_snake_name> (see cmsMcpToolMap.ts).
 * Refresh the map with: npm run list-cms-tools
 */

import { CMS_MCP_TOOL_NAMES } from "./cmsMcpToolMap";

export const ALL_CMS_TOOL_NAMES = Object.keys(CMS_MCP_TOOL_NAMES) as string[];

export type CmsToolName = string;

export function isCmsTool(tool: string): boolean {
  return tool.startsWith("cms_") || tool in CMS_MCP_TOOL_NAMES;
}

/** Create / update / delete CMS tools require confirmation by default. */
export function isCmsCriticalTool(tool: string): boolean {
  if (!isCmsTool(tool)) return false;
  const name = tool.replace(/^cms_/, "");
  return (
    name.startsWith("create_") ||
    name.startsWith("update_") ||
    name.startsWith("delete_") ||
    name.startsWith("edit_") ||
    name.startsWith("add_") ||
    name.startsWith("remove_") ||
    name.startsWith("schedule_") ||
    name.startsWith("cancel_") ||
    name.startsWith("assign_") ||
    name.startsWith("upload_") ||
    name.startsWith("generate_") ||
    name.startsWith("ajouter_") ||
    name.startsWith("modifier_") ||
    name.startsWith("supprimer_")
  );
}

export function isCmsReadTool(tool: string): boolean {
  if (!isCmsTool(tool)) return false;
  const name = tool.replace(/^cms_/, "");
  return (
    name.startsWith("get_") ||
    name.startsWith("list_") ||
    name.startsWith("search_") ||
    name.startsWith("read_")
  );
}

export function buildCmsToolsPromptTable(): string {
  return ALL_CMS_TOOL_NAMES.map((tool) => {
    const mcp = CMS_MCP_TOOL_NAMES[tool] ?? tool.replace(/^cms_/, "");
    const critical = isCmsCriticalTool(tool);
    const risk = critical ? "HIGH" : "LOW — read only";
    return `| ${tool} | RapidoCMS: ${mcp.replace(/_/g, " ")} | ${risk} |`;
  }).join("\n");
}
