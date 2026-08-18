import { accentText, BannerDecoration } from "./brand";

/**
 * Hero del microsite (banner de campaña), compartido entre el microsite real
 * y la vista previa del panel: lo que Javiera ve al editar es exactamente lo
 * que verá el colaborador.
 *
 * Dos modos:
 * - Con imagen de fondo: estilo slider de Shopify — foto cover centrada, capa
 *   de oscurecido configurable (theme.bannerOverlay) y texto claro encima.
 * - Sin imagen: el estilo original, degradado del color de acento con la
 *   decoración de juguetes del Brandbook.
 *
 * Sin JS de cliente: se renderiza igual desde Server Components.
 */
export function CampaignHero({
  kicker,
  title,
  subtitle,
  accentColor,
  bannerImageUrl,
  bannerOverlay = 0.35,
  compact = false,
  decorationIcon = "rocking-horse",
  className,
}: {
  /** Línea superior pequeña: "Campaña · beneficio Empresa" */
  kicker: string;
  title: string;
  subtitle?: string | null;
  accentColor: string;
  bannerImageUrl?: string | null;
  /** Opacidad de la capa oscura sobre la foto, 0–0.7 */
  bannerOverlay?: number;
  /** Variante compacta (tienda) vs. portada */
  compact?: boolean;
  decorationIcon?: string;
  className?: string;
}) {
  const conImagen = Boolean(bannerImageUrl);
  const oscurecido = Math.min(0.7, Math.max(0, bannerOverlay));
  const textColor = conImagen ? "#ffffff" : accentText(accentColor);

  const padding = compact ? "px-8 py-8" : "px-8 py-12 sm:px-12";
  // Con foto, el banner necesita alto propio (la foto debe respirar);
  // sin foto conserva exactamente el alto natural del texto, como siempre.
  const alto = conImagen
    ? compact
      ? "flex min-h-[180px] flex-col justify-center sm:min-h-[220px]"
      : "flex min-h-[260px] flex-col justify-center sm:min-h-[320px]"
    : "";

  return (
    <section
      className={["relative overflow-hidden rounded-3xl", padding, alto, className]
        .filter(Boolean)
        .join(" ")}
      style={
        conImagen
          ? {
              backgroundImage: `url("${(bannerImageUrl as string).replace(/"/g, "%22")}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              color: textColor,
            }
          : {
              background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}cc 100%)`,
              color: textColor,
            }
      }
    >
      {conImagen ? (
        <div aria-hidden className="absolute inset-0 bg-black" style={{ opacity: oscurecido }} />
      ) : (
        <BannerDecoration icon={decorationIcon} />
      )}
      <div
        className="relative"
        style={conImagen ? { textShadow: "0 1px 14px rgba(0,0,0,0.4)" } : undefined}
      >
        <p className="text-xs font-bold uppercase tracking-[0.2em] opacity-80">{kicker}</p>
        <h1
          className={
            compact ? "mt-2 text-2xl sm:text-3xl" : "mt-3 max-w-xl text-3xl leading-tight sm:text-4xl"
          }
        >
          {title}
        </h1>
        {subtitle ? <p className="mt-3 max-w-lg opacity-85">{subtitle}</p> : null}
      </div>
    </section>
  );
}
