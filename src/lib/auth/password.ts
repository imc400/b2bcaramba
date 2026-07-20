import "server-only";
import { randomBytes, scrypt, type ScryptOptions, timingSafeEqual } from "node:crypto";

const KEYLEN = 64;
// Costo de scrypt: N=16384 es el default de Node y un punto razonable de
// memoria-dureza para un panel de bajo volumen de logins.
const COST: ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// promisify(scrypt) sólo captura la sobrecarga de 3 argumentos, así que
// envolvemos la variante con opciones a mano para conservar el costo scrypt.
function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, COST, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
}

/** Formato almacenado: scrypt$<saltHex>$<hashHex>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** Verificación timing-safe. Devuelve false ante cualquier formato inesperado. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const derived = await scryptAsync(password, salt, expected.length);
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** Reglas mínimas de contraseña, compartidas por el form y el server. */
export function validatePassword(password: string): string | null {
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  if (password.length > 200) return "La contraseña es demasiado larga.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Incluye al menos una letra y un número.";
  }
  return null;
}
