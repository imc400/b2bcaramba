/**
 * RUT chileno: normalización y validación (Módulo 11).
 * Formato canónico interno: sin puntos, con guión, DV en minúscula: "12345678-5"
 * OJO: el RUT identifica, NUNCA autentica (es enumerable y semi-público).
 */

export function normalizeRut(input: string): string | null {
  const clean = input.replace(/[.\s-]/g, "").toLowerCase();
  if (!/^\d{7,8}[0-9k]$/.test(clean)) return null;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  return `${body}-${dv}`;
}

export function isValidRut(input: string): boolean {
  const normalized = normalizeRut(input);
  if (!normalized) return false;
  const [body, dv] = normalized.split("-");
  return computeDv(body) === dv;
}

function computeDv(body: string): string {
  let sum = 0;
  let factor = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const rest = 11 - (sum % 11);
  if (rest === 11) return "0";
  if (rest === 10) return "k";
  return String(rest);
}

export function formatRut(normalized: string): string {
  const [body, dv] = normalized.split("-");
  return `${Number(body).toLocaleString("es-CL")}-${dv.toUpperCase()}`;
}
