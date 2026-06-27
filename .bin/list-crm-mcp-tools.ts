/**
 * List tools exposed by RapidoCRM MCP.
 *
 * Usage:
 *   CRM_USER_ID=<supabase-uuid> npm run list-crm-tools
 *   RAPIDOCRM_ACCESS_TOKEN=<token> npm run list-crm-tools
 */

import { config } from "dotenv";
config();

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { connectionsStore } from "../src/integrations/ConnectionsStore";

async function resolveAuth(): Promise<{ accessToken: string; mcpUrl: string }> {
  const manualToken = process.env.RAPIDOCRM_ACCESS_TOKEN?.trim();
  const mcpUrl =
    process.env.RAPIDOCRM_MCP_URL?.trim() || "https://crm.rapidosoftware.com/mcp";

  if (manualToken) {
    return { accessToken: manualToken, mcpUrl };
  }

  const userId = process.env.CRM_USER_ID?.trim();
  if (!userId) {
    throw new Error(
      "Set CRM_USER_ID (Supabase user UUID with RapidoCRM connected) or RAPIDOCRM_ACCESS_TOKEN."
    );
  }

  const conn = await connectionsStore.getCRMConnection(userId);
  return { accessToken: conn.accessToken, mcpUrl: conn.mcpUrl };
}

async function main() {
  const { accessToken, mcpUrl } = await resolveAuth();

  console.log(`Connecting to ${mcpUrl} ...\n`);

  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });

  const client = new Client(
    { name: "RapidoMeetToolLister", version: "1.0.0" },
    { capabilities: {} }
  );

  await client.connect(transport);

  const { tools } = await client.listTools();

  if (!tools.length) {
    console.log("No tools returned.");
    await client.close();
    return;
  }

  console.log(`Found ${tools.length} tool(s):\n`);

  for (const tool of tools) {
    console.log(`• ${tool.name}`);
    if (tool.description) {
      console.log(`  ${tool.description}`);
    }
    if (tool.inputSchema) {
      const props = (tool.inputSchema as { properties?: Record<string, unknown> }).properties;
      if (props) {
        console.log(`  params: ${Object.keys(props).join(", ") || "(none)"}`);
      }
    }
    console.log();
  }

  console.log("--- tool names only ---");
  console.log(tools.map((t) => t.name).join("\n"));

  await client.close();
}

main().catch((err) => {
  console.error("Failed:", (err as Error).message);
  process.exit(1);
});
