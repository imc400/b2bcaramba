import type { campaigns } from "@/db/schema";

/**
 * ¿La campaña acepta pedidos ahora?
 *
 * Única definición de "campaña abierta" del sistema. Antes vivía duplicada:
 * el microsite solo miraba `status`, y createOrder además miraba `endsAt`.
 * Resultado: el colaborador armaba su carrito completo y recién al confirmar
 * descubría que la campaña había cerrado.
 */
export function isCampaignOpen(
  campaign: Pick<typeof campaigns.$inferSelect, "status" | "startsAt" | "endsAt">,
  now: Date = new Date(),
): boolean {
  if (campaign.status !== "active") return false;
  if (campaign.startsAt && campaign.startsAt > now) return false;
  if (campaign.endsAt && campaign.endsAt < now) return false;
  return true;
}

/**
 * Convierte la fecha de un <input type="date"> al instante de cierre.
 * Fin del día en horario de Chile continental. Usar SIEMPRE esta función:
 * hardcodear el offset (-03:00 vs -04:00) corría el cierre un día según la
 * época del año.
 */
export function endOfDayInChile(isoDate: string): Date {
  // Mediodía UTC del día indicado, para no cruzar de día por el offset,
  // y de ahí al último milisegundo del día local chileno.
  const noonUtc = new Date(`${isoDate}T12:00:00Z`);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Santiago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(noonUtc).map((p) => [p.type, p.value]),
  );
  // Offset real de Chile ese día (–03:00 o –04:00)
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asUtc - noonUtc.getTime();
  // 23:59:59.999 hora local de ese día → UTC
  const endLocal = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    23,
    59,
    59,
    999,
  );
  return new Date(endLocal - offsetMs);
}
