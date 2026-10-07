-- Interruptor do bloqueio por assinatura, gerenciado em Admin > Integrações
-- (antes só existia via SUBSCRIPTION_ENFORCEMENT_ENABLED no .env + redeploy).
ALTER TABLE "TBLCONFIGKIWIFY" ADD COLUMN "enforceSubscription" BOOLEAN NOT NULL DEFAULT false;

-- Busca do médico pela assinatura recorrente da Kiwify (renovações podem
-- chegar sem os parâmetros de rastreamento s1/s2/s3 do checkout original).
CREATE INDEX IF NOT EXISTS "TBLASSINATURACLINICA_kiwifySubscriptionId_idx" ON "TBLASSINATURACLINICA"("kiwifySubscriptionId");
