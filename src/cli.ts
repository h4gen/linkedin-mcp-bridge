#!/usr/bin/env node
import { errorDetails, adapterDiagnostics } from "./core/errors.js";
import { capabilities } from "./core/capabilities.js";
import { VERSION } from "./version.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  schemas,
  descriptions,
  serverInstructions,
  writes,
  Operation,
} from "./core/contracts.js";
import { call } from "./native/client.js";
import {
  agentInstructions,
  REPOSITORY,
  RELEASE_REF,
  STORE_URL,
} from "./setup.js";
import { STORE_EXTENSION_ID } from "./version.js";
import { install, uninstall } from "./installer.js";
async function main() {
  const command = process.argv[2] ?? "mcp";
  if (command === "install") {
    console.log(JSON.stringify(await install(process.argv[3]), null, 2));
    return;
  }
  if (command === "uninstall") {
    console.log(JSON.stringify(await uninstall(), null, 2));
    return;
  }
  if (command === "instructions") {
    const client = process.argv[3];
    if (client !== "codex" && client !== "claude")
      throw Error("Usage: instructions codex|claude [EXTENSION_ID]");
    console.log(
      agentInstructions(client, process.argv[4] ?? STORE_EXTENSION_ID),
    );
    return;
  }
  if (command === "doctor") {
    try {
      const health = await call("health", {});
      if (health.version !== VERSION)
        throw Error(
          `version_mismatch: CLI ${VERSION}, connected extension ${health.version}. Use the matching extension/server release, restart the MCP client, then run doctor again. No Connect click is required.`,
        );
      console.log(JSON.stringify(health, null, 2));
      if (!health.connected) process.exitCode = 1;
    } catch (e) {
      console.log(
        JSON.stringify(
          {
            connected: false,
            version: VERSION,
            error: e instanceof Error ? e.message : "connection_unavailable",
            extension_url: STORE_URL,
            installation_guide:
              REPOSITORY + "/blob/" + RELEASE_REF + "/docs/INSTALL_AGENT.md",
            next: "Check Chrome and the extension's settings. Install the matching local server if missing; sign in to LinkedIn if requested. An unreachable transport alone does not establish whether Chrome is closed or the extension is missing.",
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
    return;
  }
  if (command !== "mcp")
    throw Error(
      "Usage: linkedin-mcp-bridge [mcp | doctor | install [EXTENSION_ID] | instructions codex|claude [EXTENSION_ID] | uninstall]",
    );
  const server = new McpServer(
    {
      name: "linkedin-mcp-bridge",
      version: VERSION,
    },
    { instructions: serverInstructions },
  );
  for (const [name, schema] of Object.entries(schemas)) {
    const op = name as Operation;
    if (!capabilities[op].enabled) continue;
    server.registerTool(
      "linkedin_" + name,
      {
        description: descriptions[op],
        inputSchema: schema.shape,
        outputSchema: capabilities[op].output,
        annotations: {
          readOnlyHint: !writes.has(op),
          destructiveHint: writes.has(op),
          idempotentHint: !writes.has(op),
          openWorldHint: true,
        },
      },
      async (args: Record<string, unknown>, extra: { signal: AbortSignal }) => {
        try {
          const result = capabilities[op].output.parse(
            await call(op, args, extra.signal),
          );
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result,
          };
        } catch (e) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: {
                    ...errorDetails(
                      e instanceof Error ? e.message : "operation_failed",
                    ),
                    ...adapterDiagnostics((e as any)?.details),
                    ...((e as any)?.details?.navigation
                      ? { navigation: (e as any).details.navigation }
                      : {}),
                    ...((e as { details?: { retry_at?: string } })?.details
                      ?.retry_at
                      ? {
                          retry_at: (e as { details: { retry_at: string } })
                            .details.retry_at,
                        }
                      : {}),
                  },
                }),
              },
            ],
          };
        }
      },
    );
  }
  await server.connect(new StdioServerTransport());
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Failed");
  process.exitCode = 1;
});
