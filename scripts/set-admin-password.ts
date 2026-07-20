/**
 * Fija la contraseña de un usuario del panel desde la línea de comandos.
 * Sirve para dejar lista la cuenta de Javiera y como acceso de emergencia si
 * un propietario queda fuera (break-glass, sin depender del correo).
 *
 *   pnpm admin:password javiera@caramba.cl "MiClaveTemporal123"
 *   pnpm admin:password javiera@caramba.cl "MiClave123" --definitiva
 *
 * Por defecto marca la contraseña como temporal (la persona la cambia al
 * entrar). Con --definitiva la deja como final.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const args = process.argv.slice(2);
  const definitiva = args.includes("--definitiva");
  const [email, password] = args.filter((a) => !a.startsWith("--"));

  if (!email || !email.includes("@") || !password) {
    console.error('Uso: pnpm admin:password <correo> "<contraseña>" [--definitiva]');
    process.exit(1);
  }

  const { validatePassword } = await import("../src/lib/auth/password");
  const invalida = validatePassword(password);
  if (invalida) {
    console.error(`✗ ${invalida}`);
    process.exit(1);
  }

  const { db } = await import("../src/db");
  const { adminUsers } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { setAdminPassword } = await import("../src/lib/auth/admin");

  const correo = email.toLowerCase().trim();
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.email, correo));
  if (!user) {
    console.error(`✗ No existe un usuario con el correo ${correo}.`);
    console.error('  Créalo primero: pnpm admin:crear <correo> "<Nombre>"');
    process.exit(1);
  }

  await setAdminPassword(user.id, password, !definitiva);
  console.log(`✓ Contraseña ${definitiva ? "definitiva" : "temporal"} fijada para ${correo}`);
  console.log(`  Entra en /admin/login con ese correo y contraseña.`);
  if (!definitiva) console.log("  Se le pedirá cambiarla en el primer ingreso.");
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
