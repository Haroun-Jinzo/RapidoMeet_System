/**
 * Maps RapidoMeet internal RH tool ids (rh_*) to Rapido RH MCP tool names.
 * Seed map — replace by running `npm run list-rh-tools` after connecting Rapido RH.
 *
 * Placeholder / expected tools (update from live MCP discovery):
 * - create_leave: Create a leave / congé request
 * - update_employee: Update an employee record
 * - log_action: Log an HR action from a meeting
 * - create_employee: Create an employee
 * - list_employees: List employees
 * - get_employee: Get employee by id
 */

/** Internal RapidoMeet id → Rapido RH MCP tool name (snake_case) */
export const RH_MCP_TOOL_NAMES: Record<string, string> = {
  rh_create_leave: "create_leave",
  rh_update_employee: "update_employee",
  rh_log_action: "log_action",
  rh_create_employee: "create_employee",
  rh_list_employees: "list_employees",
  rh_get_employee: "get_employee",
};

export function resolveRhMcpToolName(internalTool: string): string {
  if (RH_MCP_TOOL_NAMES[internalTool]) return RH_MCP_TOOL_NAMES[internalTool];
  if (internalTool.startsWith("rh_")) return internalTool.slice(3);
  return internalTool;
}

export function isMappedRhTool(tool: string): boolean {
  return tool in RH_MCP_TOOL_NAMES || Object.values(RH_MCP_TOOL_NAMES).includes(tool);
}

/**
 * Strip orchestrator fields and shape args for Rapido RH MCP schemas.
 */
export function mapRhMcpArguments(
  _internalTool: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...params };

  delete args.userId;
  delete args.sessionId;
  delete args._rh_route;

  if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
    const nested = args.data as Record<string, unknown>;
    delete args.data;
    Object.assign(args, nested);
  }

  if (args.title != null && args.titre == null) args.titre = args.title;
  if (args.name != null && args.nom == null) args.nom = args.name;
  if (args.first_name != null && args.prenom == null) args.prenom = args.first_name;
  if (args.last_name != null && args.nom == null) args.nom = args.last_name;
  if (args.firstname != null && args.prenom == null) args.prenom = args.firstname;
  if (args.lastname != null && args.nom == null) args.nom = args.lastname;
  if (args.start_date != null && args.date_debut == null) args.date_debut = args.start_date;
  if (args.end_date != null && args.date_fin == null) args.date_fin = args.end_date;

  return args;
}
