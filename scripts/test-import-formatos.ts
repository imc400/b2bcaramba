/**
 * El import debe aceptar los tres formatos que mandan las empresas: .xlsx, el
 * .xls binario antiguo (ExcelJS no lo lee; SheetJS sí) y CSV.
 *
 * Además verifica que se decida por el CONTENIDO y no por la extensión: los
 * archivos renombrados a mano son habitualísimos y antes hacían fallar una
 * importación perfectamente válida.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { db } = await import("../src/db");
  const { campaigns, collaborators, companies } = await import("../src/db/schema");
  const { eq, sql } = await import("drizzle-orm");
  const ExcelJS = (await import("exceljs")).default;
  const XLSX = await import("xlsx");
  const { importarColaboradores } = await import("../src/app/admin/colaboradores/actions");

  let fallos = 0;
  const check = (ok: boolean, l: string, d = "") => {
    console.log(`  ${ok ? "✓" : "✗"} ${l}${d ? ` — ${d}` : ""}`);
    if (!ok) fallos++;
  };

  const [empresa] = await db
    .insert(companies)
    .values({ slug: `formatos-${Date.now()}`, name: "Prueba de formatos" })
    .returning();
  const [campana] = await db
    .insert(campaigns)
    .values({
      companyId: empresa.id,
      name: "Formatos",
      status: "draft",
      bannerTitle: "Formatos",
      defaultQuota: 1,
    })
    .returning();

  const FILAS = [
    ["correo", "nombre", "cupo"],
    ["maria.gonzalez@empresa.cl", "María González", 2],
    ["pedro.soto@empresa.cl", "Pedro Soto", 1],
    ["carla.munoz@empresa.cl", "Carla Muñoz", 3],
  ];

  const importar = (buf: Buffer, nombre: string) =>
    importarColaboradores({
      campaignId: campana.id,
      file: new File([new Uint8Array(buf)], nombre),
      actorEmail: "test@caramba.cl",
    });

  const limpiar = () => db.delete(collaborators).where(eq(collaborators.campaignId, campana.id));
  const cuantos = async () => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(collaborators)
      .where(eq(collaborators.campaignId, campana.id));
    return n;
  };

  // --- .xls binario (el que no se podía importar) ---
  console.log("1. Excel antiguo (.xls binario)");
  const wbXls = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wbXls, XLSX.utils.aoa_to_sheet(FILAS), "colaboradores");
  const bufXls = XLSX.write(wbXls, { type: "buffer", bookType: "xls" }) as Buffer;
  check(bufXls[0] === 0xd0 && bufXls[1] === 0xcf, "el archivo generado ES un .xls real (firma OLE2)");
  const rXls = await importar(bufXls, "colaboradores.xls");
  check(rXls.status === "ok", "lo importa sin error", rXls.message ?? "");
  check((await cuantos()) === 3, "cargó las 3 personas", `${await cuantos()}`);

  // --- .xlsx moderno ---
  await limpiar();
  console.log("\n2. Excel moderno (.xlsx)");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("colaboradores");
  FILAS.forEach((f) => ws.addRow(f));
  const bufXlsx = Buffer.from(await wb.xlsx.writeBuffer());
  check(bufXlsx[0] === 0x50 && bufXlsx[1] === 0x4b, "el archivo generado ES un .xlsx real (firma ZIP)");
  const rXlsx = await importar(bufXlsx, "colaboradores.xlsx");
  check(rXlsx.status === "ok", "lo importa sin error", rXlsx.message ?? "");
  check((await cuantos()) === 3, "cargó las 3 personas", `${await cuantos()}`);

  // --- CSV ---
  await limpiar();
  console.log("\n3. CSV");
  const csv = FILAS.map((f) => f.join(";")).join("\n");
  const rCsv = await importar(Buffer.from(csv, "utf-8"), "colaboradores.csv");
  check(rCsv.status === "ok", "lo importa sin error", rCsv.message ?? "");
  check((await cuantos()) === 3, "cargó las 3 personas", `${await cuantos()}`);

  // --- Renombrados a mano: el caso que rompía antes ---
  await limpiar();
  console.log("\n4. Archivos renombrados a mano (se decide por el contenido)");
  const rMal1 = await importar(bufXls, "lista.xlsx"); // .xls disfrazado de .xlsx
  check(rMal1.status === "ok", "un .xls llamado .xlsx igual se importa", rMal1.message ?? "");
  check((await cuantos()) === 3, "cargó las 3 personas");

  await limpiar();
  const rMal2 = await importar(bufXlsx, "lista.xls"); // .xlsx disfrazado de .xls
  check(rMal2.status === "ok", "un .xlsx llamado .xls igual se importa", rMal2.message ?? "");
  check((await cuantos()) === 3, "cargó las 3 personas");

  // --- Basura: debe fallar con un mensaje entendible ---
  await limpiar();
  console.log("\n5. Archivo inválido");
  const rMal = await importar(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04]), "roto.xlsx");
  check(rMal.status === "error", "lo rechaza en vez de romperse");
  check(
    Boolean(rMal.message && /dañado|Excel/i.test(rMal.message)),
    "el mensaje explica el problema en lenguaje claro",
    rMal.message ?? "",
  );

  await db.delete(companies).where(eq(companies.id, empresa.id));
  console.log("\n  · campaña temporal eliminada");

  console.log(fallos === 0 ? "\n✓ FORMATOS DE IMPORT OK\n" : `\n✗ ${fallos} fallos\n`);
  process.exit(fallos === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 400));
  process.exit(1);
});
