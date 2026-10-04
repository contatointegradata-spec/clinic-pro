-- Migration: add_generated_documents
-- Aditiva — documento preenchido e "congelado" por um humano, entregue
-- depois pelo Agente de IA sob pedido do paciente (ver send_ready_document
-- em lib/ai-agent-engine.ts). O agente nunca gera/edita conteúdo, só
-- entrega o que já foi preparado aqui.

CREATE TABLE IF NOT EXISTS "TBLDOCUMENTOGERADO" (
  "id"              TEXT NOT NULL,
  "doctorId"        TEXT NOT NULL,
  "patientId"       TEXT NOT NULL,
  "templateId"      TEXT,
  "name"            TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'READY',
  "createdByUserId" TEXT NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"          TIMESTAMP(3),

  CONSTRAINT "TBLDOCUMENTOGERADO_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TBLDOCUMENTOGERADO_patientId_status_idx" ON "TBLDOCUMENTOGERADO"("patientId", "status");

DO $$ BEGIN
  ALTER TABLE "TBLDOCUMENTOGERADO" ADD CONSTRAINT "TBLDOCUMENTOGERADO_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "TBLUSUARIO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLDOCUMENTOGERADO" ADD CONSTRAINT "TBLDOCUMENTOGERADO_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "TBLPACIENTE"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLDOCUMENTOGERADO" ADD CONSTRAINT "TBLDOCUMENTOGERADO_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "TBLMODELODOCUMENTO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLDOCUMENTOGERADO" ADD CONSTRAINT "TBLDOCUMENTOGERADO_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
