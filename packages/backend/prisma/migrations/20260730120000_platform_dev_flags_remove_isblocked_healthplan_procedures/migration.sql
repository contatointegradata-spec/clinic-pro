-- Migration: platform_dev_flags_remove_isblocked_healthplan_procedures
-- 1) Adds platform-developer / per-user access flags to TBLUSUARIO
-- 2) Removes the "Bloquear para a Secretária" feature (TBLAGENDAMENTO.isBlocked)
-- 3) Adds Convênio↔Procedimento link (TBLPLANOSAUDEPROCEDIMENTO)
-- 4) Adds itemized breakdown column to TBLTRANSACAO

-- 1) Platform developer / gradual access flags on User
ALTER TABLE "TBLUSUARIO"
  ADD COLUMN IF NOT EXISTS "isPlatformDeveloper" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "notificationsAccess" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "integrationsAccess"  BOOLEAN NOT NULL DEFAULT false;

-- Grant the existing platform-developer account full access from day one
UPDATE "TBLUSUARIO"
  SET "isPlatformDeveloper" = true,
      "notificationsAccess" = true,
      "integrationsAccess"  = true
  WHERE "email" = 'admin@cliniq.com';

-- 2) Remove "Bloquear para a Secretária" entirely
ALTER TABLE "TBLAGENDAMENTO"
  DROP COLUMN IF EXISTS "isBlocked";

-- 3) Convênio (HealthPlan) ↔ Procedimento (AppointmentType) link, with a
-- value specific to that pair (used by the "Cobrar Consulta" modal).
CREATE TABLE IF NOT EXISTS "TBLPLANOSAUDEPROCEDIMENTO" (
  "id"                TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "healthPlanId"      TEXT NOT NULL,
  "appointmentTypeId" TEXT NOT NULL,
  "value"             DOUBLE PRECISION NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLPLANOSAUDEPROCEDIMENTO_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TBLPLANOSAUDEPROCEDIMENTO_healthPlanId_appointmentTypeId_key" UNIQUE ("healthPlanId", "appointmentTypeId"),
  CONSTRAINT "TBLPLANOSAUDEPROCEDIMENTO_healthPlanId_fkey" FOREIGN KEY ("healthPlanId") REFERENCES "TBLPLANOSAUDE"("id") ON DELETE CASCADE,
  CONSTRAINT "TBLPLANOSAUDEPROCEDIMENTO_appointmentTypeId_fkey" FOREIGN KEY ("appointmentTypeId") REFERENCES "TBLTIPOAGENDAMENTO"("id") ON DELETE CASCADE
);

-- 4) Itemized breakdown for a charge (base consult + procedures added)
ALTER TABLE "TBLTRANSACAO"
  ADD COLUMN IF NOT EXISTS "items" JSONB;
