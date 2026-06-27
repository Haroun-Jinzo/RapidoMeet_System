/**
 * RapidoCRM resource & CRUD tool registry.
 * Tool names follow: crm_{operation}_{resource}
 * Used by router, dispatcher, services, and Gemini tool declarations.
 */

export const CRM_OPERATIONS = ["create", "read", "update", "delete"] as const;
export type CrmOperation = (typeof CRM_OPERATIONS)[number];

export const CRM_RESOURCES = [
  { slug: "enterprise",    label: "Entreprise",     apiPath: "/enterprises" },
  { slug: "contact",     label: "Contact",        apiPath: "/contacts" },
  { slug: "employee",    label: "Employé",        apiPath: "/employees" },
  { slug: "sms_template",   label: "Template SMS",   apiPath: "/sms-templates" },
  { slug: "email_template", label: "Template Email", apiPath: "/email-templates" },
  { slug: "invoice",     label: "Facture",        apiPath: "/invoices" },
  { slug: "quote",       label: "Devis",          apiPath: "/quotes" },
  { slug: "expense",     label: "Dépense",        apiPath: "/expenses" },
  { slug: "contract",    label: "Contrat",        apiPath: "/contracts" },
] as const;

export type CrmResourceSlug = (typeof CRM_RESOURCES)[number]["slug"];

/** Legacy / special CRM tools kept for backward compatibility */
export const CRM_LEGACY_TOOLS = [
  "crm_create_opportunity",
  "crm_log_activity",
] as const;

export type CrmLegacyTool = (typeof CRM_LEGACY_TOOLS)[number];

export type CrmCrudToolName = `crm_${CrmOperation}_${CrmResourceSlug}`;

function buildCrudToolNames(): CrmCrudToolName[] {
  const names: CrmCrudToolName[] = [];
  for (const op of CRM_OPERATIONS) {
    for (const res of CRM_RESOURCES) {
      names.push(`crm_${op}_${res.slug}` as CrmCrudToolName);
    }
  }
  return names;
}

export const CRM_CRUD_TOOL_NAMES = buildCrudToolNames();

export const ALL_CRM_TOOL_NAMES = [
  ...CRM_CRUD_TOOL_NAMES,
  ...CRM_LEGACY_TOOLS,
] as const;

export type CrmToolName = (typeof ALL_CRM_TOOL_NAMES)[number];

const CRITICAL_OPS = new Set<CrmOperation>(["create", "update", "delete"]);

export function isCrmTool(tool: string): tool is CrmToolName {
  return (ALL_CRM_TOOL_NAMES as readonly string[]).includes(tool);
}

export function isCrmCriticalTool(tool: string): boolean {
  if (tool === "crm_log_activity") return false;
  if (tool === "crm_create_opportunity") return true;
  if (!tool.startsWith("crm_")) return false;

  for (const op of CRM_OPERATIONS) {
    if (CRITICAL_OPS.has(op) && tool.startsWith(`crm_${op}_`)) return true;
  }
  return false;
}

export function isCrmReadTool(tool: string): boolean {
  return tool.startsWith("crm_read_");
}

/** n8n route map entry — used as documentation / optional Code node reference */
export interface CrmRouteConfig {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  critical: boolean;
}

export function getCrmRouteConfig(tool: string): CrmRouteConfig | null {
  if (!isCrmTool(tool) && tool !== "crm_create_opportunity") return null;

  if (tool === "crm_create_opportunity") {
    return { method: "POST", path: "/opportunities", critical: true };
  }
  if (tool === "crm_log_activity") {
    return { method: "POST", path: "/activities", critical: false };
  }

  const match = tool.match(/^crm_(create|read|update|delete)_(.+)$/);
  if (!match) return null;

  const [, op, slug] = match as [string, CrmOperation, CrmResourceSlug];
  const resource = CRM_RESOURCES.find(r => r.slug === slug);
  if (!resource) return null;

  const methodMap: Record<CrmOperation, CrmRouteConfig["method"]> = {
    create: "POST",
    read:   "GET",
    update: "PUT",
    delete: "DELETE",
  };

  const path =
    op === "read" || op === "update" || op === "delete"
      ? `${resource.apiPath}/{{id}}`
      : resource.apiPath;

  return {
    method: methodMap[op],
    path,
    critical: CRITICAL_OPS.has(op),
  };
}

export function buildCrmToolsPromptTable(): string {
  const lines = CRM_RESOURCES.flatMap(res =>
    CRM_OPERATIONS.map(op => {
      const tool = `crm_${op}_${res.slug}`;
      const risk = CRITICAL_OPS.has(op) ? "HIGH" : "LOW — read only";
      return `| ${tool} | ${op} ${res.label} in RapidoCRM | ${risk} |`;
    })
  );

  lines.push("| crm_create_opportunity | Creates a sales opportunity | HIGH |");
  lines.push("| crm_log_activity | Logs a note on an existing contact | LOW — append only |");

  return lines.join("\n");
}

/** Sort priority: deletes/updates last among CRM, reads before writes, email always last */
export function crmToolSortIndex(tool: string): number {
  if (tool === "crm_log_activity") return 200;
  if (tool === "crm_create_opportunity") return 10;

  const match = tool.match(/^crm_(create|read|update|delete)_(.+)$/);
  if (!match) return 500;

  const [, op, slug] = match;
  const resIndex = CRM_RESOURCES.findIndex(r => r.slug === slug);
  const opOrder: Record<string, number> = { create: 0, read: 1, update: 2, delete: 3 };
  return 10 + resIndex * 10 + (opOrder[op] ?? 9);
}

// ── Gemini function declarations (generated) ─────────────────────────────

function opDescription(op: CrmOperation, label: string): string {
  const verbs: Record<CrmOperation, string> = {
    create: `Create a new ${label} in RapidoCRM`,
    read:   `Read/fetch a ${label} from RapidoCRM`,
    update: `Update an existing ${label} in RapidoCRM`,
    delete: `Delete a ${label} from RapidoCRM (irreversible)`,
  };
  return verbs[op] + ". Only use when explicitly mentioned or clearly implied in the meeting.";
}

function opParameters(op: CrmOperation, label: string): Record<string, unknown> {
  const idField = {
    type: "STRING",
    description: `ID of the ${label} (required for read/update/delete)`,
  };

  const base: Record<string, unknown> = {
    type: "OBJECT",
    properties: {
      id: idField,
      name: { type: "STRING", description: "Name or title" },
      email: { type: "STRING", description: "Email address (contacts/employees)" },
      notes: { type: "STRING", description: "Additional notes from the meeting" },
      data: {
        type: "OBJECT",
        description: "Resource-specific fields to create or update",
      },
    },
  };

  if (op === "create") {
    return { ...base, required: [] };
  }
  if (op === "read") {
    return {
      type: "OBJECT",
      properties: {
        id: idField,
        search: { type: "STRING", description: "Search query if ID is unknown" },
      },
      required: [],
    };
  }
  return { ...base, required: ["id"] };
}

export function buildCrmGeminiDeclarations(): Record<string, unknown>[] {
  const declarations: Record<string, unknown>[] = [];

  for (const res of CRM_RESOURCES) {
    for (const op of CRM_OPERATIONS) {
      const decl: Record<string, unknown> = {
        name: `crm_${op}_${res.slug}`,
        description: opDescription(op, res.label),
        parameters: opParameters(op, res.label),
      };
      if (op === "create" && res.slug === "enterprise") {
        decl.parameters = {
          type: "OBJECT",
          properties: {
            name: {
              type: "STRING",
              description: "Company / enterprise name (required — stored as nom in RapidoCRM)",
            },
            email: { type: "STRING", description: "Contact email for the enterprise" },
            notes: { type: "STRING", description: "Additional notes from the meeting" },
            data: {
              type: "OBJECT",
              description: "Extra enterprise fields (phone, address, siret, etc.)",
            },
          },
          required: ["name"],
        };
      }
      declarations.push(decl);
    }
  }

  declarations.push({
    name: "crm_create_opportunity",
    description: "Create a sales opportunity in RapidoCRM. HIGH risk — requires confirmation.",
    parameters: {
      type: "OBJECT",
      properties: {
        title:       { type: "STRING", description: "Opportunity title" },
        contact_id:  { type: "STRING", description: "Linked contact ID" },
        amount:      { type: "NUMBER", description: "Deal value" },
        stage:       { type: "STRING", description: "Pipeline stage" },
        notes:       { type: "STRING", description: "Notes from the meeting" },
      },
      required: ["title"],
    },
  });

  declarations.push({
    name: "crm_log_activity",
    description: "Log a meeting note on an existing CRM contact. Safe to auto-execute.",
    parameters: {
      type: "OBJECT",
      properties: {
        contact_id: { type: "STRING", description: "Existing contact ID" },
        note:       { type: "STRING", description: "Activity note" },
        type:       { type: "STRING", description: "Activity type (call, meeting, email)" },
      },
      required: ["contact_id", "note"],
    },
  });

  return declarations;
}

/** Export n8n route map as JSON-friendly object for documentation */
export function buildN8nRouteMap(): Record<string, CrmRouteConfig> {
  const map: Record<string, CrmRouteConfig> = {};
  for (const tool of ALL_CRM_TOOL_NAMES) {
    const route = getCrmRouteConfig(tool);
    if (route) map[tool] = route;
  }
  return map;
}
