-- Migration: room_whatsapp_failure_cycles
-- Aditiva — ADD COLUMN com default, sem risco pros dados existentes.

ALTER TABLE "TBLSALAWHATSAPP"
  ADD COLUMN IF NOT EXISTS "failureCycles" INTEGER NOT NULL DEFAULT 0;
