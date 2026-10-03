-- Migration: add_refresh_token
-- Aditiva — cria a tabela TBLREFRESHTOKEN. Não altera nem remove nenhuma
-- tabela/coluna existente, sem risco de perda de dado.

CREATE TABLE IF NOT EXISTS "TBLREFRESHTOKEN" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLREFRESHTOKEN_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TBLREFRESHTOKEN_tokenHash_key" ON "TBLREFRESHTOKEN"("tokenHash");

CREATE INDEX IF NOT EXISTS "TBLREFRESHTOKEN_userId_idx" ON "TBLREFRESHTOKEN"("userId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TBLREFRESHTOKEN_userId_fkey'
  ) THEN
    ALTER TABLE "TBLREFRESHTOKEN"
      ADD CONSTRAINT "TBLREFRESHTOKEN_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "TBLUSUARIO"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
