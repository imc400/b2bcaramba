/**
 * Verifica el hashing de contraseñas y el flujo de login/cambio del panel.
 * No envía correos ni toca Shopify.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { hashPassword, verifyPassword, validatePassword } = await import("../src/lib/auth/password");

  let fallos = 0;
  const check = (ok: boolean, l: string, d = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`);
    if (!ok) fallos++;
  };

  console.log("1. Hashing scrypt");
  const hash = await hashPassword("Caramba2026");
  check(hash.startsWith("scrypt$"), "formato scrypt$salt$hash");
  check(hash !== (await hashPassword("Caramba2026")), "dos hashes de la misma clave difieren (salt)");
  check(await verifyPassword("Caramba2026", hash), "verifica la contraseña correcta");
  check(!(await verifyPassword("Caramba2027", hash)), "rechaza la contraseña incorrecta");
  check(!(await verifyPassword("Caramba2026", null)), "sin hash almacenado → false");
  check(!(await verifyPassword("x", "formato-invalido")), "formato corrupto → false, sin lanzar");

  console.log("\n2. Reglas de contraseña");
  check(validatePassword("corto1") !== null, "rechaza menos de 8 caracteres");
  check(validatePassword("sololetrasaqui") !== null, "rechaza sin números");
  check(validatePassword("12345678") !== null, "rechaza sin letras");
  check(validatePassword("Caramba2026") === null, "acepta una válida");

  console.log("\n3. Login con contraseña (contra la DB)");
  const { db } = await import("../src/db");
  const { adminUsers } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { setAdminPassword, loginWithPassword } = await import("../src/lib/auth/admin");

  const correo = "test.password@caramba.cl";
  await db.delete(adminUsers).where(eq(adminUsers.email, correo));
  const [user] = await db
    .insert(adminUsers)
    .values({ email: correo, name: "Test Password", role: "editor" })
    .returning();

  check((await loginWithPassword(correo, "loquesea123")) === null, "sin contraseña fijada no entra");
  await setAdminPassword(user.id, "Temporal2026", true);
  const u1 = await loginWithPassword(correo, "Temporal2026");
  check(u1?.id === user.id, "entra con la contraseña temporal");
  check(u1?.mustChangePassword === true, "queda marcado para cambiar contraseña");
  check((await loginWithPassword(correo, "otra")) === null, "rechaza una contraseña equivocada");
  check((await loginWithPassword("noexiste@x.cl", "x")) === null, "correo inexistente → null");

  await db.update(adminUsers).set({ active: false }).where(eq(adminUsers.id, user.id));
  check((await loginWithPassword(correo, "Temporal2026")) === null, "cuenta desactivada no entra");

  await db.delete(adminUsers).where(eq(adminUsers.id, user.id));

  console.log(fallos === 0 ? "\n✓ CONTRASEÑAS DEL PANEL OK\n" : `\n✗ ${fallos} fallos\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
