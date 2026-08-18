"use client";

import { Loader2, Paintbrush, Plus, Search, X } from "lucide-react";
import Image from "next/image";
import { useActionState, useEffect, useMemo, useState } from "react";
import { CampaignHero } from "@/components/campaign-hero";
import { BannerStudio } from "./banner-studio";
import { Button, Card, Field, Input, Label } from "@/components/ui";
import {
  previewFilterAction,
  searchProductsAction,
  upsertCompanyAction,
  type UpsertCompanyState,
} from "./actions";
import type { CurationProduct } from "@/lib/catalog";

const ACCENTS = ["#8CBEA3", "#E1B946", "#CC644F", "#D4B1A6", "#CFCB9D"];

export type ProductRef = {
  shopifyId: number;
  title: string;
  vendor: string | null;
  featuredImageUrl: string | null;
};

export type CompanyFormInitial = {
  companyId?: string;
  campaignId?: string;
  name: string;
  slug: string;
  logoUrl: string;
  campaignName: string;
  bannerTitle: string;
  bannerSubtitle: string;
  bannerImageUrl: string;
  /** Imagen específica para celular (1:1); vacío = se reutiliza la de escritorio */
  bannerImageMobileUrl: string;
  /** Opacidad 0–0.7 de la capa oscura sobre la imagen del banner */
  bannerOverlay: number;
  /** Ancla del texto sobre el banner: "top|center|bottom-left|center|right" */
  bannerTextPosition: string;
  /** Ancla del texto en celular; "" = sigue la de computador */
  bannerTextPositionMobile: string;
  accentColor: string;
  endsAt: string;
  defaultQuota: number;
  safetyStock: number;
  priceMinClp: string;
  priceMaxClp: string;
  tags: string;
  excludedTags: string;
  includedProducts: ProductRef[];
  excludedProducts: ProductRef[];
  status: "draft" | "active" | "closed";
};

export function CompanyForm({ initial, appUrl }: { initial: CompanyFormInitial; appUrl: string }) {
  const [state, submit, submitting] = useActionState<UpsertCompanyState, FormData>(
    upsertCompanyAction,
    { status: "idle" },
  );

  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [slugTouched, setSlugTouched] = useState(Boolean(initial.slug));
  const [bannerTitle, setBannerTitle] = useState(initial.bannerTitle);
  const [bannerSubtitle, setBannerSubtitle] = useState(initial.bannerSubtitle);
  const [campaignName, setCampaignName] = useState(initial.campaignName);
  const [accent, setAccent] = useState(initial.accentColor);
  const [priceMin, setPriceMin] = useState(initial.priceMinClp);
  const [priceMax, setPriceMax] = useState(initial.priceMaxClp);
  const [tags, setTags] = useState(initial.tags);
  const [excludedTags, setExcludedTags] = useState(initial.excludedTags);
  const [safetyStock, setSafetyStock] = useState(initial.safetyStock);
  const [included, setIncluded] = useState<ProductRef[]>(initial.includedProducts);
  const [excluded, setExcluded] = useState<ProductRef[]>(initial.excludedProducts);

  // Imágenes subidas como archivo (logo y banner). El preview local (blob:)
  // aparece al tiro; la URL definitiva llega al terminar la subida y es la
  // que viaja en los hidden inputs al guardar.
  const [logoUrl, setLogoUrl] = useState(initial.logoUrl);
  const [logoPreview, setLogoPreview] = useState(initial.logoUrl);
  const [logoSubiendo, setLogoSubiendo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [bannerImageUrl, setBannerImageUrl] = useState(initial.bannerImageUrl);
  const [bannerPreview, setBannerPreview] = useState(initial.bannerImageUrl);
  const [bannerSubiendo, setBannerSubiendo] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [bannerOverlay, setBannerOverlay] = useState(initial.bannerOverlay);
  const [bannerMovilUrl, setBannerMovilUrl] = useState(initial.bannerImageMobileUrl);
  const [bannerMovilPreview, setBannerMovilPreview] = useState(initial.bannerImageMobileUrl);
  const [bannerMovilSubiendo, setBannerMovilSubiendo] = useState(false);
  const [bannerMovilError, setBannerMovilError] = useState<string | null>(null);
  const [bannerTextPosition, setBannerTextPosition] = useState(
    initial.bannerTextPosition || "center-left",
  );
  // "" = el celular sigue la posición de computador
  const [bannerMovilPos, setBannerMovilPos] = useState(initial.bannerTextPositionMobile);
  const [estudioAbierto, setEstudioAbierto] = useState(false);

  const [preview, setPreview] = useState<{
    total: number;
    sample: ProductRef[];
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<CurationProduct[]>([]);
  const [searching, setSearching] = useState(false);

  // Slug auto desde el nombre mientras no lo toquen a mano
  function handleNameChange(value: string) {
    setName(value);
    if (!slugTouched) {
      setSlug(
        value
          .toLowerCase()
          .normalize("NFD")
          .replace(/[̀-ͯ]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  }

  const toList = (raw: string) =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  // Preview en vivo de los productos que verá el colaborador (debounced)
  const filterKey = useMemo(
    () =>
      JSON.stringify({
        priceMin,
        priceMax,
        tags,
        excludedTags,
        safetyStock,
        inc: included.map((p) => p.shopifyId),
        exc: excluded.map((p) => p.shopifyId),
      }),
    [priceMin, priceMax, tags, excludedTags, safetyStock, included, excluded],
  );
  useEffect(() => {
    const t = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const result = await previewFilterAction({
          priceMinClp: priceMin ? Number(priceMin) : undefined,
          priceMaxClp: priceMax ? Number(priceMax) : undefined,
          tags: toList(tags),
          excludedTags: toList(excludedTags),
          includeProductIds: included.map((p) => p.shopifyId),
          excludeProductIds: excluded.map((p) => p.shopifyId),
          safetyStock: Number(safetyStock) || 0,
        });
        setPreview(result);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Buscador de curaduría (debounced)
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setSearchResults(await searchProductsAction(searchQuery));
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  function addIncluded(p: ProductRef) {
    if (!included.some((i) => i.shopifyId === p.shopifyId)) {
      setIncluded((prev) => [...prev, p]);
    }
    setExcluded((prev) => prev.filter((e) => e.shopifyId !== p.shopifyId));
    setSearchQuery("");
    setSearchResults([]);
  }

  function excludeProduct(p: ProductRef) {
    if (!excluded.some((e) => e.shopifyId === p.shopifyId)) {
      setExcluded((prev) => [...prev, p]);
    }
    setIncluded((prev) => prev.filter((i) => i.shopifyId !== p.shopifyId));
  }

  /** Sube el archivo a /api/admin/upload y devuelve la URL pública definitiva. */
  async function subirImagen(file: File, tipo: "logo" | "banner"): Promise<string> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("tipo", tipo);
    if (initial.companyId) fd.append("empresaId", initial.companyId);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !data?.url) {
      throw new Error(data?.error ?? "No se pudo subir la imagen. Revisa tu conexión.");
    }
    return data.url;
  }

  async function handleLogoFile(file: File | undefined) {
    if (!file) return;
    setLogoError(null);
    setLogoPreview(URL.createObjectURL(file)); // preview inmediato mientras sube
    setLogoSubiendo(true);
    try {
      setLogoUrl(await subirImagen(file, "logo"));
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
      setLogoPreview(logoUrl); // volver al logo anterior (o a ninguno)
    } finally {
      setLogoSubiendo(false);
    }
  }

  async function handleBannerFile(file: File | undefined) {
    if (!file) return;
    setBannerError(null);
    setBannerPreview(URL.createObjectURL(file)); // preview inmediato mientras sube
    setBannerSubiendo(true);
    try {
      setBannerImageUrl(await subirImagen(file, "banner"));
    } catch (e) {
      setBannerError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
      setBannerPreview(bannerImageUrl); // volver a la imagen anterior (o a ninguna)
    } finally {
      setBannerSubiendo(false);
    }
  }

  async function handleBannerMovilFile(file: File | undefined) {
    if (!file) return;
    setBannerMovilError(null);
    setBannerMovilPreview(URL.createObjectURL(file)); // preview inmediato mientras sube
    setBannerMovilSubiendo(true);
    try {
      setBannerMovilUrl(await subirImagen(file, "banner"));
    } catch (e) {
      setBannerMovilError(e instanceof Error ? e.message : "No se pudo subir la imagen.");
      setBannerMovilPreview(bannerMovilUrl); // volver a la imagen anterior (o a ninguna)
    } finally {
      setBannerMovilSubiendo(false);
    }
  }

  return (
    <>
    <form action={submit} className="grid gap-6 lg:grid-cols-[1fr_400px]">
      {initial.companyId ? <input type="hidden" name="companyId" value={initial.companyId} /> : null}
      {initial.campaignId ? (
        <input type="hidden" name="campaignId" value={initial.campaignId} />
      ) : null}
      <input type="hidden" name="accentColor" value={accent} />
      <input type="hidden" name="logoUrl" value={logoUrl} />
      <input type="hidden" name="bannerImageUrl" value={bannerImageUrl} />
      <input type="hidden" name="bannerImageMobileUrl" value={bannerMovilUrl} />
      <input type="hidden" name="bannerOverlay" value={String(bannerOverlay)} />
      <input type="hidden" name="bannerTextPosition" value={bannerTextPosition} />
      <input type="hidden" name="bannerTextPositionMobile" value={bannerMovilPos} />
      <input
        type="hidden"
        name="includeProductIds"
        value={JSON.stringify(included.map((p) => p.shopifyId))}
      />
      <input
        type="hidden"
        name="excludeProductIds"
        value={JSON.stringify(excluded.map((p) => p.shopifyId))}
      />

      {/* Columna izquierda: formulario */}
      <div className="space-y-6">
        <Card className="space-y-5 p-6">
          <h2 className="font-display text-base text-caramba-grafito">Empresa</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nombre de la empresa" htmlFor="name">
              <Input
                id="name"
                name="name"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
              />
            </Field>
            <Field label="Link de la empresa" htmlFor="slug" hint={`${appUrl}/${slug || "…"}`}>
              <Input
                id="slug"
                name="slug"
                required
                pattern="[a-z0-9-]+"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
              />
            </Field>
          </div>
          <div>
            <Label>Logo de la empresa</Label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex h-16 w-36 items-center justify-center overflow-hidden rounded-xl border border-caramba-grafito/15 bg-caramba-crema">
                {logoSubiendo ? (
                  <Loader2 className="size-5 animate-spin text-caramba-grafito/45" />
                ) : logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={logoPreview}
                    alt="Logo de la empresa"
                    className="max-h-12 w-auto max-w-32 object-contain"
                  />
                ) : (
                  <span className="text-[11px] text-caramba-grafito/40">Sin logo</span>
                )}
              </div>
              <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border border-caramba-grafito/15 bg-white px-5 py-2.5 text-sm font-semibold text-caramba-grafito transition-colors hover:border-caramba-grafito/40">
                {logoPreview ? "Cambiar logo" : "Subir logo"}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="sr-only"
                  disabled={logoSubiendo}
                  onChange={(e) => {
                    handleLogoFile(e.target.files?.[0]);
                    e.target.value = ""; // permite volver a elegir el mismo archivo
                  }}
                />
              </label>
              {logoPreview && !logoSubiendo ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogoUrl("");
                    setLogoPreview("");
                    setLogoError(null);
                  }}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold text-caramba-grafito/60 transition-colors hover:bg-caramba-crema hover:text-caramba-grafito"
                >
                  <X className="size-4" strokeWidth={2.5} />
                  Quitar
                </button>
              ) : null}
            </div>
            <p className="mt-1 text-xs text-caramba-grafito/65">
              Opcional. PNG, JPG, WebP o SVG, máx. 4 MB. Si no hay logo se muestra el nombre de la
              empresa en un chip.
            </p>
            {logoError ? <p className="mt-1 text-xs font-medium text-[#a34433]">{logoError}</p> : null}
          </div>
        </Card>

        <Card className="space-y-5 p-6">
          <h2 className="font-display text-base text-caramba-grafito">Campaña</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Nombre de la campaña" htmlFor="campaignName">
              <Input
                id="campaignName"
                name="campaignName"
                required
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
              />
            </Field>
            <Field label="Fecha límite" htmlFor="endsAt">
              <Input id="endsAt" name="endsAt" type="date" defaultValue={initial.endsAt} />
            </Field>
          </div>
          <Field label="Título del banner" htmlFor="bannerTitle">
            <Input
              id="bannerTitle"
              name="bannerTitle"
              required
              value={bannerTitle}
              onChange={(e) => setBannerTitle(e.target.value)}
            />
          </Field>
          <Field label="Subtítulo del banner (opcional)" htmlFor="bannerSubtitle">
            <Input
              id="bannerSubtitle"
              name="bannerSubtitle"
              value={bannerSubtitle}
              onChange={(e) => setBannerSubtitle(e.target.value)}
            />
          </Field>
          <div>
            <Label>Banner de la campaña</Label>
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-caramba-grafito/15 p-3">
              {bannerPreview || bannerMovilPreview ? (
                <div className="flex items-center gap-2">
                  {bannerPreview ? (
                    <div className="aspect-[3/1] w-28 overflow-hidden rounded-lg border border-caramba-grafito/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={bannerPreview} alt="Banner computador" className="h-full w-full object-cover" />
                    </div>
                  ) : null}
                  {bannerMovilPreview ? (
                    <div className="aspect-square w-10 overflow-hidden rounded-lg border border-caramba-grafito/10">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={bannerMovilPreview} alt="Banner celular" className="h-full w-full object-cover" />
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-xs text-caramba-grafito/55">
                  Sin imágenes: el banner usa el color de acento.
                </p>
              )}
              <button
                type="button"
                onClick={() => setEstudioAbierto(true)}
                className="inline-flex min-h-10 items-center gap-2 rounded-full border border-caramba-grafito/15 bg-white px-4 py-2 text-sm font-semibold text-caramba-grafito transition-colors hover:border-caramba-grafito/40"
              >
                {bannerSubiendo || bannerMovilSubiendo ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Paintbrush className="size-4" strokeWidth={2} />
                )}
                Diseñar banner
              </button>
            </div>
            <p className="mt-1 text-xs text-caramba-grafito/65">
              Imágenes, oscurecido y posición del texto se editan en el estudio, con vista
              previa de computador y celular a la vez.
            </p>
          </div>
          <div>
            <p className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
              Color de acento
            </p>
            <div className="flex gap-2">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccent(c)}
                  className={`size-8 rounded-full border-2 transition-transform ${
                    accent === c ? "scale-110 border-caramba-grafito" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  aria-label={`Acento ${c}`}
                />
              ))}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field
              label="Cupo si el Excel no trae cupo"
              htmlFor="defaultQuota"
              hint="Cada colaborador puede venir con su propio cupo en el archivo de importación; este valor se usa solo para quienes no lo traigan."
            >
              <Input
                id="defaultQuota"
                name="defaultQuota"
                type="number"
                min={1}
                max={10}
                defaultValue={initial.defaultQuota}
                required
              />
            </Field>
            <Field
              label="Stock de seguridad"
              htmlFor="safetyStock"
              hint="Un producto se oculta cuando su stock disponible llega a este número o menos: así no se ofrecen las últimas unidades, que podrían venderse en la tienda."
            >
              <Input
                id="safetyStock"
                name="safetyStock"
                type="number"
                min={0}
                max={20}
                value={safetyStock}
                onChange={(e) => setSafetyStock(Number(e.target.value))}
                required
              />
            </Field>
            <Field
              label="Estado"
              htmlFor="status"
              hint="Borrador: nadie puede entrar todavía. Activa: los colaboradores pueden entrar y pedir. Cerrada: no entra nadie nuevo ni se aceptan más pedidos (quien tenga la sesión abierta puede mirar, pero no confirmar)."
            >
              <select
                id="status"
                name="status"
                defaultValue={initial.status}
                className="w-full rounded-xl border border-caramba-grafito/15 bg-white px-4 py-2.5 text-[15px] outline-none focus:border-caramba-verde"
              >
                <option value="draft">Borrador</option>
                <option value="active">Activa</option>
                <option value="closed">Cerrada</option>
              </select>
            </Field>
          </div>
        </Card>

        <Card className="space-y-5 p-6">
          <h2 className="font-display text-base text-caramba-grafito">Filtro de catálogo</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Precio mínimo (CLP)" htmlFor="priceMinClp" hint="Oculto para el colaborador">
              <Input
                id="priceMinClp"
                name="priceMinClp"
                type="number"
                min={0}
                placeholder="9990"
                value={priceMin}
                onChange={(e) => setPriceMin(e.target.value)}
              />
            </Field>
            <Field label="Precio máximo (CLP)" htmlFor="priceMaxClp">
              <Input
                id="priceMaxClp"
                name="priceMaxClp"
                type="number"
                min={0}
                placeholder="30000"
                value={priceMax}
                onChange={(e) => setPriceMax(e.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Incluir etiquetas de Shopify (separadas por coma)"
            htmlFor="tags"
            hint='Ej: "Día del Niño, Puzzles". Vacío = todo el catálogo en el rango de precio.'
          >
            <Input
              id="tags"
              name="tags"
              placeholder="Día del Niño, recien llegados"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
          <Field
            label="Excluir etiquetas (separadas por coma)"
            htmlFor="excludedTags"
            hint='Productos con estas etiquetas NUNCA aparecen. Ej: "oferta, venta secreta".'
          >
            <Input
              id="excludedTags"
              name="excludedTags"
              placeholder="oferta, 50%"
              value={excludedTags}
              onChange={(e) => setExcludedTags(e.target.value)}
            />
          </Field>
        </Card>

        {/* Curaduría manual */}
        <Card className="space-y-5 p-6">
          <div>
            <h2 className="font-display text-base text-caramba-grafito">Curaduría manual</h2>
            <p className="mt-1 text-sm text-caramba-grafito/55">
              Agrega productos puntuales aunque no cumplan el filtro, o revisa los excluidos.
            </p>
          </div>

          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-caramba-grafito/35"
              strokeWidth={2}
            />
            <Input
              placeholder="Buscar producto por nombre o marca…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-11"
            />
            {searchQuery.trim().length >= 2 ? (
              <div className="absolute inset-x-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-2xl border border-caramba-grafito/10 bg-white shadow-lg">
                {searching ? (
                  <p className="px-4 py-3 text-sm text-caramba-grafito/50">Buscando…</p>
                ) : searchResults.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-caramba-grafito/50">
                    Sin resultados con stock para “{searchQuery}”.
                  </p>
                ) : (
                  searchResults.map((p) => (
                    <button
                      key={p.shopifyId}
                      type="button"
                      onClick={() => addIncluded(p)}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-caramba-crema"
                    >
                      <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-caramba-crema">
                        {p.featuredImageUrl ? (
                          <Image
                            src={p.featuredImageUrl}
                            alt=""
                            fill
                            sizes="40px"
                            className="object-contain p-1"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-caramba-grafito">
                          {p.title}
                        </p>
                        <p className="text-xs text-caramba-grafito/50">
                          {p.vendor} · ${p.priceClp.toLocaleString("es-CL")} · stock {p.available}
                        </p>
                      </div>
                      <Plus className="size-4 shrink-0 text-caramba-verde" strokeWidth={2.5} />
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>

          {included.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
                Agregados manualmente ({included.length})
              </p>
              <ul className="flex flex-wrap gap-2">
                {included.map((p) => (
                  <li
                    key={p.shopifyId}
                    className="flex items-center gap-2 rounded-full bg-caramba-verde-soft py-1 pl-3 pr-1.5 text-[13px] font-medium text-[#3f7a5c]"
                  >
                    <span className="max-w-52 truncate">{p.title}</span>
                    <button
                      type="button"
                      onClick={() => setIncluded((prev) => prev.filter((i) => i.shopifyId !== p.shopifyId))}
                      aria-label={`Quitar ${p.title}`}
                      className="rounded-full p-1 hover:bg-white/60"
                    >
                      <X className="size-3.5" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {excluded.length > 0 ? (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
                Excluidos puntuales ({excluded.length})
              </p>
              <ul className="flex flex-wrap gap-2">
                {excluded.map((p) => (
                  <li
                    key={p.shopifyId}
                    className="flex items-center gap-2 rounded-full bg-caramba-rojo-soft py-1 pl-3 pr-1.5 text-[13px] font-medium text-[#a34433]"
                  >
                    <span className="max-w-52 truncate line-through">{p.title}</span>
                    <button
                      type="button"
                      onClick={() => setExcluded((prev) => prev.filter((e) => e.shopifyId !== p.shopifyId))}
                      aria-label={`Restaurar ${p.title}`}
                      className="rounded-full p-1 hover:bg-white/60"
                    >
                      <X className="size-3.5" strokeWidth={2.5} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        {state.status === "error" ? (
          <p className="rounded-xl bg-caramba-rojo-soft px-4 py-3 text-sm font-medium text-[#a34433]">
            {state.message}
          </p>
        ) : null}

        {/* Bloqueado también mientras sube una imagen: guardar en ese instante
            persistiría la URL vieja y la recién subida se perdería en silencio */}
        <Button
          type="submit"
          disabled={submitting || logoSubiendo || bannerSubiendo}
          className="px-8 py-3"
        >
          {submitting
            ? "Guardando…"
            : logoSubiendo || bannerSubiendo
              ? "Subiendo imagen…"
              : "Guardar empresa y campaña"}
        </Button>
      </div>

      {/* Columna derecha: previews */}
      <div className="space-y-4">
        <p className="text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
          Vista previa del banner · computador
        </p>
        {/* El MISMO componente que pinta el microsite: la vista previa es fiel.
            variant fuerza cada variante porque esta columna es angosta. */}
        <CampaignHero
          variant="desktop"
          kicker={`${campaignName || "Campaña"} · beneficio ${name || "Empresa"}`}
          title={bannerTitle || "Título del banner"}
          subtitle={bannerSubtitle || undefined}
          accentColor={accent}
          bannerImageUrl={bannerPreview || null}
          bannerImageMobileUrl={bannerMovilPreview || null}
          bannerOverlay={bannerOverlay}
          bannerTextPosition={bannerTextPosition}
          bannerTextPositionMobile={bannerMovilPos}
        />
        <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
          Vista previa del banner · celular
        </p>
        <div className="mx-auto w-full max-w-[340px]">
          <CampaignHero
            variant="mobile"
            kicker={`${campaignName || "Campaña"} · beneficio ${name || "Empresa"}`}
            title={bannerTitle || "Título del banner"}
            subtitle={bannerSubtitle || undefined}
            accentColor={accent}
            bannerImageUrl={bannerPreview || null}
            bannerImageMobileUrl={bannerMovilPreview || null}
            bannerOverlay={bannerOverlay}
            bannerTextPosition={bannerTextPosition}
            bannerTextPositionMobile={bannerMovilPos}
          />
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
            Lo que verá el colaborador
          </p>
          <span
            className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-opacity ${
              previewLoading ? "opacity-50" : ""
            } ${
              preview && preview.total === 0
                ? "bg-caramba-rojo-soft text-[#a34433]"
                : "bg-caramba-verde-soft text-[#3f7a5c]"
            }`}
          >
            {preview === null ? "…" : `${preview.total} productos`}
          </span>
        </div>

        <div className="max-h-[560px] overflow-y-auto rounded-2xl border border-caramba-grafito/10 bg-white p-3">
          {preview && preview.sample.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {preview.sample.map((p) => {
                const isExcluded = excluded.some((e) => e.shopifyId === p.shopifyId);
                if (isExcluded) return null;
                return (
                  <div key={p.shopifyId} className="group relative">
                    <div className="relative aspect-square overflow-hidden rounded-xl bg-caramba-crema">
                      {p.featuredImageUrl ? (
                        <Image
                          src={p.featuredImageUrl}
                          alt={p.title}
                          fill
                          sizes="120px"
                          className="object-contain p-1.5"
                        />
                      ) : null}
                      <button
                        type="button"
                        onClick={() => excludeProduct(p)}
                        title={`Excluir "${p.title}" del catálogo`}
                        className="absolute right-1.5 top-1.5 hidden size-6 items-center justify-center rounded-full bg-white/90 text-caramba-grafito shadow group-hover:flex hover:bg-caramba-rojo hover:text-white"
                      >
                        <X className="size-3.5" strokeWidth={2.5} />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-tight text-caramba-grafito/70">
                      {p.title}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : preview && preview.total === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-caramba-grafito/50">
              Ningún producto cumple el filtro. Amplía el rango de precio o revisa las etiquetas.
            </p>
          ) : (
            <p className="px-4 py-10 text-center text-sm text-caramba-grafito/40">
              Calculando catálogo…
            </p>
          )}
          {preview && preview.total > preview.sample.length ? (
            <p className="mt-3 pb-1 text-center text-xs text-caramba-grafito/45">
              Mostrando {preview.sample.length} de {preview.total} — pasa el mouse sobre un producto
              para excluirlo
            </p>
          ) : null}
        </div>

        <p className="pt-1 text-[11px] font-bold uppercase tracking-wider text-caramba-grafito/50">
          Link generado
        </p>
        <div className="flex items-center justify-between rounded-xl border border-caramba-grafito/10 bg-white px-4 py-3">
          <code className="truncate text-sm text-caramba-grafito/75">
            {appUrl}/{slug || "…"}
          </code>
        </div>
      </div>
    </form>
    <BannerStudio
      open={estudioAbierto}
      onClose={() => setEstudioAbierto(false)}
      kicker={`${campaignName || "Campaña"} · beneficio ${name || "Empresa"}`}
      title={bannerTitle}
      onTitleChange={setBannerTitle}
      subtitle={bannerSubtitle}
      onSubtitleChange={setBannerSubtitle}
      accentColor={accent}
      escritorio={{
        preview: bannerPreview,
        subiendo: bannerSubiendo,
        error: bannerError,
        onFile: handleBannerFile,
        onQuitar: () => {
          setBannerImageUrl("");
          setBannerPreview("");
          setBannerError(null);
        },
      }}
      celular={{
        preview: bannerMovilPreview,
        subiendo: bannerMovilSubiendo,
        error: bannerMovilError,
        onFile: handleBannerMovilFile,
        onQuitar: () => {
          setBannerMovilUrl("");
          setBannerMovilPreview("");
          setBannerMovilError(null);
        },
      }}
      overlay={bannerOverlay}
      onOverlayChange={setBannerOverlay}
      posEscritorio={bannerTextPosition}
      onPosEscritorio={setBannerTextPosition}
      posCelular={bannerMovilPos}
      onPosCelular={setBannerMovilPos}
    />
    </>
  );
}
