"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { ToyIcon } from "@/components/brand";
import { Button, Card, Field, Input } from "@/components/ui";
import { submitOrderAction, type SubmitOrderState } from "../actions";
import { useSelection } from "../selection";

export function CartView({
  slug,
  collaboratorName,
  campaignId,
}: {
  slug: string;
  collaboratorName: string;
  campaignId: string;
}) {
  const { items, quota, remove, clear } = useSelection();
  const router = useRouter();
  const [state, submit, submitting] = useActionState<SubmitOrderState, FormData>(
    submitOrderAction,
    { status: "idle" },
  );

  useEffect(() => {
    if (state.status === "ok") {
      clear();
      localStorage.removeItem(`caramba-sel-${campaignId}`);
      router.push(`/${slug}/listo?code=${state.code}`);
      // Re-render del layout (badge de cupo): los layouts no se re-renderizan
      // en navegación soft del App Router
      router.refresh();
    }
  }, [state, router, slug, clear, campaignId]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-24 sm:px-6">
      <div className="mt-8 flex items-center justify-between">
        <h1 className="font-display text-2xl text-caramba-grafito">Tu selección</h1>
        <span className="rounded-full bg-caramba-verde-soft px-3.5 py-1.5 text-sm font-semibold text-[#3f7a5c]">
          {items.length} de {quota} elegido{quota === 1 ? "" : "s"}
        </span>
      </div>

      {items.length === 0 ? (
        <Card className="mt-6 p-10 text-center">
          <ToyIcon name="sand-bucket" className="mx-auto mb-3 size-14 opacity-40" />
          <p className="text-caramba-grafito/70">Aún no eliges ningún regalo.</p>
          <Link
            href={`/${slug}/tienda`}
            className="mt-3 inline-block font-semibold text-caramba-rojo hover:underline"
          >
            ← Volver al catálogo
          </Link>
        </Card>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {items.map((item) => (
              <Card key={item.variantId} className="flex items-center gap-4 p-3.5">
                <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-caramba-crema">
                  {item.imageUrl ? (
                    <Image
                      src={item.imageUrl}
                      alt={item.title}
                      fill
                      sizes="64px"
                      className="object-contain p-1.5"
                    />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  {item.vendor ? (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-caramba-verde">
                      {item.vendor}
                      {item.ageTag ? ` · ${item.ageTag}` : ""}
                    </p>
                  ) : null}
                  <p className="truncate text-sm font-semibold text-caramba-grafito">{item.title}</p>
                </div>
                <button
                  onClick={() => remove(item.variantId)}
                  className="shrink-0 text-sm font-medium text-caramba-grafito/45 hover:text-caramba-rojo"
                >
                  Quitar
                </button>
              </Card>
            ))}
          </div>

          {items.length < quota ? (
            <Link
              href={`/${slug}/tienda`}
              className="mt-3 inline-block text-sm font-semibold text-caramba-rojo hover:underline"
            >
              + Agregar otro regalo ({quota - items.length} disponible{quota - items.length === 1 ? "" : "s"})
            </Link>
          ) : null}

          <form action={submit} className="mt-8">
            <input
              type="hidden"
              name="variantIds"
              value={JSON.stringify(items.map((i) => i.variantId))}
            />
            <Card className="space-y-5 p-6 sm:p-8">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-caramba-verde-texto">
                  Último paso
                </p>
                <h2 className="mt-1 font-display text-lg text-caramba-grafito">
                  ¿Dónde te llevamos tu regalo{items.length === 1 ? "" : "s"}?
                </h2>
                <p className="mt-1 text-sm text-caramba-grafito/70">
                  Puede ser tu casa, tu oficina o donde te acomode.
                </p>
              </div>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Nombre de quien recibe" htmlFor="recipientName">
                  <Input
                    id="recipientName"
                    name="recipientName"
                    defaultValue={collaboratorName}
                    autoComplete="name"
                    required
                    minLength={3}
                  />
                </Field>
                <Field label="Teléfono" htmlFor="phone">
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="+56 9 1234 5678"
                    autoComplete="tel"
                    required
                    minLength={8}
                  />
                </Field>
                <Field label="Dirección" htmlFor="addressLine">
                  <Input
                    id="addressLine"
                    name="addressLine"
                    placeholder="Calle, número, depto/casa"
                    autoComplete="street-address"
                    required
                    minLength={5}
                  />
                </Field>
                <Field label="Comuna" htmlFor="comuna">
                  <Input
                    id="comuna"
                    name="comuna"
                    placeholder="Las Condes"
                    autoComplete="address-level3"
                    required
                    minLength={2}
                  />
                </Field>
              </div>
              <Field label="Indicaciones para la entrega (opcional)" htmlFor="addressNotes">
                <Input id="addressNotes" name="addressNotes" placeholder="Ej: dejar en conserjería" />
              </Field>

              <p className="rounded-xl bg-caramba-amarillo-soft px-4 py-2.5 text-xs font-medium text-caramba-amarillo-texto">
                Revisa tu selección antes de enviar: una vez confirmado no podrás cambiarla.
              </p>

              {state.status === "error" ? (
                <p role="alert" className="rounded-xl bg-caramba-rojo-soft px-4 py-3 text-sm font-medium text-caramba-rojo-texto">
                  {state.message}
                </p>
              ) : null}

              <Button
                type="submit"
                className="w-full py-3.5 text-base"
                disabled={submitting}
                aria-busy={submitting}
              >
                {submitting ? (
                  <>
                    <span
                      aria-hidden
                      className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                    />
                    Enviando pedido
                  </>
                ) : (
                  `Confirmar mi${items.length === 1 ? " regalo" : "s regalos"} →`
                )}
              </Button>
              <p className="rounded-xl bg-caramba-verde-soft px-4 py-2.5 text-center text-xs font-medium text-caramba-verde-texto">
                No pagas nada: este regalo es un beneficio de tu empresa.
              </p>
            </Card>
          </form>
        </>
      )}
    </main>
  );
}
