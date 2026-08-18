import Image from "next/image";
import { cn } from "./ui";

/** Logo Caramba oficial (solo blanco o grafito, según el Brandbook). */
export function CarambaLogo({
  color = "grafito",
  withTagline = true,
  className,
}: {
  color?: "grafito" | "blanco";
  withTagline?: boolean;
  className?: string;
}) {
  const src =
    color === "blanco" ? "/brand/caramba-tagline-blanco.svg" : "/brand/caramba-tagline-grafito.svg";
  return (
    <Image
      src={src}
      alt="Caramba — la vida es para jugar"
      width={140}
      height={48}
      className={cn(withTagline ? "" : "", className)}
      priority
    />
  );
}

/** Cabecera co-branded: [logo empresa] × [Caramba] */
export function CoBrandHeader({
  companyName,
  companyLogoUrl,
  right,
}: {
  companyName: string;
  companyLogoUrl: string | null;
  right?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-caramba-grafito/8 bg-white/90 backdrop-blur">
      {/* min-w-0 + shrink-0 calculados: en celular los logos se achican y el
          lado izquierdo cede espacio, para que el chip de cupo y "Salir"
          nunca se monten encima de las marcas. */}
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4 sm:gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3">
          {companyLogoUrl ? (
            // Logo subido por Javiera en el panel
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={companyLogoUrl}
              alt={companyName}
              className="h-6 w-auto max-w-20 object-contain sm:h-8 sm:max-w-28"
            />
          ) : (
            <span className="min-w-16 max-w-28 shrink-0 truncate rounded-lg bg-caramba-grafito px-2.5 py-1 text-sm font-bold lowercase text-white sm:max-w-none">
              {companyName}
            </span>
          )}
          <span className="shrink-0 text-caramba-grafito/25">×</span>
          <CarambaLogo className="h-7 w-auto shrink-0 sm:h-9" />
        </div>
        <div className="shrink-0">{right}</div>
      </div>
    </header>
  );
}

/** Iconos de juguetes del Brandbook, para acentos lúdicos. */
export function ToyIcon({ name, className }: { name: string; className?: string }) {
  return (
    <Image
      src={`/brand/icons/${name}.svg`}
      alt=""
      aria-hidden
      width={48}
      height={48}
      className={className}
    />
  );
}

const toneByIndex = [
  "bg-caramba-verde-soft",
  "bg-caramba-amarillo-soft",
  "bg-caramba-rosa-soft",
  "bg-caramba-oliva-soft",
] as const;

/** Fondo suave rotatorio para cards de producto (universo visual Caramba). */
export function softTone(i: number): string {
  return toneByIndex[i % toneByIndex.length];
}

/**
 * Color de texto legible sobre un acento de campaña (luminancia YIQ):
 * acentos claros (amarillo, oliva) → grafito; oscuros → blanco.
 */
export function accentText(hex: string): string {
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq > 150 ? "#282828" : "#ffffff";
}

/** Decoración de banner: círculos suaves + icono de juguete del Brandbook. */
export function BannerDecoration({ icon = "rocking-horse" }: { icon?: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -right-16 -top-20 size-56 rounded-full bg-white/10" />
      <div className="absolute -bottom-24 right-32 size-44 rounded-full bg-white/[0.07]" />
      <ToyIcon
        name={icon}
        className="absolute right-8 top-1/2 hidden size-32 -translate-y-1/2 rotate-6 opacity-20 brightness-0 invert sm:block"
      />
    </div>
  );
}
