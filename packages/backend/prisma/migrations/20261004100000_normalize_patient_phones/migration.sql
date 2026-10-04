-- Migration: normalize_patient_phones
-- Dado existente, não é mudança de schema — normaliza phone/responsiblePhone
-- de TODO paciente já cadastrado pro mesmo formato canônico que o Agente de
-- IA passa a usar (DDI 55 + DDD + número, só dígitos). Sem isso, pacientes
-- cadastrados manualmente antes dessa mudança (ex: telefone salvo como
-- "(34) 99150-3110" ou "34991503110", sem o 55) nunca batem com o telefone
-- resolvido via WhatsApp — o Agente de IA trata como paciente novo e duplica.
--
-- Idempotente e seguro: não apaga nenhum dígito do telefone original, só
-- remove formatação (parênteses/traço/espaço) e adiciona o DDI quando
-- faltava. Linhas já no formato novo (ou com valor fora do padrão esperado)
-- são ignoradas. Reversível a qualquer momento removendo o prefixo "55" de
-- novo, já que nenhum dígito original é perdido.

UPDATE "TBLPACIENTE"
SET "phone" = '55' || regexp_replace("phone", '\D', '', 'g')
WHERE length(regexp_replace("phone", '\D', '', 'g')) IN (10, 11);

UPDATE "TBLPACIENTE"
SET "responsiblePhone" = '55' || regexp_replace("responsiblePhone", '\D', '', 'g')
WHERE "responsiblePhone" IS NOT NULL
  AND length(regexp_replace("responsiblePhone", '\D', '', 'g')) IN (10, 11);
