import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL no está definida");
  }
  // Supabase: usar el pooler en transaction mode (puerto 6543) desde
  // serverless. prepare: false es obligatorio con PgBouncer en ese modo.
  const client = postgres(connectionString, { prepare: false, max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

// Inicialización perezosa (next build evalúa módulos sin env de runtime) +
// caché en globalThis: en dev, cada recarga HMR re-evalúa este módulo y sin
// caché cada una crearía un pool nuevo hasta agotar max_connections.
const globalForDb = globalThis as unknown as { __carambaDb?: Db };

function getDb(): Db {
  if (!globalForDb.__carambaDb) {
    globalForDb.__carambaDb = createDb();
  }
  return globalForDb.__carambaDb;
}

export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    return Reflect.get(getDb(), prop);
  },
});

export { schema };
