import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { adminMagicLinks, adminSessions, adminUsers } from "@/db/schema";
import { ADMIN_COOKIE as COOKIE_NAME } from "./cookie-names";
import { hashPassword, verifyPassword } from "./password";

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

/**
 * Guard para páginas del panel. Devuelve el usuario para el audit log.
 * Con contraseña temporal pendiente, fuerza el paso por /admin/cuenta: sin
 * esto, el "cambio forzado" sería solo una sugerencia de UI (bastaría teclear
 * /admin/pedidos). Solo la página de cuenta pasa `permitirCambioPendiente`.
 */
export async function requireAdmin(opts?: {
  permitirCambioPendiente?: boolean;
}): Promise<AdminUser> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  if (user.mustChangePassword && !opts?.permitirCambioPendiente) {
    redirect("/admin/cuenta?forzar=1");
  }
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
// Contraseña propia (independiente del correo/Resend)
// ---------------------------------------------------------------------------

/**
 * Login con correo + contraseña. Devuelve el usuario si la contraseña es
 * correcta y la cuenta está activa; null en cualquier otro caso.
 *
 * NO abre sesión: eso lo hace el server action, que sí tiene cookies. Así la
 * función es testeable fuera de una request.
 */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<AdminUser | null> {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(and(eq(adminUsers.email, email.toLowerCase().trim()), eq(adminUsers.active, true)))
    .limit(1);
  if (!user) {
    // Igualamos el costo aunque el usuario no exista, para no filtrar por timing
    // si un correo tiene cuenta o no.
    await verifyPassword(password, `scrypt$${"00".repeat(16)}$${"00".repeat(64)}`);
    return null;
  }
  if (!(await verifyPassword(password, user.passwordHash))) return null;
  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  return user;
}

/** Fija (o reemplaza) la contraseña de un usuario. */
export async function setAdminPassword(
  adminUserId: string,
  password: string,
  mustChange = false,
): Promise<void> {
  await db
    .update(adminUsers)
    .set({ passwordHash: await hashPassword(password), mustChangePassword: mustChange })
    .where(eq(adminUsers.id, adminUserId));
}

/**
 * Cambia la contraseña del propio usuario. Exige la contraseña actual, salvo
 * que sea el cambio forzado de una contraseña temporal (mustChangePassword).
 */
export async function changeOwnPassword(
  user: AdminUser,
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const tienePassword = Boolean(user.passwordHash);
  if (tienePassword && !user.mustChangePassword) {
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return { ok: false, error: "La contraseña actual no es correcta." };
    }
  }
  await setAdminPassword(user.id, newPassword, false);
  // Cerrar las demás sesiones: un cambio de contraseña invalida el resto.
  await revokeAllSessionsExceptCurrent(user.id);
  return { ok: true };
}

/** Revoca las sesiones del usuario salvo la actual (tras cambiar la contraseña). */
async function revokeAllSessionsExceptCurrent(adminUserId: string): Promise<void> {
  const store = await cookies();
  const actual = store.get(COOKIE_NAME)?.value;
  const actualHash = actual ? hashToken(actual) : "";
  const abiertas = await db
    .select({ tokenHash: adminSessions.tokenHash })
    .from(adminSessions)
    .where(and(eq(adminSessions.adminUserId, adminUserId), isNull(adminSessions.revokedAt)));
  for (const s of abiertas) {
    if (s.tokenHash === actualHash) continue;
    await db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(eq(adminSessions.tokenHash, s.tokenHash));
  }
}

// El acceso de emergencia por ADMIN_PASSWORD (secreto compartido que entraba
// como el owner más antiguo) se eliminó: el break-glass sin correo es
// `pnpm admin:password <correo> "<clave>"`, que preserva la trazabilidad.
