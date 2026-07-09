import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { syncState } from "@/db/schema";

const TOKEN_KEY = "shopify_admin_token";

/**
 * Token de Admin API: primero env (SHOPIFY_ADMIN_ACCESS_TOKEN), luego DB
 * (guardado por el callback OAuth). En DB para sobrevivir reinstalaciones
 * y permitir rotación sin redeploy.
 */
export async function getAdminAccessToken(): Promise<string | null> {
  const fromEnv = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;

  const row = await db.query.syncState.findFirst({
    where: eq(syncState.key, TOKEN_KEY),
  });
  return (row?.value as { token?: string } | undefined)?.token ?? null;
}

export async function saveAdminAccessToken(token: string, scope: string): Promise<void> {
  await db
    .insert(syncState)
    .values({ key: TOKEN_KEY, value: { token, scope } })
    .onConflictDoUpdate({
      target: syncState.key,
      set: { value: { token, scope }, updatedAt: new Date() },
    });
}
