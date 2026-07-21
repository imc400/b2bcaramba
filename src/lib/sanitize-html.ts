import "server-only";

/**
 * Sanitiza el descriptionHtml que llega de Shopify antes de renderizarlo en el
 * microsite. Política estricta de allowlist, sin dependencias:
 * - Solo sobreviven tags de texto (p, br, listas, énfasis, títulos).
 * - Se eliminan TODOS los atributos (fuera onload/onclick/href/style).
 * - script/style/iframe/svg caen con su contenido completo.
 * Aunque el contenido lo escribe la propia juguetería en su Shopify, un panel
 * comprometido o un copy-paste descuidado no debe poder inyectar nada aquí.
 */
const ALLOWED_TAGS = new Set([
  "p", "br", "ul", "ol", "li", "strong", "b", "em", "i", "u",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
]);

/** Estos se eliminan CON su contenido (no basta con quitar el tag). */
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|svg|noscript|template|form)\b[\s\S]*?<\/\1\s*>/gi;

export function sanitizeProductHtml(html: string | null): string {
  if (!html) return "";
  let out = html.replace(DROP_WITH_CONTENT, "");
  // Comentarios HTML (pueden esconder condicionales de IE/markup raro)
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  // Cada tag restante: se normaliza sin atributos si está permitido; si no, se
  // elimina el tag conservando su texto interior.
  out = out.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (_m, slash: string, name: string) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    if (tag === "br") return "<br />";
    return `<${slash}${tag}>`;
  });
  return out.trim();
}
