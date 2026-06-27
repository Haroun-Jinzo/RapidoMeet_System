/**
 * Maps RapidoMeet internal CRM tool ids (crm_*) to RapidoCRM MCP tool names.
 * Run `npm run list-crm-tools` to refresh names from the live server.
 */

/** Internal RapidoMeet id → RapidoCRM MCP tool name (snake_case) */
export const CRM_MCP_TOOL_NAMES: Record<string, string> = {
  // Entreprise
  crm_create_enterprise: "create_entreprise",
  crm_read_enterprise: "get_entreprise",
  crm_update_enterprise: "update_entreprise",
  crm_delete_enterprise: "delete_entreprise",

  // Contact
  crm_create_contact: "create_contact",
  crm_read_contact: "get_contact",
  crm_update_contact: "update_contact",
  crm_delete_contact: "delete_contact",

  // SMS / email templates
  crm_create_sms_template: "create_template_sms",
  crm_read_sms_template: "get_template",
  crm_update_sms_template: "update_template_sms",
  crm_delete_sms_template: "delete_template_sms",
  crm_create_email_template: "create_template_email",
  crm_read_email_template: "get_template",
  crm_update_email_template: "update_template_email",
  crm_delete_email_template: "delete_template_email",

  // Factures / devis / dépenses
  crm_create_invoice: "create_facture",
  crm_read_invoice: "get_facture",
  crm_create_quote: "create_devis",
  crm_read_quote: "list_devis",
  crm_create_expense: "create_depense",

  // Contrats
  crm_create_contract: "create_contrat",
  crm_read_contract: "get_contrat",
  crm_delete_contract: "delete_contrat",

  // Legacy
  crm_log_activity: "log_activity",
  crm_create_opportunity: "ajouter_prospect_pipeline",
};

export function resolveCrmMcpToolName(internalTool: string): string {
  return CRM_MCP_TOOL_NAMES[internalTool] ?? internalTool;
}

/**
 * Strip orchestrator fields and shape args for RapidoCRM MCP schemas.
 */
export function mapCrmMcpArguments(
  internalTool: string,
  params: Record<string, unknown>
): Record<string, unknown> {
  const args: Record<string, unknown> = { ...params };

  delete args.userId;
  delete args.sessionId;
  delete args.rapidocrm_api_key;
  delete args.api_url;
  delete args._crm_route;

  // Gemini often nests resource fields under `data`
  if (args.data && typeof args.data === "object" && !Array.isArray(args.data)) {
    const nested = args.data as Record<string, unknown>;
    delete args.data;
    Object.assign(args, nested);
  }

  switch (internalTool) {
    case "crm_create_sms_template":
      if (args.template_name != null && args.nom == null && args.name == null) {
        args.nom = args.template_name ?? args.name;
      }
      if (args.name != null && args.nom == null) {
        args.nom = args.name;
      }
      if (args.content != null && args.contenu == null) {
        args.contenu = args.content;
      }
      if (args.body != null && args.contenu == null) {
        args.contenu = args.body;
      }
      delete args.name;
      delete args.template_name;
      delete args.content;
      delete args.body;
      break;

    case "crm_create_email_template":
      if (args.name != null && args.nom == null) args.nom = args.name;
      if (args.content != null && args.contenu == null) args.contenu = args.content;
      delete args.name;
      delete args.content;
      break;

    case "crm_create_enterprise":
    case "crm_update_enterprise":
    case "crm_create_contact":
    case "crm_update_contact": {
      const reserved = new Set(["id", "q", "statut", "periode", "limit", "confirm", "payload"]);
      if (!args.payload) {
        const payload: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(args)) {
          if (!reserved.has(key) && value != null) {
            payload[key] = value;
          }
        }
        // RapidoCRM DB columns use French field names (nom, not name)
        const nameCandidate =
          payload.nom ??
          payload.name ??
          payload.company_name ??
          payload.raison_sociale ??
          payload.summary ??
          payload.title;
        if (nameCandidate != null && payload.nom == null) {
          payload.nom = nameCandidate;
        }
        delete payload.name;
        delete payload.company_name;
        delete payload.raison_sociale;
        delete payload.summary;
        delete payload.title;
        const out: Record<string, unknown> = {};
        for (const key of reserved) {
          if (args[key] != null) out[key] = args[key];
        }
        if (Object.keys(payload).length > 0) out.payload = payload;
        if (internalTool === "crm_create_enterprise" && !payload.nom) {
          throw new Error(
            "crm_create_enterprise requires a company name (use parameter name / nom)"
          );
        }
        return out;
      }
      break;
    }

    case "crm_read_sms_template":
    case "crm_read_email_template":
      if (!args.type) args.type = internalTool.includes("sms") ? "sms" : "email";
      if (args.name != null && args.template_nom == null) args.template_nom = args.name;
      break;

    default:
      break;
  }

  return args;
}
