-- Migration: ai_agent_gemini_config_and_limit
-- Aditiva, não altera/remove nada existente:
-- 1) Tabela TBLCONFIGAGENTEIA (config administrável do motor do Agente de
--    IA — chave/modelo da Gemini, editável pelo Admin > Integrações)
-- 2) User.aiAgentLimit (quantos Agentes de IA cada médico pode ter — padrão 1)

-- 1) Config do motor de IA (linha única, id fixo "ai-agent")
CREATE TABLE IF NOT EXISTS "TBLCONFIGAGENTEIA" (
  "id"              TEXT NOT NULL,
  "provider"        TEXT NOT NULL DEFAULT 'gemini',
  "apiKey"          TEXT,
  "model"           TEXT,
  "updatedByUserId" TEXT,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLCONFIGAGENTEIA_pkey" PRIMARY KEY ("id")
);

-- 2) Limite de agentes de IA por médico (1 grátis, liberado pelo admin)
ALTER TABLE "TBLUSUARIO"
  ADD COLUMN IF NOT EXISTS "aiAgentLimit" INTEGER NOT NULL DEFAULT 1;
