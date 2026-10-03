-- Migration: patient_consent_and_anonymize
-- LGPD — aditiva, não altera/remove nada existente:
-- 1) Patient.anonymizedAt (nullable, sem default — não afeta pacientes atuais)
-- 2) Tabela TBLCONSENTIMENTOPACIENTE (registro de consentimento do paciente)

-- 1) Campo de anonimização no paciente
ALTER TABLE "TBLPACIENTE"
  ADD COLUMN IF NOT EXISTS "anonymizedAt" TIMESTAMP(3);

-- 2) Enum do canal de consentimento (idempotente)
DO $$ BEGIN
  CREATE TYPE "ConsentChannel" AS ENUM ('PRESENCIAL', 'TELEFONE', 'WHATSAPP', 'OUTRO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 3) Tabela de consentimento
CREATE TABLE IF NOT EXISTS "TBLCONSENTIMENTOPACIENTE" (
  "id"               TEXT NOT NULL,
  "patientId"        TEXT NOT NULL,
  "channel"          "ConsentChannel" NOT NULL,
  "termsVersion"     TEXT NOT NULL,
  "consentedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedByUserId" TEXT NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLCONSENTIMENTOPACIENTE_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TBLCONSENTIMENTOPACIENTE_patientId_idx" ON "TBLCONSENTIMENTOPACIENTE"("patientId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TBLCONSENTIMENTOPACIENTE_patientId_fkey'
  ) THEN
    ALTER TABLE "TBLCONSENTIMENTOPACIENTE"
      ADD CONSTRAINT "TBLCONSENTIMENTOPACIENTE_patientId_fkey"
      FOREIGN KEY ("patientId") REFERENCES "TBLPACIENTE"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'TBLCONSENTIMENTOPACIENTE_recordedByUserId_fkey'
  ) THEN
    ALTER TABLE "TBLCONSENTIMENTOPACIENTE"
      ADD CONSTRAINT "TBLCONSENTIMENTOPACIENTE_recordedByUserId_fkey"
      FOREIGN KEY ("recordedByUserId") REFERENCES "TBLUSUARIO"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
