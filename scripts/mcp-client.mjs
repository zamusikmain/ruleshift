// Read-only example: credentials come from the caller's environment, never from source.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const endpoint = process.env.RULESHIFT_MCP_URL;
const token = process.env.RULESHIFT_MCP_TOKEN;
if (!endpoint || !token)
  throw new Error("Set RULESHIFT_MCP_URL and RULESHIFT_MCP_TOKEN.");
const url = new URL(endpoint);
if (
  url.protocol !== "https:" &&
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
)
  throw new Error("Use HTTPS for remote MCP.");
const client = new Client({
  name: "ruleshift-example-agent",
  version: "1.0.0",
});
try {
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  const { tools } = await client.listTools();
  console.log(
    JSON.stringify(
      {
        tools: tools.map((tool) => ({
          name: tool.name,
          readOnly: tool.annotations?.readOnlyHint,
        })),
      },
      null,
      2,
    ),
  );
  for (const name of [
    "get_game_status",
    "get_game_config",
    "get_active_matches",
  ]) {
    const result = await client.callTool({ name, arguments: {} });
    console.log(JSON.stringify({ tool: name, result }, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} catch {
  // Do not print transport internals or request headers containing credentials.
  console.error(
    "MCP connection or request failed. Check endpoint, credentials, expiry and deployment.",
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
