/**
 * Aplica migraciones a Supabase usando la Management API.
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... SUPABASE_PROJECT_REF=xxx pnpm migrate:supabase
 *   ... pnpm migrate:supabase --dry     # solo muestra qué falta
 *
 * Existe porque Vercel ya no permite leer sus variables sensibles, así que no
 * tenemos a mano la contraseña de la base para `drizzle-kit migrate`. Registra
 * cada migración en `drizzle.__drizzle_migrations` con el mismo hash que usa
 * drizzle (sha256 del archivo .sql), para que ambas vías sean intercambiables.
 */
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.SUPABASE_PROJECT_REF;
const DRY = process.argv.includes("--dry");

async function sql<T = unknown>(query: string): Promise<T[]> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body) as T[];
}

async function main() {
  if (!TOKEN || !REF) {
    console.error("Faltan SUPABASE_ACCESS_TOKEN y SUPABASE_PROJECT_REF");
    process.exit(1);
  }

  await sql(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await sql(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
    id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);

  const aplicadas = new Set(
    (await sql<{ hash: string }>(`SELECT hash FROM drizzle.__drizzle_migrations`)).map((r) => r.hash),
  );

  const dir = path.join(process.cwd(), "drizzle");
  const archivos = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  let aplicadasAhora = 0;
  for (const archivo of archivos) {
    const contenido = await readFile(path.join(dir, archivo));
    const hash = createHash("sha256").update(contenido).digest("hex");
    if (aplicadas.has(hash)) {
      console.log(`  = ${archivo}`);
      continue;
    }
    if (DRY) {
      console.log(`  ~ ${archivo} (pendiente)`);
      continue;
    }

    // Los statements van uno por uno: `ALTER TYPE ... ADD VALUE` no puede
    // convivir con otras sentencias en la misma transacción.
    const statements = contenido
      .toString()
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await sql(statement);
    }
    await sql(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${hash}', ${Date.now()})`,
    );
    console.log(`  + ${archivo} aplicada`);
    aplicadasAhora++;
  }

  console.log(
    DRY ? "\n(dry run)" : `\n✓ ${aplicadasAhora} migración(es) aplicada(s) en ${REF}\n`,
  );
}

main().catch((e) => {
  console.error("\n✗", String(e?.message ?? e).slice(0, 400));
  process.exit(1);
});
