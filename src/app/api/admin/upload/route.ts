import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "@/lib/auth/admin";
import { subirArchivoPublico } from "@/lib/storage";

/**
 * Subida de imágenes desde el panel (logo de empresa, banner de campaña).
 *
 * Route Handler y no Server Action a propósito: las actions tienen un límite
 * de body de 1 MB por defecto y estos archivos lo superan. Ojo que en Vercel
 * el body de una función está topado en 4.5 MB a nivel de plataforma.
 *
 * El formato se valida por MAGIC BYTES y no por extensión ni content-type
 * (misma convención que el import de colaboradores): el nombre del archivo
 * lo controla quien sube.
 */

type Tipo = "logo" | "banner";

// Banner topado en 4 MB: la plataforma de Vercel rechaza bodies >4.5 MB, y un
// límite mayor pasaría en local pero fallaría en producción con un 413 opaco.
const LIMITE_MB: Record<Tipo, number> = { logo: 4, banner: 4 };

type Formato = { ext: string; contentType: string };

/** Detecta el formato real del archivo mirando sus primeros bytes. */
function detectarFormato(bytes: Uint8Array, tipo: Tipo): Formato | null {
  if (bytes.length < 12) return null;
  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { ext: "png", contentType: "image/png" };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" };
  }
  // WebP: "RIFF" <tamaño> "WEBP"
  const ascii = (desde: number, texto: string) =>
    texto.split("").every((c, i) => bytes[desde + i] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WEBP")) {
    return { ext: "webp", contentType: "image/webp" };
  }
  // SVG, solo para logos: texto que empieza con "<?xml" o "<svg" (tras BOM/espacios)
  if (tipo === "logo") {
    const inicio = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.slice(0, 256))
      .replace(/^\uFEFF/, "")
      .trimStart()
      .toLowerCase();
    if (inicio.startsWith("<?xml") || inicio.startsWith("<svg")) {
      return { ext: "svg", contentType: "image/svg+xml" };
    }
  }
  return null;
}

export async function POST(request: Request) {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json(
      { error: "Tu sesión expiró. Vuelve a iniciar sesión en el panel." },
      { status: 401 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }

  const file = form.get("file");
  const tipo = form.get("tipo");
  const empresaId = form.get("empresaId");

  if (tipo !== "logo" && tipo !== "banner") {
    return NextResponse.json({ error: "Tipo de imagen desconocido." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No se recibió ningún archivo." }, { status: 400 });
  }

  const limiteMb = LIMITE_MB[tipo];
  if (file.size > limiteMb * 1024 * 1024) {
    const pesoMb = (file.size / 1024 / 1024).toFixed(1);
    return NextResponse.json(
      {
        error: `La imagen pesa ${pesoMb} MB y el máximo es ${limiteMb} MB. Comprímela o usa una más liviana.`,
      },
      { status: 413 },
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const formato = detectarFormato(bytes, tipo);
  if (!formato) {
    return NextResponse.json(
      {
        error:
          tipo === "logo"
            ? "Formato no reconocido. El logo puede ser PNG, JPG, WebP o SVG."
            : "Formato no reconocido. El banner puede ser PNG, JPG o WebP.",
      },
      { status: 415 },
    );
  }

  // Carpeta por empresa; "nuevo" mientras la empresa aún no se guarda
  const carpeta =
    typeof empresaId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(empresaId) ? empresaId : "nuevo";
  const ruta = `empresas/${carpeta}/${tipo}-${Date.now()}.${formato.ext}`;

  try {
    const url = await subirArchivoPublico(bytes, ruta, formato.contentType);
    return NextResponse.json({ url });
  } catch (e) {
    console.error("[admin/upload]", e);
    return NextResponse.json(
      { error: "No se pudo guardar la imagen. Inténtalo de nuevo en unos segundos." },
      { status: 500 },
    );
  }
}
