import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/db";
import { campaigns, collaborators, companies, sessions } from "@/db/schema";

const COOKIE_NAME = "caramba_session";
const SESSION_HOURS = 24;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Crea sesión opaca y setea cookie HttpOnly. */
export async function createSession(collaboratorId: string, campaignId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);

  await db.insert(sessions).values({
    tokenHash: hashToken(token),
    collaboratorId,
    campaignId,
    expiresAt,
  });

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
}

export type MicrositeSession = {
  collaborator: typeof collaborators.$inferSelect;
  campaign: typeof campaigns.$inferSelect;
  company: typeof companies.$inferSelect;
};

/** Sesión vigente del colaborador, o null. */
export async function getMicrositeSession(): Promise<MicrositeSession | null> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      collaborator: collaborators,
      campaign: campaigns,
      company: companies,
    })
    .from(sessions)
    .innerJoin(collaborators, eq(sessions.collaboratorId, collaborators.id))
    .innerJoin(campaigns, eq(sessions.campaignId, campaigns.id))
    .innerJoin(companies, eq(campaigns.companyId, companies.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
        isNull(sessions.revokedAt),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token) {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(COOKIE_NAME);
}
