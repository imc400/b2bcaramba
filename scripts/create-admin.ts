/**
 * Crea el primer usuario del panel (propietario) e imprime su magic link.
 *
 *   pnpm admin:crear javiera@caramba.cl "Javiera Fernández"
 *   DATABASE_URL=... pnpm admin:crear ...     # contra producción
 *
 * Necesario una sola vez: después Javiera invita a su equipo desde el panel.
 * Si el correo ya existe, reactiva la cuenta y genera un enlace nuevo.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const [email, ...nombre] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!email || !email.includes("@")) {
    console.error('Uso: pnpm admin:crear <correo> "<Nombre Apellido>"');
    process.exit(1);
  }
  const name = nombre.join(" ") || null;

  const { db } = await import("../src/db");
  const { adminUsers } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { createMagicLink } = await import("../src/lib/auth/admin");

  const correo = email.toLowerCase().trim();
  const [existente] = await db.select().from(adminUsers).where(eq(adminUsers.email, correo));

  let userId: string;
  if (existente) {
    await db
      .update(adminUsers)
      .set({ active: true, role: "owner", name: name ?? existente.name })
      .where(eq(adminUsers.id, existente.id));
    userId = existente.id;
    console.log(`Cuenta reactivada como propietario: ${correo}`);
  } else {
    const [creado] = await db
      .insert(adminUsers)
      .values({ email: correo, name, role: "owner" })
      .returning();
    userId = creado.id;
    console.log(`Cuenta creada: ${correo} (propietario)`);
  }

  const token = await createMagicLink(userId, "invite");
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/admin/entrar?token=${token}`;
  console.log("\nEnlace de acceso (válido 72 horas, un solo uso):\n");
  console.log(`  ${url}\n`);
  console.log("Si Resend está configurado, también puedes pedir el enlace desde /admin/login.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
