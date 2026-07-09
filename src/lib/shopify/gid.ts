/** Extrae el ID numérico de un GID de Shopify (gid://shopify/Product/123 → 123). */
export function numericId(gid: string): number {
  const id = Number(gid.split("/").pop());
  if (!Number.isFinite(id)) throw new Error(`GID inválido: ${gid}`);
  return id;
}
