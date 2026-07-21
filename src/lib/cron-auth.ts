import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Valida el header que Vercel Cron adjunta automáticamente cuando existe la
 * variable CRON_SECRET: `Authorization: Bearer <CRON_SECRET>`. También permite
 * disparar la ruta a mano con el mismo bearer. Sin CRON_SECRET, no se autoriza.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
