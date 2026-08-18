"use client";

import { ImagePlus, Loader2, Monitor, Smartphone, X } from "lucide-react";
import { useEffect } from "react";
import { CampaignHero } from "@/components/campaign-hero";
import { Input, Label } from "@/components/ui";

/**
 * Estudio de banner: modal a pantalla completa para diseñar el banner de la
 * campaña sin andar haciendo scroll entre controles y vista previa.
 *
 * - Izquierda: texto, imágenes por pantalla, oscurecido y posición del texto
 *   POR PANTALLA (computador y celular pueden anclar distinto).
 * - Derecha: las dos vistas previas en vivo, grandes, con el MISMO componente
 *   que pinta el microsite (variant forzada por panel).
 *
 * Es un modal y no una pestaña aparte a propósito: comparte el estado del
 * formulario, así que nada se pierde y todo se guarda junto con la empresa.
 */

export const POSICION_FILA = { top: "Arriba", center: "Centro", bottom: "Abajo" } as const;
export const POSICION_COL = { left: "izquierda", center: "centro", right: "derecha" } as const;

type ZonaImagen = {
  preview: string;
  subiendo: boolean;
  error: string | null;
  onFile: (file: File | undefined) => void;
  onQuitar: () => void;
};

export function BannerStudio({
  open,
  onClose,
  kicker,
  title,
  onTitleChange,
  subtitle,
  onSubtitleChange,
  accentColor,
  escritorio,
  celular,
  overlay,
  onOverlayChange,
  posEscritorio,
  onPosEscritorio,
  posCelular,
  onPosCelular,
}: {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  onTitleChange: (v: string) => void;
  subtitle: string;
  onSubtitleChange: (v: string) => void;
  accentColor: string;
  escritorio: ZonaImagen;
  celular: ZonaImagen;
  overlay: number;
  onOverlayChange: (v: number) => void;
  posEscritorio: string;
  onPosEscritorio: (v: string) => void;
  /** "" = seguir la posición de computador */
  posCelular: string;
  onPosCelular: (v: string) => void;
}) {
  // Cerrar con Escape y bloquear el scroll del fondo mientras está abierto
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const posCelularEfectiva = posCelular || posEscritorio;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Diseñar banner"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6"
    >
      {/* Fondo: clic afuera cierra (los cambios viven en el formulario) */}
      <button
        type="button"
        aria-label="Cerrar el estudio de banner"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-caramba-grafito/45 backdrop-blur-sm"
      />
      <div className="relative flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-3 border-b border-caramba-grafito/8 px-5 py-3.5 sm:px-7">
          <div>
            <h2 className="text-lg text-caramba-grafito">Diseñar banner</h2>
            <p className="text-xs text-caramba-grafito/55">
              Los cambios se aplican al guardar la empresa.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-10 items-center gap-2 rounded-full bg-caramba-grafito px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-caramba-grafito/85"
          >
            Listo
          </button>
        </div>

        {/* Cuerpo */}
        <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[360px_1fr] lg:overflow-hidden">
          {/* Controles */}
          <div className="space-y-5 border-caramba-grafito/8 p-5 sm:p-6 lg:overflow-y-auto lg:border-r">
            <div className="space-y-4">
              <div>
                <Label htmlFor="studioTitulo">Título</Label>
                <Input
                  id="studioTitulo"
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="studioSubtitulo">Subtítulo (opcional)</Label>
                <Input
                  id="studioSubtitulo"
                  value={subtitle}
                  onChange={(e) => onSubtitleChange(e.target.value)}
                />
              </div>
            </div>

            <ZonaDispositivo
              icono={<Monitor className="size-4" strokeWidth={2} />}
              titulo="Computador"
              medidas="2400 × 800 px (3:1)"
              aspecto="aspect-[3/1]"
              zona={escritorio}
              posicion={posEscritorio}
              onPosicion={onPosEscritorio}
            />

            <ZonaDispositivo
              icono={<Smartphone className="size-4" strokeWidth={2} />}
              titulo="Celular"
              medidas="1080 × 1080 px (cuadrada)"
              aspecto="aspect-square"
              zona={celular}
              posicion={posCelular}
              onPosicion={onPosCelular}
              seguirA={posEscritorio}
            />

            {escritorio.preview || celular.preview ? (
              <div>
                <Label htmlFor="studioOverlay">Oscurecido del fondo</Label>
                <div className="flex items-center gap-3">
                  <input
                    id="studioOverlay"
                    type="range"
                    min={0}
                    max={70}
                    step={1}
                    value={Math.round(overlay * 100)}
                    onChange={(e) => onOverlayChange(Number(e.target.value) / 100)}
                    className="w-full accent-caramba-grafito"
                  />
                  <span className="w-12 shrink-0 text-right text-sm tabular-nums text-caramba-grafito/70">
                    {Math.round(overlay * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-xs text-caramba-grafito/55">
                  Capa oscura sobre la foto para que el texto se lea bien.
                </p>
              </div>
            ) : null}

            <p className="text-xs text-caramba-grafito/55">
              JPG o PNG, máx. 4 MB cada una. Si solo subes una imagen, se usa en ambas
              pantallas. Mejor fotos limpias sin texto incrustado: el título va encima.
            </p>
          </div>

          {/* Vistas previas */}
          <div className="space-y-5 bg-caramba-crema/60 p-5 sm:p-6 lg:overflow-y-auto">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
                <Monitor className="size-3.5" strokeWidth={2.5} />
                Así se ve en computador
              </p>
              <CampaignHero
                variant="desktop"
                kicker={kicker}
                title={title || "Título del banner"}
                subtitle={subtitle || undefined}
                accentColor={accentColor}
                bannerImageUrl={escritorio.preview || null}
                bannerImageMobileUrl={celular.preview || null}
                bannerOverlay={overlay}
                bannerTextPosition={posEscritorio}
              />
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
                <Smartphone className="size-3.5" strokeWidth={2.5} />
                Así se ve en celular
              </p>
              <div className="mx-auto w-full max-w-[360px]">
                <CampaignHero
                  variant="mobile"
                  kicker={kicker}
                  title={title || "Título del banner"}
                  subtitle={subtitle || undefined}
                  accentColor={accentColor}
                  bannerImageUrl={escritorio.preview || null}
                  bannerImageMobileUrl={celular.preview || null}
                  bannerOverlay={overlay}
                  bannerTextPosition={posCelularEfectiva}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Bloque de un dispositivo: imagen + posición del texto propia. */
function ZonaDispositivo({
  icono,
  titulo,
  medidas,
  aspecto,
  zona,
  posicion,
  onPosicion,
  seguirA,
}: {
  icono: React.ReactNode;
  titulo: string;
  medidas: string;
  aspecto: string;
  zona: ZonaImagen;
  /** Para el celular, "" significa "seguir la posición de computador" */
  posicion: string;
  onPosicion: (v: string) => void;
  /** Posición del computador, para el estado "siguiendo" del celular */
  seguirA?: string;
}) {
  const esSeguidor = seguirA !== undefined;
  const efectiva = posicion || seguirA || "center-left";

  return (
    <div className="rounded-xl border border-caramba-grafito/15 p-3.5">
      <p className="flex items-center gap-1.5 text-xs font-bold text-caramba-grafito">
        {icono}
        {titulo}
        <span className="font-medium text-caramba-grafito/50">{medidas}</span>
      </p>

      {zona.preview ? (
        <div
          className={`mt-2.5 overflow-hidden rounded-lg border border-caramba-grafito/10 ${aspecto} max-h-40`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zona.preview}
            alt={`Imagen del banner (${titulo})`}
            className="h-full w-full object-cover"
          />
        </div>
      ) : null}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <label className="inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-caramba-grafito/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-caramba-grafito transition-colors hover:border-caramba-grafito/40">
          {zona.subiendo ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" strokeWidth={2} />
          )}
          {zona.preview ? "Cambiar imagen" : "Subir imagen"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            disabled={zona.subiendo}
            onChange={(e) => {
              zona.onFile(e.target.files?.[0]);
              e.target.value = ""; // permite volver a elegir el mismo archivo
            }}
          />
        </label>
        {zona.preview && !zona.subiendo ? (
          <button
            type="button"
            onClick={zona.onQuitar}
            className="inline-flex min-h-9 items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold text-caramba-grafito/60 transition-colors hover:bg-caramba-crema hover:text-caramba-grafito"
          >
            <X className="size-3.5" strokeWidth={2.5} />
            Quitar
          </button>
        ) : null}
      </div>
      {zona.error ? (
        <p className="mt-1.5 text-xs font-medium text-[#a34433]">{zona.error}</p>
      ) : null}

      <div className="mt-3">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
          Posición del texto
        </p>
        <div className="flex items-center gap-3">
          <div
            role="radiogroup"
            aria-label={`Posición del texto en ${titulo.toLowerCase()}`}
            className="grid w-fit shrink-0 grid-cols-3 gap-1 rounded-xl border border-caramba-grafito/15 bg-white p-1.5"
          >
            {(["top", "center", "bottom"] as const).flatMap((fila) =>
              (["left", "center", "right"] as const).map((col) => {
                const valor = `${fila}-${col}`;
                const activo = efectiva === valor;
                return (
                  <button
                    key={valor}
                    type="button"
                    role="radio"
                    aria-checked={activo}
                    aria-label={`${POSICION_FILA[fila]} ${POSICION_COL[col]}`}
                    title={`${POSICION_FILA[fila]} ${POSICION_COL[col]}`}
                    onClick={() => onPosicion(valor)}
                    className={`flex size-7 items-center justify-center rounded-lg transition-colors ${
                      activo ? "bg-caramba-grafito" : "hover:bg-caramba-crema"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        activo ? "bg-white" : "bg-caramba-grafito/30"
                      }`}
                    />
                  </button>
                );
              }),
            )}
          </div>
          {esSeguidor ? (
            posicion ? (
              <button
                type="button"
                onClick={() => onPosicion("")}
                className="rounded-full border border-caramba-grafito/15 px-3 py-1.5 text-[11px] font-semibold text-caramba-grafito/60 transition-colors hover:border-caramba-grafito/40 hover:text-caramba-grafito"
              >
                Igualar a computador
              </button>
            ) : (
              <p className="text-[11px] text-caramba-grafito/50">
                Siguiendo la posición de computador. Toca un punto para
                diferenciarla.
              </p>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
