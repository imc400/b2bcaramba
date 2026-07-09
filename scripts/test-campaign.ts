/** Test de isCampaignOpen y endOfDayInChile (DST chileno). */
import assert from "node:assert";
import { endOfDayInChile, isCampaignOpen } from "../src/lib/campaign";

// Chile: -03:00 en verano austral (ene), -04:00 en invierno (jul)
const verano = endOfDayInChile("2026-01-15");
const invierno = endOfDayInChile("2026-07-15");
assert.equal(verano.toISOString(), "2026-01-16T02:59:59.999Z", "verano = UTC-3");
assert.equal(invierno.toISOString(), "2026-07-16T03:59:59.999Z", "invierno = UTC-4");
// Ambos son el último instante del día en Chile
for (const d of [verano, invierno]) {
  const local = d.toLocaleString("sv-SE", { timeZone: "America/Santiago" });
  assert.ok(local.includes("23:59:59"), `último instante local, fue ${local}`);
}

const base = { status: "active" as const, startsAt: null, endsAt: null };
const ahora = new Date("2026-07-09T12:00:00Z");
assert.equal(isCampaignOpen(base, ahora), true, "activa sin fechas");
assert.equal(isCampaignOpen({ ...base, status: "draft" }, ahora), false, "borrador cerrada");
assert.equal(isCampaignOpen({ ...base, status: "closed" }, ahora), false, "cerrada");
assert.equal(
  isCampaignOpen({ ...base, endsAt: new Date("2026-07-08T00:00:00Z") }, ahora),
  false,
  "vencida por endsAt",
);
assert.equal(
  isCampaignOpen({ ...base, startsAt: new Date("2026-07-10T00:00:00Z") }, ahora),
  false,
  "aún no empieza",
);
assert.equal(
  isCampaignOpen({ ...base, endsAt: new Date("2026-07-10T00:00:00Z") }, ahora),
  true,
  "vigente",
);

console.log("✓ campaign: isCampaignOpen y endOfDayInChile (DST) pasan");
