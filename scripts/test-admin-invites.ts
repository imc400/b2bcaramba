/**
 * Verifica la seguridad de los magic links del panel y la idempotencia de las
 * invitaciones a colaboradores. No toca Shopify ni envía correos reales.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const schema = await import("../src/db/schema");
  const { adminUsers, adminMagicLinks, collaborators, campaigns, companies } = schema;
  const { and, eq, isNull, sql } = await import("drizzle-orm");
  const { createMagicLink, hashToken, redeemMagicLink } = await import("../src/lib/auth/admin");

  let fallos = 0;
  const check = (ok: boolean, l: string, d = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`);
    if (!ok) fallos++;
  };

  console.log("1. Magic link del panel");
  const [owner] = await db.select().from(adminUsers).where(eq(adminUsers.role, "owner")).limit(1);
  if (!owner) throw new Error('Crea un propietario primero: pnpm admin:crear <correo> "<nombre>"');
  check(true, "existe un propietario", owner.email);

  const token = await createMagicLink(owner.id, "login");
  check((await redeemMagicLink(token))?.id === owner.id, "primer uso canjea el enlace");
  check((await redeemMagicLink(token)) === null, "segundo uso rechazado (un solo uso)");
  check((await redeemMagicLink("inventado")) === null, "token inexistente rechazado");

  const vencido = await createMagicLink(owner.id, "login");
  await db
    .update(adminMagicLinks)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(adminMagicLinks.tokenHash, hashToken(vencido)));
  check((await redeemMagicLink(vencido)) === null, "enlace vencido rechazado");

  console.log("\n2. Cuenta revocada");
  const [editor] = await db
    .insert(adminUsers)
    .values({ email: "editor.test@caramba.cl", name: "Editor Test", role: "editor" })
    .returning();
  const tokenEditor = await createMagicLink(editor.id, "invite");
  await db.update(adminUsers).set({ active: false }).where(eq(adminUsers.id, editor.id));
  check(
    (await redeemMagicLink(tokenEditor)) === null,
    "una cuenta revocada no entra ni con su invitación",
  );
  await db.delete(adminUsers).where(eq(adminUsers.id, editor.id));

  console.log("\n3. Invitaciones a colaboradores (idempotencia)");
  const [ctx] = await db
    .select({ campaignId: campaigns.id })
    .from(campaigns)
    .innerJoin(companies, eq(companies.id, campaigns.companyId))
    .where(eq(companies.slug, "entel"))
    .limit(1);

  const [antes] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collaborators)
    .where(and(eq(collaborators.campaignId, ctx.campaignId), isNull(collaborators.invitedAt)));
  check(antes.n > 0, "hay colaboradores sin invitar", `${antes.n}`);

  // Lo que hace la acción tras enviar cada correo
  await db
    .update(collaborators)
    .set({ invitedAt: new Date() })
    .where(and(eq(collaborators.campaignId, ctx.campaignId), isNull(collaborators.invitedAt)));

  const [despues] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collaborators)
    .where(and(eq(collaborators.campaignId, ctx.campaignId), isNull(collaborators.invitedAt)));
  check(despues.n === 0, "un segundo envío no re-invitaría a nadie");

  // Restaurar el estado
  await db
    .update(collaborators)
    .set({ invitedAt: null })
    .where(eq(collaborators.campaignId, ctx.campaignId));

  console.log(fallos === 0 ? "\n✓ MAGIC LINKS E INVITACIONES OK\n" : `\n✗ ${fallos} fallos\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
