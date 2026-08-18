/**
 * Prepara Supabase Storage para las imágenes del panel (logos y banners).
 *
 *   SUPABASE_ACCESS_TOKEN=sbp_... pnpm storage:setup
 *
 * Idempotente: se puede correr las veces que haga falta.
 *   1. Obtiene la service_role key vía Management API (misma vía que
 *      migrate-supabase.ts, porque Vercel ya no deja leer sus secretos).
 *   2. Escribe SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en .env.local si
 *      faltan o están vacías (nunca pisa un valor ya definido).
 *   3. Crea el bucket público "publico" si no existe.
 *
 * El token sbp_... se genera en https://supabase.com/dashboard/account/tokens
 * y también se acepta pegado en .env.local como SUPABASE_ACCESS_TOKEN.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ENV_PATH = path.join(process.cwd(), ".env.local");
// Ref del proyecto (HANDOFF.md — Supabase sa-east-1)
const REF = process.env.SUPABASE_PROJECT_REF ?? "ypmkejirsamzylxhwxdg";
const BUCKET = "publico";

/** Parse mínimo de .env.local: KEY="valor" o KEY=valor, sin expansiones. */
function parseEnv(contenido: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const linea of contenido.split("\n")) {
    const m = linea.match(/^([A-Z0-9_]+)=("?)(.*)\2\s*$/);
    if (m) vars.set(m[1], m[3]);
  }
  return vars;
}

async function main() {
  let envLocal = "";
  try {
    envLocal = await readFile(ENV_PATH, "utf8");
  } catch {
    /* sin .env.local (CI): seguimos solo con process.env */
  }
  const enArchivo = parseEnv(envLocal);

  const token = process.env.SUPABASE_ACCESS_TOKEN || enArchivo.get("SUPABASE_ACCESS_TOKEN");
  if (!token) {
    console.error(
      "Falta SUPABASE_ACCESS_TOKEN (token sbp_... de https://supabase.com/dashboard/account/tokens).\n" +
        "Ejemplo: SUPABASE_ACCESS_TOKEN=sbp_xxx pnpm storage:setup",
    );
    process.exit(1);
  }

  const supabaseUrl = `https://${REF}.supabase.co`;

  // -- 1. service_role key vía Management API --------------------------------
  let serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || enArchivo.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `Management API respondió ${res.status} al pedir las api-keys: ` +
          (await res.text()).slice(0, 300),
      );
    }
    const keys = (await res.json()) as { name?: string; type?: string; api_key?: string }[];
    serviceKey =
      keys.find((k) => k.name === "service_role")?.api_key ??
      keys.find((k) => k.type === "secret")?.api_key ??
      "";
    if (!serviceKey) {
      throw new Error("La Management API no devolvió una service_role key para el proyecto.");
    }
    console.log("✓ service_role key obtenida vía Management API");
  } else {
    console.log("= service_role key ya presente en el entorno");
  }

  // -- 2. Persistir en .env.local (sin pisar valores existentes) -------------
  let contenido = envLocal;
  const upsertVar = (nombre: string, valor: string): boolean => {
    const vacia = new RegExp(`^${nombre}=("")?\\s*$`, "m");
    if (vacia.test(contenido)) {
      contenido = contenido.replace(vacia, `${nombre}="${valor}"`);
      return true;
    }
    if (!new RegExp(`^${nombre}=`, "m").test(contenido)) {
      if (!contenido.endsWith("\n") && contenido !== "") contenido += "\n";
      contenido += `${nombre}="${valor}"\n`;
      return true;
    }
    return false; // ya definida con valor: no tocar
  };

  const marca = "# --- Supabase Storage (logos y banners del panel) ---";
  if (!contenido.includes(marca)) {
    if (!contenido.endsWith("\n") && contenido !== "") contenido += "\n";
    contenido += `\n${marca}-----------------------\n`;
  }
  const urlNueva = upsertVar("SUPABASE_URL", supabaseUrl);
  const keyNueva = upsertVar("SUPABASE_SERVICE_ROLE_KEY", serviceKey);
  if (urlNueva || keyNueva) {
    await writeFile(ENV_PATH, contenido, "utf8");
    console.log(`✓ .env.local actualizado (${[urlNueva && "SUPABASE_URL", keyNueva && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean).join(", ")})`);
  } else {
    console.log("= .env.local ya tenía SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY");
  }

  // -- 3. Bucket público "publico" (idempotente) -----------------------------
  const crear = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true }),
  });
  if (crear.ok) {
    console.log(`✓ bucket público "${BUCKET}" creado`);
  } else {
    const cuerpo = await crear.text();
    if (crear.status === 409 || /already exists|Duplicate/i.test(cuerpo)) {
      console.log(`= bucket "${BUCKET}" ya existía`);
    } else {
      throw new Error(`No se pudo crear el bucket (${crear.status}): ${cuerpo.slice(0, 300)}`);
    }
  }

  console.log("Listo. Recuerda replicar SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
