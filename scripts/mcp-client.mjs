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
let stage = "initialize";
let lastHttpFailure;

function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .split(token)
    .join("[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9_-]{20,}/gi, "Bearer [REDACTED]");
}

function errorDetails(error) {
  if (!(error instanceof Error)) return { value: redact(String(error)) };
  const details = {
    name: error.name,
    message: redact(error.message),
    stack: redact(error.stack),
  };
  if ("code" in error && ["number", "string"].includes(typeof error.code))
    details.code = error.code;
  if (error.cause !== undefined) details.cause = errorDetails(error.cause);
  return details;
}

async function diagnosticFetch(input, init) {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      const type = response.headers.get("content-type") ?? "";
      let body = "<not displayed: non-text response>";
      if (type.includes("application/json") || type.startsWith("text/"))
        body = redact((await response.clone().text()).slice(0, 2048));
      lastHttpFailure = {
        status: response.status,
        statusText: response.statusText,
        contentType: type,
        body,
      };
    }
    return response;
  } catch (error) {
    lastHttpFailure = { transportError: errorDetails(error) };
    throw error;
  }
}

try {
  await client.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: diagnosticFetch,
    }),
  );
  stage = "tools/list";
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
    stage = `tools/call:${name}`;
    const result = await client.callTool({ name, arguments: {} });
    console.log(JSON.stringify({ tool: name, result }, null, 2));
    if (result.isError) process.exitCode = 1;
  }
} catch (error) {
  // Only bounded response bodies and redacted Error fields are reported. Request
  // headers, request bodies and environment values are never printed.
  console.error("MCP smoke-test failed:");
  console.error(
    JSON.stringify(
      { stage, http: lastHttpFailure, error: errorDetails(error) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await client.close();
}
