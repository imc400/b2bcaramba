-- IF NOT EXISTS: sin esto, la migración revienta en cualquier base donde el
-- valor ya se haya agregado a mano, y corta la cadena de migraciones.
ALTER TYPE "public"."product_status" ADD VALUE IF NOT EXISTS 'UNLISTED';
