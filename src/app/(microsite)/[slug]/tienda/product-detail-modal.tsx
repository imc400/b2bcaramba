"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui";
import type { CatalogProduct } from "@/lib/catalog";
import { productDetailAction, type ProductDetailResult } from "../actions";
import { useSelection, type SelectedItem } from "../selection";

const AGE_TAG = /^\d+-\d+\s+(años|meses)$/i;

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

/**
 * Popup de detalle: galería + descripción espejadas de Shopify (vía la server
 * action autorizada por campaña). Nunca muestra precios.
 */
export function ProductDetailModal({
  product,
  onClose,
}: {
  product: CatalogProduct;
  onClose: () => void;
}) {
  const { isSelected, toggle, quota, items } = useSelection();
  const [detail, setDetail] = useState<ProductDetailResult | null>(null);
  const [imagen, setImagen] = useState(0);
  const cerrarRef = useRef<HTMLButtonElement>(null);

  const selected = isSelected(product.variantId);
  const quotaFull = quota === 0 || (items.length >= quota && !selected);
  const ageTag = product.tags.find((t) => AGE_TAG.test(t)) ?? null;

  useEffect(() => {
    let vivo = true;
    productDetailAction(product.shopifyId).then((r) => {
      if (vivo) setDetail(r);
    });
    return () => {
      vivo = false;
    };
  }, [product.shopifyId]);

  // Bloquear el scroll del body mientras el modal está abierto + Esc + foco.
  useEffect(() => {
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cerrarRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previo;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Galería: la del detalle si ya llegó; mientras, la imagen destacada.
  const imagenes =
    detail?.ok && detail.detail.images.length > 0
      ? detail.detail.images
      : product.featuredImageUrl
        ? [{ url: product.featuredImageUrl, altText: product.title }]
        : [];
  const imagenActual = imagenes[Math.min(imagen, imagenes.length - 1)] ?? null;
  const descripcion = detail?.ok ? detail.detail.descriptionHtml : null;

  const snapshot: SelectedItem = {
    variantId: product.variantId,
    productId: product.shopifyId,
    title: product.title,
    vendor: product.vendor,
    imageUrl: product.featuredImageUrl,
    ageTag,
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={product.title}
    >
      <button
        type="button"
        aria-label="Cerrar"
        onClick={onClose}
        className="absolute inset-0 bg-caramba-grafito/45 backdrop-blur-sm animate-fade-up"
        style={{ animationDuration: "150ms" }}
      />
      <div className="relative max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl animate-fade-up sm:rounded-3xl">
        <button
          ref={cerrarRef}
          type="button"
          onClick={onClose}
          aria-label="Cerrar detalle"
          className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/90 text-caramba-grafito/70 shadow backdrop-blur transition-colors hover:text-caramba-grafito"
        >
          <X className="size-5" strokeWidth={2} />
        </button>

        <div className="grid sm:grid-cols-2">
          {/* Galería */}
          <div className="bg-caramba-crema/60 p-4 sm:p-6">
            <div className="relative aspect-square overflow-hidden rounded-2xl bg-white">
              {imagenActual ? (
                <Image
                  key={imagenActual.url}
                  src={imagenActual.url}
                  alt={imagenActual.altText ?? product.title}
                  fill
                  sizes="(max-width: 640px) 100vw, 384px"
                  className="object-contain p-4"
                />
              ) : null}
            </div>
            {imagenes.length > 1 ? (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {imagenes.map((img, i) => (
                  <button
                    key={img.url}
                    type="button"
                    onClick={() => setImagen(i)}
                    aria-label={`Imagen ${i + 1} de ${imagenes.length}`}
                    className={`relative size-16 shrink-0 overflow-hidden rounded-xl border-2 bg-white transition-colors ${
                      i === imagen ? "border-caramba-verde" : "border-transparent hover:border-caramba-grafito/20"
                    }`}
                  >
                    <Image src={img.url} alt="" fill sizes="64px" className="object-contain p-1.5" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {/* Información */}
          <div className="flex flex-col p-5 sm:p-6">
            {product.vendor ? (
              <p className="text-[11px] font-bold uppercase tracking-widest text-caramba-verde-texto">
                {product.vendor}
              </p>
            ) : null}
            <h2 className="mt-1 pr-8 font-display text-xl leading-snug text-caramba-grafito">
              {product.title}
            </h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {ageTag ? (
                <span className="rounded-full bg-caramba-amarillo-soft px-3 py-1 text-xs font-semibold text-caramba-amarillo-texto">
                  {ageTag}
                </span>
              ) : null}
              {product.productType ? (
                <span className="rounded-full bg-caramba-crema px-3 py-1 text-xs font-semibold text-caramba-grafito/70">
                  {product.productType}
                </span>
              ) : null}
            </div>

            {detail === null ? (
              <div className="mt-5 space-y-2.5" aria-hidden>
                <div className="h-3 w-full animate-pulse rounded bg-caramba-grafito/8" />
                <div className="h-3 w-11/12 animate-pulse rounded bg-caramba-grafito/8" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-caramba-grafito/8" />
              </div>
            ) : descripcion ? (
              <div
                className="mt-4 max-w-none text-sm leading-relaxed text-caramba-grafito/75 [&_b]:text-caramba-grafito [&_h1]:mt-3 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-caramba-grafito [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-caramba-grafito [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-caramba-grafito [&_li]:mt-1 [&_ol]:mt-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mt-2 [&_strong]:text-caramba-grafito [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{ __html: descripcion }}
              />
            ) : (
              <p className="mt-4 text-sm text-caramba-grafito/55">
                Este juguete no tiene descripción, pero las fotos hablan solas.
              </p>
            )}

            <div className="sticky bottom-0 mt-auto bg-white pb-1 pt-5">
              <Button
                variant={selected ? "success" : "primary"}
                className="w-full"
                onClick={() => toggle(snapshot)}
                disabled={quotaFull && !selected}
              >
                {selected ? (
                  <>
                    <CheckIcon className="size-4" />
                    Seleccionado — quitar
                  </>
                ) : quotaFull ? (
                  "Cupo completo"
                ) : (
                  "Elegir este regalo"
                )}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
