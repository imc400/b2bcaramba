"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { softTone } from "@/components/brand";
import { Button } from "@/components/ui";
import type { CatalogProduct } from "@/lib/catalog";
import { useSelection, type SelectedItem } from "../selection";

const AGE_TAG = /^\d+-\d+\s+(años|meses)$/i;

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function ProductGrid({ items }: { items: CatalogProduct[] }) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((p, i) => (
        <ProductCard key={p.shopifyId} product={p} index={i} />
      ))}
    </div>
  );
}

function ProductCard({ product, index }: { product: CatalogProduct; index: number }) {
  const { isSelected, toggle, quota, items } = useSelection();
  const [flash, setFlash] = useState<"quota_full" | null>(null);
  const selected = isSelected(product.variantId);
  const quotaFull = quota === 0 || (items.length >= quota && !selected);
  const ageTag = product.tags.find((t) => AGE_TAG.test(t)) ?? null;

  const snapshot: SelectedItem = {
    variantId: product.variantId,
    productId: product.shopifyId,
    title: product.title,
    vendor: product.vendor,
    imageUrl: product.featuredImageUrl,
    ageTag,
  };

  function onToggle() {
    const result = toggle(snapshot);
    if (result === "quota_full") {
      setFlash("quota_full");
      setTimeout(() => setFlash(null), 2200);
    }
  }

  return (
    <article
      className={`group flex flex-col overflow-hidden rounded-2xl border transition-all animate-fade-up ${
        selected
          ? "border-caramba-verde ring-2 ring-caramba-verde/40"
          : "border-caramba-grafito/8 hover:-translate-y-1 hover:border-caramba-grafito/20 hover:shadow-lg"
      }`}
      style={{ animationDelay: `${Math.min(index, 11) * 45}ms` }}
    >
      <div className={`relative aspect-square ${softTone(index)}`}>
        {product.featuredImageUrl ? (
          <Image
            src={product.featuredImageUrl}
            alt={product.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-contain p-4 transition-transform duration-500 ease-out group-hover:scale-[1.04]"
          />
        ) : null}
        {ageTag ? (
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-caramba-grafito/70 backdrop-blur">
            {ageTag}
          </span>
        ) : null}
        {selected ? (
          <span className="absolute right-2.5 top-2.5 flex size-7 animate-pop-in items-center justify-center rounded-full bg-caramba-verde text-white shadow">
            <CheckIcon className="size-4" />
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 bg-white p-3.5">
        {product.vendor ? (
          <p className="text-[11px] font-bold uppercase tracking-widest text-caramba-verde-texto">
            {product.vendor}
          </p>
        ) : null}
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-caramba-grafito">
          {product.title}
        </h3>
        <div className="mt-auto pt-2.5">
          <Button
            variant={selected ? "success" : "secondary"}
            className="w-full py-2 text-[13px]"
            onClick={onToggle}
            disabled={quotaFull && !selected}
          >
            {selected ? (
              <>
                <CheckIcon className="size-3.5" />
                Seleccionado
              </>
            ) : quotaFull ? (
              "Cupo completo"
            ) : (
              "Seleccionar"
            )}
          </Button>
          <p aria-live="polite" className="min-h-0">
            {flash === "quota_full" ? (
              <span className="mt-1.5 block text-center text-[11px] font-medium text-caramba-rojo-texto">
                Ya elegiste tus {quota} regalos. Quita uno si quieres cambiar.
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </article>
  );
}

/** Barra inferior fija: progreso del cupo + continuar. */
export function SelectionBar({ slug }: { slug: string }) {
  const { items, quota } = useSelection();
  const router = useRouter();
  const complete = quota > 0 && items.length === quota;

  if (quota === 0) {
    return (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-caramba-verde/30 bg-caramba-verde-soft/95 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
        <p className="flex items-center justify-center gap-2 px-4 text-center text-sm font-semibold text-caramba-verde-texto">
          <CheckIcon className="size-4 shrink-0" />
          Ya elegiste todos tus regalos. Te avisaremos por correo cuando tu pedido vaya en camino.
        </p>
      </div>
    );
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-caramba-grafito/10 bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_-8px_rgba(40,40,40,0.12)] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            {Array.from({ length: quota }).map((_, i) => (
              <span
                key={i}
                className={`size-2.5 rounded-full transition-all duration-300 ${
                  i < items.length ? "scale-110 bg-caramba-verde" : "bg-caramba-grafito/15"
                }`}
              />
            ))}
          </div>
          <p className="text-sm font-medium text-caramba-grafito/70">
            {complete ? (
              <span className="font-semibold text-caramba-verde-texto">
                ¡Listo! Elegiste todos tus regalos
              </span>
            ) : (
              <>
                <b className="text-caramba-grafito">{items.length}</b> de {quota} elegido
                {quota === 1 ? "" : "s"}
              </>
            )}
          </p>
        </div>
        <Button onClick={() => router.push(`/${slug}/carrito`)} disabled={items.length === 0}>
          {items.length > 0 ? "Elegir dónde recibirlo →" : "Continuar →"}
        </Button>
      </div>
    </div>
  );
}
