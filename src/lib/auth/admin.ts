import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { adminMagicLinks, adminSessions, adminUsers } from "@/db/schema";

const COOKIE_NAME = "caramba_admin";
const SESSION_HOURS = 12;
const MAGIC_LINK_MINUTES = 30;
const INVITE_HOURS = 72;

/**
 * Autenticación del panel: magic link por correo, sin contraseñas.
 *
 * La sesión es un token opaco guardado en `admin_sessions`, así que se puede
 * revocar de verdad (la cookie firmada anterior seguía válida hasta expirar
 * aunque se quitara el acceso a la persona).
 */

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type AdminUser = typeof adminUsers.$inferSelect;

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

/** Crea un magic link. Devuelve el token en claro SOLO para enviarlo por correo. */
export async function createMagicLink(
  adminUserId: string,
  purpose: "invite" | "login",
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const minutos = purpose === "invite" ? INVITE_HOURS * 60 : MAGIC_LINK_MINUTES;
  await db.insert(adminMagicLinks).values({
    tokenHash: hashToken(token),
    adminUserId,
    purpose,
    expiresAt: new Date(Date.now() + minutos * 60 * 1000),
  });
  return token;
}

/**
 * Canjea un magic link por el usuario dueño del enlace. NO abre sesión: eso lo
 * hace el route handler, que sí tiene acceso a las cookies (así esta función
 * es testeable y reusable fuera de una request).
 *
 * Un solo uso: marcamos `usedAt` en la misma sentencia que lo leemos, para que
 * dos clicks simultáneos no lo canjeen dos veces.
 */
export async function redeemMagicLink(token: string): Promise<AdminUser | null> {
  const [link] = await db
    .update(adminMagicLinks)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(adminMagicLinks.tokenHash, hashToken(token)),
        isNull(adminMagicLinks.usedAt),
        gt(adminMagicLinks.expiresAt, new Date()),
      ),
    )
    .returning({ adminUserId: adminMagicLinks.adminUserId });

  if (!link) return null;

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.id, link.adminUserId), eq(adminUsers.active, true)));
  if (!user) return null;

  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  return user;
}

// ---------------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------------

export async function createAdminSession(adminUserId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  await db.insert(adminSessions).values({ tokenHash: hashToken(token), adminUserId, expiresAt });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

/** Usuario del panel con sesión vigente, o null. */
export async function getAdminUser(): Promise<AdminUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
    .where(
      and(
        eq(adminSessions.tokenHash, hashToken(token)),
        gt(adminSessions.expiresAt, new Date()),
        isNull(adminSessions.revokedAt),
        eq(adminUsers.active, true),
      ),
    )
    .limit(1);

  return rows[0]?.user ?? null;
}

export async function isAdminAuthenticated(): Promise<boolean> {
  return (await getAdminUser()) !== null;
}

/** Guard para páginas del panel. Devuelve el usuario para el audit log. */
export async function requireAdmin(): Promise<AdminUser> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return user;
}

/** Guard para acciones que solo puede hacer el dueño de la cuenta. */
export async function requireOwner(): Promise<AdminUser> {
  const user = await requireAdmin();
  if (user.role !== "owner") {
    throw new Error("Solo el propietario puede gestionar usuarios del panel");
  }
  return user;
}

export async function destroyAdminSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessions.tokenHash, hashToken(token)));
  }
  store.delete(COOKIE_NAME);
}

/** Cierra TODAS las sesiones de un usuario (al revocarle el acceso). */
export async function revokeAllSessions(adminUserId: string): Promise<void> {
  await db
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)));
}

// ---------------------------------------------------------------------------
// Acceso de emergencia
// ---------------------------------------------------------------------------

/**
 * Password de respaldo (ADMIN_PASSWORD). Existe solo para no quedar fuera del
 * panel si el correo falla: entra como el usuario `owner` más antiguo.
 * Si la variable no está definida, este camino no existe.
 */
export function verifyAdminPassword(password: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function loginWithEmergencyPassword(): Promise<boolean> {
  const [owner] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.role, "owner"), eq(adminUsers.active, true)))
    .orderBy(adminUsers.createdAt)
    .limit(1);
  if (!owner) return false;
  await createAdminSession(owner.id);
  return true;
}
