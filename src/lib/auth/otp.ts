import "server-only";
import { createHash, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { otpCodes } from "@/db/schema";

const OTP_TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 3;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Genera un OTP de 6 dígitos para el colaborador.
 * Devuelve el código en claro SOLO para enviarlo por correo.
 * Rate limit: máx 3 códigos/hora por colaborador (anti-abuso).
 */
export async function createOtp(
  collaboratorId: string,
): Promise<{ ok: true; code: string } | { ok: false; reason: "rate_limited" }> {
  const recent = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.collaboratorId, collaboratorId),
        gt(otpCodes.createdAt, sql`now() - interval '1 hour'`),
      ),
    );
  if ((recent[0]?.count ?? 0) >= MAX_CODES_PER_HOUR) {
    return { ok: false, reason: "rate_limited" };
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.insert(otpCodes).values({
    collaboratorId,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000),
  });
  return { ok: true, code };
}

/**
 * Verifica un OTP: un solo uso, expiración, máximo de intentos.
 * Timing-safe por diseño: compara hashes de largo fijo.
 *
 * DEMO_MASTER_OTP (env): clave estándar que valida para cualquier colaborador.
 * Pensada para demos ANTES de configurar Resend (los códigos reales solo se
 * ven en la consola del server). QUITAR la variable en producción.
 */
export async function verifyOtp(collaboratorId: string, code: string): Promise<boolean> {
  const masterOtp = process.env.DEMO_MASTER_OTP;
  if (masterOtp && code.trim() === masterOtp) return true;
  const candidate = await db
    .select()
    .from(otpCodes)
    .where(
      and(
        eq(otpCodes.collaboratorId, collaboratorId),
        isNull(otpCodes.usedAt),
        gt(otpCodes.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(otpCodes.createdAt))
    .limit(1);

  const otp = candidate[0];
  if (!otp) return false;
  if (otp.attempts >= MAX_ATTEMPTS) return false;

  if (otp.codeHash !== hashCode(code.trim())) {
    await db
      .update(otpCodes)
      .set({ attempts: otp.attempts + 1 })
      .where(eq(otpCodes.id, otp.id));
    return false;
  }

  await db.update(otpCodes).set({ usedAt: new Date() }).where(eq(otpCodes.id, otp.id));
  return true;
}
