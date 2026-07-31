-- Migration: prontuario_procedures_and_transaction_patient
-- 1) Adiciona TBLPRONTUARIOPROCEDIMENTO (procedimentos avulsos por registro de prontuário)
-- 2) Adiciona TBLPRONTUARIO.billedAt (evita lançar 2x no financeiro)
-- 3) Adiciona TBLTRANSACAO.medicalRecordId e TBLTRANSACAO.patientId
-- 4) Backfill de TBLTRANSACAO.patientId a partir do Appointment vinculado (transações já existentes)

-- 1) Procedimentos do prontuário
CREATE TABLE IF NOT EXISTS "TBLPRONTUARIOPROCEDIMENTO" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "medicalRecordId"   TEXT NOT NULL,
  "appointmentTypeId" TEXT,
  "name"              TEXT NOT NULL,
  "valorTabelado"     DOUBLE PRECISION NOT NULL,
  "valorPago"         DOUBLE PRECISION NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLPRONTUARIOPROCEDIMENTO_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TBLPRONTUARIOPROCEDIMENTO_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "TBLPRONTUARIO"("id") ON DELETE CASCADE,
  CONSTRAINT "TBLPRONTUARIOPROCEDIMENTO_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "TBLTIPOAGENDAMENTO"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "TBLPRONTUARIOPROCEDIMENTO_medicalRecordId_idx" ON "TBLPRONTUARIOPROCEDIMENTO"("medicalRecordId");

-- 2) billedAt no prontuário
ALTER TABLE "TBLPRONTUARIO"
  ADD COLUMN IF NOT EXISTS "billedAt" TIMESTAMP(3);

-- 3) vínculos novos na Transação
ALTER TABLE "TBLTRANSACAO"
  ADD COLUMN IF NOT EXISTS "medicalRecordId" TEXT,
  ADD COLUMN IF NOT EXISTS "patientId"       TEXT;

DO $$ BEGIN
  ALTER TABLE "TBLTRANSACAO"
    ADD CONSTRAINT "TBLTRANSACAO_medicalRecordId_key" UNIQUE ("medicalRecordId");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLTRANSACAO"
    ADD CONSTRAINT "TBLTRANSACAO_medicalRecordId_fkey"
    FOREIGN KEY ("medicalRecordId") REFERENCES "TBLPRONTUARIO"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLTRANSACAO"
    ADD CONSTRAINT "TBLTRANSACAO_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "TBLPACIENTE"("id");
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 4) Backfill: transações já lançadas via cobrança de agendamento ganham o
-- paciente diretamente, sem precisar atravessar o Appointment em todo relatório.
UPDATE "TBLTRANSACAO" t
SET "patientId" = a."patientId"
FROM "TBLAGENDAMENTO" a
WHERE t."appointmentId" = a."id"
  AND t."patientId" IS NULL;
