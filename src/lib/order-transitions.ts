/**
 * Máquina de estados de un pedido: desde cada estado, a cuáles se puede pasar.
 *
 * Vive en su propio módulo (y no en actions.ts) por dos razones:
 *  - Un archivo "use server" solo puede exportar funciones async, nunca
 *    constantes como esta tabla.
 *  - El selector de estado (cliente) necesita la misma tabla para ofrecer
 *    únicamente los cambios alcanzables, y la acción (servidor) la usa para
 *    validar por si dos admins mueven el mismo pedido a la vez.
 */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  por_preparar: ["preparando", "despachado", "anulado"],
  preparando: ["despachado", "anulado", "por_preparar"],
  despachado: ["preparando"],
  requiere_revision: ["por_preparar", "anulado"],
  // Terminal: anular repone el stock en Shopify; no hay vuelta atrás.
  anulado: [],
};

/** Un estado terminal no admite ningún cambio (hoy, solo "anulado"). */
export function isTerminalStatus(status: string): boolean {
  return (VALID_TRANSITIONS[status] ?? []).length === 0;
}
