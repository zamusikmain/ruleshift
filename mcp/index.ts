import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, allowedOrigin } from "./auth";
import { createMcpServer } from "./server";
import { TOOL_NAMES, type AuditInput, type ControlApi, type McpEnv } from "./contracts";
export { McpControl } from "./control";

const MAX_BODY_BYTES = 16384;
function response(
  data: object,
  status: number,
  extra: Record<string, string> = {},
) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...extra },
  });
}
async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("Content-Length")) > MAX_BODY_BYTES)
    throw new Error("too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
    bytes,
  );
}
export default {
  async fetch(request: Request, env: McpEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return response({ error: "not_found" }, 404);
    // Only direct local development permits HTTP. Tokens must use HTTPS remotely.
    if (
      url.protocol !== "https:" &&
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      return response({ error: "https_required" }, 400);
    let origin: string | null;
    try {
      origin = allowedOrigin(request, env.MCP_ALLOWED_ORIGINS);
    } catch {
      return response({ error: "origin_denied" }, 403);
    }
    const cors: Record<string, string> = origin
      ? {
          "Access-Control-Allow-Origin": origin,
          Vary: "Origin",
          "Access-Control-Expose-Headers":
            "MCP-Protocol-Version,WWW-Authenticate",
        }
      : {};
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          "Access-Control-Allow-Methods": "POST,GET,DELETE,OPTIONS",
          "Access-Control-Allow-Headers":
            "Authorization,Content-Type,MCP-Protocol-Version,Accept",
          "Cache-Control": "no-store",
        },
      });
    let actor;
    try {
      actor = await authenticate(
        request.headers.get("Authorization"),
        env.MCP_KEYS,
      );
    } catch {
      return response({ error: "service_not_configured" }, 503, cors);
    }
    if (!actor)
      return response({ error: "unauthorized" }, 401, {
        ...cors,
        "WWW-Authenticate": 'Bearer realm="ruleshift-mcp"',
      });
    if (request.method !== "POST")
      return response({ error: "method_not_allowed" }, 405, {
        ...cors,
        Allow: "POST,OPTIONS",
      });
    let control: ControlApi;
    try {
      control = env.CONTROL.get(env.CONTROL.idFromName("mcp-control-v1"));
      if (!(await control.consumeRate(actor)))
        return response({ error: "rate_limit" }, 429, {
          ...cors,
          "Retry-After": "60",
        });
    } catch {
      return response({ error: "control_unavailable" }, 503, cors);
    }
    if (
      request.headers
        .get("Content-Type")
        ?.split(";")[0]
        .trim()
        .toLowerCase() !== "application/json"
    )
      return response({ error: "unsupported_media_type" }, 415, cors);
    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch (error) {
      if (error instanceof Error && error.message === "too_large")
        return response({ error: "payload_too_large" }, 413, cors);
      return response(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        },
        400,
        cors,
      );
    }
    if (Array.isArray(body))
      return response(
        {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32600, message: "Batch requests are not supported" },
        },
        400,
        cors,
      );
    let audit: AuditInput | undefined;
    if (
      body &&
      typeof body === "object" &&
      "method" in body &&
      body.method === "tools/call"
    ) {
      const params = "params" in body ? body.params : null;
      const name =
        params && typeof params === "object" && "name" in params
          ? params.name
          : null;
      const action = TOOL_NAMES.find((tool) => tool === name) ?? "unknown_tool";
      audit = { actor, action, outcome: "attempt" };
      try {
        await control.audit(audit);
      } catch {
        return response({ error: "audit_unavailable" }, 503, cors);
      }
    }
    const server = createMcpServer(env, actor, control);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    try {
      await server.connect(transport);
      const rpc = await transport.handleRequest(request, { parsedBody: body });
      const text = await rpc.text();
      if (audit) {
        // A tools/call notification has no response and does not execute a tool.
        let failed = !rpc.ok || rpc.status === 202;
        if (text) {
          const parsed = JSON.parse(text) as {
            error?: unknown;
            result?: { isError?: boolean };
          };
          failed ||= !!parsed.error || !!parsed.result?.isError;
        }
        await control.audit({
          ...audit,
          outcome: failed ? "error" : "success",
        });
      }
      const headers = new Headers(rpc.headers);
      headers.set("Cache-Control", "no-store");
      for (const [name, value] of Object.entries(cors))
        headers.set(name, value);
      return new Response(text || null, { status: rpc.status, headers });
    } catch {
      return response({ error: "mcp_unavailable" }, 503, cors);
    } finally {
      await server.close().catch(() => {});
    }
  },
};
