/**
 * Verifica el chequeo de salud contra la base configurada.
 * Con DATABASE_URL de producción, muestra el estado real de la plataforma.
 *
 *   pnpm exec tsx --tsconfig tsconfig.scripts.json scripts/test-health.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { generarReporteSalud } = await import("../src/lib/health");
  const reporte = await generarReporteSalud();

  const icono = { ok: "✓", aviso: "!", critico: "✗" } as const;
  console.log(`Estado general: ${icono[reporte.severidad]} ${reporte.severidad.toUpperCase()}\n`);
  for (const c of reporte.chequeos) {
    console.log(`  ${icono[c.severidad]} ${c.titulo}`);
    console.log(`    ${c.detalle}`);
    if (c.severidad !== "ok" && c.accion) console.log(`    → ${c.accion}`);
  }

  // El contrato que importa: ningún chequeo puede lanzar y todos deben responder.
  const esperados = ["reconciliacion", "webhooks", "pedidos_problema", "pedidos_estancados", "configuracion"];
  const faltantes = esperados.filter((id) => !reporte.chequeos.some((c) => c.id === id));
  if (faltantes.length > 0) {
    console.error(`\n✗ faltan chequeos: ${faltantes.join(", ")}`);
    process.exit(1);
  }
  console.log(`\n✓ ${reporte.chequeos.length} chequeos ejecutados\n`);
  process.exit(0);
}

main().catch((e) => {
  console.error("\n✗", String(e?.cause?.message ?? e?.message ?? e).slice(0, 300));
  process.exit(1);
});
