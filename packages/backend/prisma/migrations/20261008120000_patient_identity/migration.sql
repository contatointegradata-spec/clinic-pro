-- Migration: patient_identity
-- Identidade do paciente por telefone (deduplicação Agente de IA × cadastro).
--
-- Idempotente (IF NOT EXISTS / WHERE ... IS NULL), no padrão das migrations
-- >= 20260628 que rodam via `prisma migrate deploy` (ver scripts/migrate.sh).
--
--   * Patient.phoneKey — chave de comparação: DDD + últimos 8 dígitos, sem
--     DDI 55 e sem o 9º dígito ("5534992142504" e "553492142504" → "3492142504").
--     Número estrangeiro = dígitos completos (8 a 13). LID do WhatsApp nunca
--     gera chave. Mesma regra de computePhoneKey (src/lib/phone.ts); daqui pra
--     frente é mantida pelo middleware do Prisma (src/lib/prisma.ts).
--   * Patient.whatsappLid — LID (NNN@lid) de lead criado sem telefone real.
--   * Normaliza telefones com DDI ainda formatados ("+55 (34) 99214-2504"),
--     que a migration 20261004100000 (só 10/11 dígitos) deixou de fora.
--
-- A FUSÃO de duplicados NÃO é feita aqui: exige as regras de segurança
-- (telefone compartilhado por família ≠ duplicidade) e roda no backend na
-- inicialização (src/lib/patient-identity.ts → runPatientIdentityMaintenance).

ALTER TABLE "TBLPACIENTE" ADD COLUMN IF NOT EXISTS "phoneKey" TEXT;
ALTER TABLE "TBLPACIENTE" ADD COLUMN IF NOT EXISTS "whatsappLid" TEXT;

CREATE INDEX IF NOT EXISTS "TBLPACIENTE_doctorId_phoneKey_idx" ON "TBLPACIENTE"("doctorId", "phoneKey");
CREATE INDEX IF NOT EXISTS "TBLPACIENTE_whatsappLid_idx" ON "TBLPACIENTE"("whatsappLid");

-- Telefone com DDI 55 ainda com formatação → só dígitos (nenhum dígito perdido)
UPDATE "TBLPACIENTE"
SET "phone" = regexp_replace("phone", '\D', '', 'g')
WHERE "phone" !~ '^\d+$'
  AND "phone" NOT LIKE '%@%'
  AND "phone" NOT LIKE 'anon-%'
  AND length(regexp_replace("phone", '\D', '', 'g')) IN (12, 13)
  AND regexp_replace("phone", '\D', '', 'g') LIKE '55%';

-- LID gravado como telefone (lead do Agente de IA sem telefone resolvido)
UPDATE "TBLPACIENTE"
SET "whatsappLid" = regexp_replace(split_part(split_part("phone", '@', 1), ':', 1), '\D', '', 'g') || '@lid'
WHERE "whatsappLid" IS NULL
  AND "anonymizedAt" IS NULL
  AND (
    "phone" LIKE '%@lid%'
    OR (
      "phone" ~ '^[0-9\s()+.-]+$'
      AND length(regexp_replace("phone", '\D', '', 'g')) > 13
      AND regexp_replace("phone", '\D', '', 'g') NOT LIKE '55%'
    )
  );

-- Backfill da chave de comparação
UPDATE "TBLPACIENTE" p
SET "phoneKey" = k.key
FROM (
  SELECT id,
         CASE
           WHEN "phone" LIKE '%@%' OR "phone" LIKE 'anon-%' THEN NULL
           WHEN length(d) IN (12, 13) AND d LIKE '55%' THEN substr(d, 3, 2) || right(d, 8)
           WHEN length(d) IN (10, 11) THEN left(d, 2) || right(d, 8)
           WHEN length(d) BETWEEN 8 AND 13 THEN d
           ELSE NULL
         END AS key
  FROM (
    SELECT id, "phone", regexp_replace("phone", '\D', '', 'g') AS d
    FROM "TBLPACIENTE"
    WHERE "phoneKey" IS NULL AND "anonymizedAt" IS NULL
  ) s
) k
WHERE p.id = k.id AND k.key IS NOT NULL AND p."phoneKey" IS NULL;
