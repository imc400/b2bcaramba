/**
 * Prueba de escala del import de colaboradores: 2.000 filas, como una campaña
 * real de Entel. Antes el import hacía 2 consultas por fila (4.000 viajes a
 * Supabase) y moría por timeout; esto verifica que ahora sea por lotes.
 *
 *   pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/test-import-escala.ts
 *
 * Crea una campaña temporal y la borra al final.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const N = 2000;

async function main() {
  const { db } = await import("../src/db");
  const { campaigns, collaborators, companies } = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const ExcelJS = (await import("exceljs")).default;

  let fallos = 0;
  const check = (ok: boolean, l: string, d = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`);
    if (!ok) fallos++;
  };

  // --- Campaña temporal ---
  const [empresa] = await db
    .insert(companies)
    .values({ slug: `escala-${Date.now()}`, name: "Prueba de escala" })
    .returning();
  const [campana] = await db
    .insert(campaigns)
    .values({
      companyId: empresa.id,
      name: "Escala",
      status: "draft",
      bannerTitle: "Escala",
      defaultQuota: 1,
    })
    .returning();

  // --- Excel de N filas ---
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("colaboradores");
  ws.addRow(["correo", "nombre", "cupo"]);
  for (let i = 0; i < N; i++) ws.addRow([`persona${i}@escala.test`, `Persona ${i}`, 2]);
  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  console.log(`Excel generado: ${N} filas (${Math.round(buffer.length / 1024)} KB)\n`);

  const { importarColaboradores } = await import("../src/app/admin/colaboradores/actions");

  const archivo = () =>
    new File([new Uint8Array(buffer)], "escala.xlsx");
  const importar = (f: File) =>
    importarColaboradores({ campaignId: campana.id, file: f, actorEmail: "test@caramba.cl" });

  console.log("1. Import inicial (2.000 nuevos)");
  const t0 = Date.now();
  const r1 = await importar(archivo());
  const ms1 = Date.now() - t0;
  check(r1.status === "ok", "el import termina sin error", r1.message ?? "");
  check(r1.imported === N, `importa las ${N} filas`, `${r1.imported}`);
  console.log(`    tiempo: ${(ms1 / 1000).toFixed(1)} s`);
  check(ms1 < 30_000, "termina en menos de 30 s (antes: timeout)", `${(ms1 / 1000).toFixed(1)} s`);

  const [{ n: total }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collaborators)
    .where(eq(collaborators.campaignId, campana.id));
  check(total === N, `quedaron ${N} colaboradores en la base`, `${total}`);

  console.log("\n2. Re-import (2.000 actualizaciones, sin duplicar)");
  const t1 = Date.now();
  const r2 = await importar(archivo());
  const ms2 = Date.now() - t1;
  check(r2.updated === N, `actualiza las ${N} sin crear nuevas`, `${r2.updated} act. / ${r2.imported} nuevas`);
  console.log(`    tiempo: ${(ms2 / 1000).toFixed(1)} s`);

  const [{ n: total2 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(collaborators)
    .where(eq(collaborators.campaignId, campana.id));
  check(total2 === N, "no se duplicó nadie", `${total2}`);

  console.log("\n3. Duplicados dentro del propio archivo");
  const wb2 = new ExcelJS.Workbook();
  const ws2 = wb2.addWorksheet("c");
  ws2.addRow(["correo", "nombre", "cupo"]);
  ws2.addRow(["repetido@escala.test", "Primera", 1]);
  ws2.addRow(["repetido@escala.test", "Segunda", 3]);
  const buf2 = Buffer.from(await wb2.xlsx.writeBuffer());
  await importar(new File([new Uint8Array(buf2)], "dup.xlsx"));
  const repetidos = await db
    .select({ name: collaborators.name, quota: collaborators.quota })
    .from(collaborators)
    .where(eq(collaborators.email, "repetido@escala.test"));
  check(repetidos.length === 1, "el correo repetido entra una sola vez", `${repetidos.length} fila(s)`);
  check(repetidos[0]?.name === "Segunda", "gana la última fila del archivo", repetidos[0]?.name ?? "");

  // --- Limpieza ---
  await db.delete(companies).where(eq(companies.id, empresa.id));
  console.log("\n  · campaña temporal eliminada");

  console.log(fallos === 0 ? "\n✓ IMPORT A ESCALA OK\n" : `\n✗ ${fallos} fallos\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
