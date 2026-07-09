import "server-only";
import { sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";

/**
 * Rate limiting de ventana fija respaldado en Postgres.
 *
 * En Vercel cada request puede correr en una instancia distinta, así que un
 * contador en memoria no limita nada. El UPSERT atómico resuelve además las
 * carreras entre invocaciones concurrentes.
 */
export async function checkRateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const [row] = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, count, window_start)
    VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
        THEN 1
        ELSE rate_limits.count + 1
      END,
      window_start = CASE
        WHEN rate_limits.window_start < now() - (${windowSeconds} || ' seconds')::interval
        THEN now()
        ELSE rate_limits.window_start
      END
    RETURNING count
  `);
  const count = Number(row?.count ?? 1);
  return { allowed: count <= max, remaining: Math.max(0, max - count) };
}

/** IP del cliente detrás del proxy de Vercel. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "desconocida";
}
