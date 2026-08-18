import "server-only";

/**
 * Almacenamiento de archivos públicos (logos y banners) en Supabase Storage.
 *
 * Sin SDK a propósito: la Storage API es HTTP simple y el proyecto ya habla
 * fetch con Shopify y con la Management API. Los archivos viven en el bucket
 * público "publico", creado por `pnpm storage:setup` (scripts/setup-storage.ts).
 */

const BUCKET = "publico";

function config(): { url: string; serviceKey: string } {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el entorno. " +
        "Corre `pnpm storage:setup` o defínelas en .env.local.",
    );
  }
  return { url: url.replace(/\/+$/, ""), serviceKey };
}

/**
 * Sube un archivo al bucket público y devuelve su URL pública.
 *
 * `ruta` es relativa al bucket, p. ej. "empresas/<id>/logo-1712345.png".
 * Con `x-upsert: true` re-subir la misma ruta no falla (idempotente).
 */
export async function subirArchivoPublico(
  buffer: Uint8Array,
  ruta: string,
  contentType: string,
): Promise<string> {
  const { url, serviceKey } = config();
  const rutaLimpia = ruta.replace(/^\/+/, "");

  const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${rutaLimpia}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer as unknown as BodyInit,
  });

  if (!res.ok) {
    const detalle = (await res.text()).slice(0, 300);
    throw new Error(`Supabase Storage respondió ${res.status}: ${detalle}`);
  }

  return `${url}/storage/v1/object/public/${BUCKET}/${rutaLimpia}`;
}
