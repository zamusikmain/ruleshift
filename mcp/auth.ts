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

export class AuthConfigurationError extends Error {
  constructor(readonly code: "auth_secret_missing" | "auth_secret_invalid") {
    super(code);
  }
}

export async function authenticate(
  header: string | null,
  configured: string | undefined,
): Promise<Principal | null> {
  if (!configured) throw new AuthConfigurationError("auth_secret_missing");
  let keys: z.infer<typeof keysSchema>;
  try {
    keys = keysSchema.parse(JSON.parse(configured));
  } catch {
    throw new AuthConfigurationError("auth_secret_invalid");
  }
  if (
    new Set(keys.map((key) => key.id)).size !== keys.length ||
    new Set(keys.map((key) => key.sha256)).size !== keys.length
  )
    throw new AuthConfigurationError("auth_secret_invalid");
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
