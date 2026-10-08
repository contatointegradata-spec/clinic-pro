-- Migration: attendance_crud
-- CRUD do Atendimento dentro dos limites do WhatsApp:
-- - observações internas editáveis/excluíveis (soft delete) — mensagens
--   trocadas com o WhatsApp continuam imutáveis;
-- - nome do contato editável (trava contra o pushName do WhatsApp);
-- - vínculo manual conversa ↔ paciente (a ingestão deixa de re-vincular
--   sozinha pelo telefone);
-- - novos tipos de evento na timeline.
--
-- Idempotente (IF NOT EXISTS), no padrão das migrations >= 20260628 que
-- rodam via `prisma migrate deploy` (ver scripts/migrate.sh).

ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'NOTE_EDITED';
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'NOTE_DELETED';
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'CONTACT_UPDATED';
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'PATIENT_LINKED';
ALTER TYPE "ConversationEventType" ADD VALUE IF NOT EXISTS 'PATIENT_UNLINKED';

ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "contactNameLocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "patientLinkManual" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TBLMENSAGEM" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
ALTER TABLE "TBLMENSAGEM" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "TBLMENSAGEM" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;
