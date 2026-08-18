import { accentText, BannerDecoration } from "./brand";

/**
 * Hero del microsite (banner de campaña), compartido entre el microsite real
 * y la vista previa del panel: lo que Javiera ve al editar es exactamente lo
 * que verá el colaborador.
 *
 * Dos modos visuales:
 * - Con imagen de fondo: estilo slider de Shopify — foto cover, capa de
 *   oscurecido configurable (theme.bannerOverlay), texto claro encima y
 *   posición del texto en 9 puntos (theme.bannerTextPosition). Hay una imagen
 *   de escritorio (3:1) y una opcional para celular (1:1); si falta una, la
 *   otra cubre ambos casos.
 * - Sin imagen: el estilo original, degradado del color de acento con la
 *   decoración de juguetes del Brandbook.
 *
 * `variant`: el microsite usa "responsive" (la variante la decide el ancho de
 * la pantalla, corte en sm/640px). El panel fuerza "desktop" y "mobile" para
 * que cada vista previa muestre SU variante aunque viva en una columna
 * angosta del formulario.
 *
 * Sin JS de cliente: se renderiza igual desde Server Components.
 */

export type BannerVariant = "responsive" | "desktop" | "mobile";

const VERTICAL: Record<string, string> = {
  top: "justify-start",
  center: "justify-center",
  bottom: "justify-end",
};
// Versión sm: para componer "celular abajo, computador arriba" en responsive
const VERTICAL_SM: Record<string, string> = {
  top: "sm:justify-start",
  center: "sm:justify-center",
  bottom: "sm:justify-end",
};

const HORIZONTAL: Record<string, { text: string; block: string }> = {
  left: { text: "text-left", block: "" },
  center: { text: "text-center", block: "mx-auto" },
  right: { text: "text-right", block: "ml-auto" },
};
const HORIZONTAL_SM: Record<string, { text: string; block: string }> = {
  left: { text: "sm:text-left", block: "sm:mx-0" },
  center: { text: "sm:text-center", block: "sm:mx-auto" },
  right: { text: "sm:text-right", block: "sm:ml-auto sm:mr-0" },
};

/** "fila-columna" → { fila, columna } con defaults seguros. */
function parsePosicion(pos: string | null | undefined): { fila: string; columna: string } {
  const [fila = "center", columna = "left"] = (pos ?? "center-left").split("-");
  return { fila: fila in VERTICAL ? fila : "center", columna: columna in HORIZONTAL ? columna : "left" };
}

export function CampaignHero({
  kicker,
  title,
  subtitle,
  accentColor,
  bannerImageUrl,
  bannerImageMobileUrl,
  bannerOverlay = 0.35,
  bannerTextPosition,
  bannerTextPositionMobile,
  compact = false,
  variant = "responsive",
  decorationIcon = "rocking-horse",
  className,
}: {
  /** Línea superior pequeña: "Campaña · beneficio Empresa" */
  kicker: string;
  title: string;
  subtitle?: string | null;
  accentColor: string;
  /** Imagen de escritorio (3:1). Si falta, se usa la móvil también aquí. */
  bannerImageUrl?: string | null;
  /** Imagen para celular (1:1). Si falta, se usa la de escritorio. */
  bannerImageMobileUrl?: string | null;
  /** Opacidad de la capa oscura sobre la foto, 0–0.7 */
  bannerOverlay?: number;
  /** Dónde se ancla el texto en computador; ausente = "center-left" */
  bannerTextPosition?: string | null;
  /** Ancla del texto en celular; ausente o vacío = sigue a la de computador */
  bannerTextPositionMobile?: string | null;
  /** Variante compacta (tienda) vs. portada */
  compact?: boolean;
  /** "responsive" en el microsite; el panel fuerza "desktop"/"mobile" */
  variant?: BannerVariant;
  decorationIcon?: string;
  className?: string;
}) {
  const srcDesktop = bannerImageUrl || bannerImageMobileUrl || null;
  const srcMobile = bannerImageMobileUrl || bannerImageUrl || null;
  const conImagen = Boolean(srcDesktop);
  const oscurecido = Math.min(0.7, Math.max(0, bannerOverlay));
  const textColor = conImagen ? "#ffffff" : accentText(accentColor);

  // Posición por pantalla: el celular puede anclar distinto al computador.
  const posD = parsePosicion(bannerTextPosition);
  const posM = bannerTextPositionMobile ? parsePosicion(bannerTextPositionMobile) : posD;
  let vertical: string;
  let horizontal: { text: string; block: string };
  if (variant === "desktop") {
    vertical = VERTICAL[posD.fila];
    horizontal = HORIZONTAL[posD.columna];
  } else if (variant === "mobile") {
    vertical = VERTICAL[posM.fila];
    horizontal = HORIZONTAL[posM.columna];
  } else {
    // responsive: base = celular, sm+ = computador
    vertical = `${VERTICAL[posM.fila]} ${VERTICAL_SM[posD.fila]}`;
    horizontal = {
      text: `${HORIZONTAL[posM.columna].text} ${HORIZONTAL_SM[posD.columna].text}`,
      block: `${HORIZONTAL[posM.columna].block} ${HORIZONTAL_SM[posD.columna].block}`.trim(),
    };
  }

  // Clases por variante. Alto: con foto el banner toma la proporción del arte
  // recomendado (1:1 celular, 3:1 escritorio; la tienda compacta usa franjas
  // más bajas). Sin foto conserva el alto natural del texto, como siempre.
  const MOBILE = {
    padding: compact ? "px-8 py-8" : "px-8 py-12",
    alto: compact
      ? "aspect-[4/3] max-h-[340px] min-h-[180px]"
      : "aspect-square max-h-[480px] min-h-[260px]",
    h1: compact ? "text-2xl" : "text-3xl leading-tight",
  };
  const DESKTOP = {
    padding: compact ? "px-8 py-8" : "px-12 py-12",
    alto: compact ? "min-h-[220px]" : "aspect-[3/1] min-h-[320px]",
    h1: compact ? "text-3xl" : "text-4xl leading-tight",
  };
  const RESPONSIVE = {
    padding: compact ? "px-8 py-8" : "px-8 py-12 sm:px-12",
    alto: compact
      ? "aspect-[4/3] max-h-[340px] min-h-[180px] sm:aspect-auto sm:max-h-none sm:min-h-[220px]"
      : "aspect-square max-h-[480px] min-h-[260px] sm:aspect-[3/1] sm:max-h-none sm:min-h-[320px]",
    h1: compact ? "text-2xl sm:text-3xl" : "text-3xl leading-tight sm:text-4xl",
  };
  const c = variant === "desktop" ? DESKTOP : variant === "mobile" ? MOBILE : RESPONSIVE;

  // Qué imagen(es) pintar: en responsive con dos artes distintas van ambas y
  // decide el breakpoint; en variantes forzadas (o con un solo arte) va una.
  const imagenes: { src: string; extra: string }[] = !conImagen
    ? []
    : variant === "desktop"
      ? [{ src: srcDesktop as string, extra: "" }]
      : variant === "mobile"
        ? [{ src: srcMobile as string, extra: "" }]
        : srcDesktop === srcMobile
          ? [{ src: srcDesktop as string, extra: "" }]
          : [
              { src: srcMobile as string, extra: " sm:hidden" },
              { src: srcDesktop as string, extra: " hidden sm:block" },
            ];

  return (
    <section
      className={[
        "relative flex flex-col overflow-hidden rounded-3xl",
        c.padding,
        conImagen ? c.alto : "",
        vertical,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={
        conImagen
          ? { color: textColor }
          : {
              background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
              color: textColor,
            }
      }
    >
      {imagenes.map((img) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={img.src + img.extra}
          src={img.src}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover${img.extra}`}
        />
      ))}
      {conImagen ? (
        <div aria-hidden className="absolute inset-0 bg-black" style={{ opacity: oscurecido }} />
      ) : (
        <BannerDecoration icon={decorationIcon} />
      )}
      <div
        className={`relative w-full ${horizontal.text}`}
        style={conImagen ? { textShadow: "0 1px 14px rgba(0,0,0,0.4)" } : undefined}
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">{kicker}</p>
        <h1 className={`mt-3 max-w-xl ${c.h1} ${horizontal.block}`}>{title}</h1>
        {subtitle ? (
          <p className={`mt-3 max-w-lg opacity-85 ${horizontal.block}`}>{subtitle}</p>
        ) : null}
      </div>
    </section>
  );
}
