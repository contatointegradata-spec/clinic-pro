-- Migration: whatsapp_lid_mapping
-- Vínculo persistente LID (@lid) ↔ telefone de contatos do WhatsApp, para que
-- a mesma pessoa não vire duas conversas no Atendimento.
--
-- Idempotente (IF NOT EXISTS / ON CONFLICT), no padrão das migrations
-- >= 20260628 que rodam via `prisma migrate deploy` (ver scripts/migrate.sh).
--
-- Backfill: conversas que já conhecem os dois lados (lidJid + normalizedPhone)
-- alimentam a tabela. A fusão das conversas duplicadas é feita pelo backend
-- na inicialização (lib/whatsapp-identity.ts → reconcileAllLidConversations),
-- pois exige as regras de prioridade de status do Atendimento.

CREATE TABLE IF NOT EXISTS "TBLWHATSAPPLID" (
    "lidJid" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TBLWHATSAPPLID_pkey" PRIMARY KEY ("lidJid")
);

CREATE INDEX IF NOT EXISTS "TBLWHATSAPPLID_phone_idx" ON "TBLWHATSAPPLID"("phone");

INSERT INTO "TBLWHATSAPPLID" ("lidJid", "phone", "source", "createdAt", "updatedAt")
SELECT DISTINCT ON (c."lidJid")
       c."lidJid",
       CASE
         WHEN length(regexp_replace(c."normalizedPhone", '\D', '', 'g')) IN (10, 11)
           THEN '55' || regexp_replace(c."normalizedPhone", '\D', '', 'g')
         ELSE regexp_replace(c."normalizedPhone", '\D', '', 'g')
       END,
       'backfill',
       CURRENT_TIMESTAMP,
       CURRENT_TIMESTAMP
FROM "TBLCONVERSA" c
WHERE c."lidJid" LIKE '%@lid'
  AND c."normalizedPhone" IS NOT NULL
  AND length(regexp_replace(c."normalizedPhone", '\D', '', 'g')) >= 10
  -- Proteção: nunca tratar os dígitos do próprio LID como telefone
  AND regexp_replace(c."normalizedPhone", '\D', '', 'g') <> split_part(c."lidJid", '@', 1)
ORDER BY c."lidJid", c."updatedAt" DESC
ON CONFLICT ("lidJid") DO NOTHING;
