/**
 * Stub de `server-only` para correr scripts/tests con tsx.
 * El paquete real lanza una excepción al importarse fuera del bundler de Next;
 * su única función es impedir que un módulo de servidor llegue al cliente, y
 * en un script de Node esa protección no aplica.
 */
export {};
