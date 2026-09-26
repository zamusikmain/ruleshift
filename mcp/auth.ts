import { z } from "zod";
import { principalSchema, type Principal } from "./contracts";

const keysSchema = z
  .array(
    principalSchema
      .extend({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        expiresAt: z.string().datetime(),
      })
      .strict(),
  )
  .min(1)
  .max(32);

export async function authenticate(
  header: string | null,
  configured: string | undefined,
): Promise<Principal | null> {
  if (!configured) throw new Error("auth_not_configured");
  const keys = keysSchema.parse(JSON.parse(configured));
  if (
    new Set(keys.map((key) => key.id)).size !== keys.length ||
    new Set(keys.map((key) => key.sha256)).size !== keys.length
  )
    throw new Error("invalid_keyring");
  const token = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(header ?? "")?.[1];
  if (!token) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  let result: Principal | null = null;
  for (const key of keys) {
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |= hash.charCodeAt(i) ^ key.sha256.charCodeAt(i);
    if (difference === 0 && Date.parse(key.expiresAt) > Date.now())
      result = { id: key.id, role: key.role };
  }
  return result;
}

export function allowedOrigin(
  request: Request,
  configured?: string,
): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = configured
    ? z.array(z.string().url()).max(16).parse(JSON.parse(configured))
    : [];
  if (origin === "null" || !allowed.includes(origin))
    throw new Error("origin_denied");
  return origin;
}
