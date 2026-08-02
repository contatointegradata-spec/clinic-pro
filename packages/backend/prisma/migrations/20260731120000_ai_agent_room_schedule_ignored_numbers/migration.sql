-- Migration: ai_agent_room_schedule_ignored_numbers
-- 1) Expande TBLSALA com intervalo/horário especial/duração de slot
-- 2) Expande TBLLIGHTCHATBOT com os campos do Agente de IA (prompt/personalidade)
-- 3) Cria TBLLIGHTNUMEROPASS (números ignorados pela IA)
-- 4) Cria TBLAIAGENTMESSAGE (memória curta de conversa pro contexto da LLM)

-- 1) Horário expandido da Sala
ALTER TABLE "TBLSALA"
  ADD COLUMN IF NOT EXISTS "breakStart"          TEXT,
  ADD COLUMN IF NOT EXISTS "breakEnd"            TEXT,
  ADD COLUMN IF NOT EXISTS "specialHours"        JSONB,
  ADD COLUMN IF NOT EXISTS "slotDurationMinutes" INTEGER NOT NULL DEFAULT 30;

-- 2) Campos do Agente de IA
ALTER TABLE "TBLLIGHTCHATBOT"
  ADD COLUMN IF NOT EXISTS "agentName"            TEXT,
  ADD COLUMN IF NOT EXISTS "companyName"          TEXT,
  ADD COLUMN IF NOT EXISTS "businessType"         TEXT,
  ADD COLUMN IF NOT EXISTS "calendarUsage"        TEXT,
  ADD COLUMN IF NOT EXISTS "agentProfession"      TEXT,
  ADD COLUMN IF NOT EXISTS "personality"          TEXT,
  ADD COLUMN IF NOT EXISTS "extraInfo"            TEXT,
  ADD COLUMN IF NOT EXISTS "systemPrompt"         TEXT,
  ADD COLUMN IF NOT EXISTS "responseDelaySeconds" INTEGER NOT NULL DEFAULT 3;

ALTER TABLE "TBLLIGHTCHATBOT"
  ALTER COLUMN "builderMode" SET DEFAULT 'ai_agent';

-- 3) Número Pass
CREATE TABLE IF NOT EXISTS "TBLLIGHTNUMEROPASS" (
  "id"        TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "chatbotId" TEXT NOT NULL,
  "phone"     TEXT NOT NULL,
  "name"      TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLLIGHTNUMEROPASS_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TBLLIGHTNUMEROPASS_chatbotId_phone_key" UNIQUE ("chatbotId", "phone"),
  CONSTRAINT "TBLLIGHTNUMEROPASS_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "TBLLIGHTCHATBOT"("id") ON DELETE CASCADE
);

-- 4) Memória curta de conversa (contexto da LLM)
CREATE TABLE IF NOT EXISTS "TBLAIAGENTMESSAGE" (
  "id"           TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "chatbotId"    TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "role"         TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLAIAGENTMESSAGE_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TBLAIAGENTMESSAGE_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "TBLLIGHTCHATBOT"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "TBLAIAGENTMESSAGE_chatbotId_contactPhone_createdAt_idx" ON "TBLAIAGENTMESSAGE"("chatbotId", "contactPhone", "createdAt");
