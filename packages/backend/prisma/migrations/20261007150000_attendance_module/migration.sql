-- Migration: attendance_module
-- Módulo Atendimento (inbox humano multi-sala, filas, timeline) + refatoração
-- de Notificações (categoria, entidade, dedupe).
--
-- Idempotente (IF NOT EXISTS / DO ... EXCEPTION), no padrão das migrations
-- >= 20260628 que rodam via `prisma migrate deploy` (ver scripts/migrate.sh).
--
-- Mudanças de dado (seguras):
--   * Conversation.roomId/doctorId preenchidos a partir da instância do
--     chatbot (TBLWHATSAPPINSTANCIA → TBLLIGHTCHATBOT.boundRoomId).
--   * Conversas duplicadas para o mesmo (roomId, contactPhone) são MESCLADAS
--     na mais recente (mensagens movidas, nada de histórico perdido além de
--     mensagens com o mesmo waMessageId já presentes na conversa mantida).
--   * Notificações "Nova mensagem de ..." são apagadas (não são mais criadas).
--   * Categoria inferida para notificações antigas pelo título.

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "NotificationCategory" AS ENUM ('AGENDAMENTO', 'CANCELAMENTO', 'FOLLOW_UP', 'CRM', 'ATENDIMENTO', 'SYSTEM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('BOT', 'QUEUED', 'IN_PROGRESS', 'RESOLVED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "AttendanceQueueKind" AS ENUM ('RECEPTION', 'DOCTOR', 'CUSTOM');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "ConversationEventType" AS ENUM ('CREATED', 'BOT_STARTED', 'HANDOFF_TO_HUMAN', 'ASSUMED', 'TRANSFERRED_QUEUE', 'TRANSFERRED_USER', 'RETURNED_TO_BOT', 'RESOLVED', 'REOPENED', 'NOTE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ─── Notificações ─────────────────────────────────────────────────────────────

ALTER TABLE "TBLNOTIFICACAO" ADD COLUMN IF NOT EXISTS "category" "NotificationCategory" NOT NULL DEFAULT 'SYSTEM';
ALTER TABLE "TBLNOTIFICACAO" ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;
ALTER TABLE "TBLNOTIFICACAO" ADD COLUMN IF NOT EXISTS "entityId" TEXT;
ALTER TABLE "TBLNOTIFICACAO" ADD COLUMN IF NOT EXISTS "entityType" TEXT;

-- Mensagem recebida no WhatsApp não é mais notificação (vai pro Atendimento).
DELETE FROM "TBLNOTIFICACAO" WHERE "title" LIKE 'Nova mensagem de %';

-- Categoria das notificações antigas (só as que ainda estão no default).
UPDATE "TBLNOTIFICACAO" SET "category" = 'CANCELAMENTO'
WHERE "category" = 'SYSTEM' AND lower("title") LIKE '%cancel%';

UPDATE "TBLNOTIFICACAO" SET "category" = 'AGENDAMENTO'
WHERE "category" = 'SYSTEM'
  AND (lower("title") LIKE '%agend%' OR lower("title") LIKE '%consulta%');

UPDATE "TBLNOTIFICACAO" SET "category" = 'CRM'
WHERE "category" = 'SYSTEM'
  AND (lower("title") LIKE '%chatbot%' OR lower("title") LIKE '%lead%');
-- 'WhatsApp ...' (quarentena) e demais permanecem SYSTEM.

CREATE UNIQUE INDEX IF NOT EXISTS "TBLNOTIFICACAO_dedupeKey_key" ON "TBLNOTIFICACAO"("dedupeKey");
CREATE INDEX IF NOT EXISTS "TBLNOTIFICACAO_userId_read_createdAt_idx" ON "TBLNOTIFICACAO"("userId", "read", "createdAt");

-- ─── Conversa / Mensagem: colunas ─────────────────────────────────────────────

ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "attendanceStatus" "AttendanceStatus" NOT NULL DEFAULT 'BOT';
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "doctorId" TEXT;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "firstHumanResponseAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "lastReadAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "patientId" TEXT;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "queueId" TEXT;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "queuedAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMP(3);
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "resolvedById" TEXT;
ALTER TABLE "TBLCONVERSA" ADD COLUMN IF NOT EXISTS "roomId" TEXT;
ALTER TABLE "TBLCONVERSA" ALTER COLUMN "instanceId" DROP NOT NULL;

ALTER TABLE "TBLMENSAGEM" ADD COLUMN IF NOT EXISTS "authorUserId" TEXT;
ALTER TABLE "TBLMENSAGEM" ADD COLUMN IF NOT EXISTS "isInternalNote" BOOLEAN NOT NULL DEFAULT false;

-- instanceId agora é opcional: apagar a instância do chatbot NÃO apaga mais o
-- histórico de atendimento da sala (antes era CASCADE).
ALTER TABLE "TBLCONVERSA" DROP CONSTRAINT IF EXISTS "TBLCONVERSA_instanceId_fkey";
ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_instanceId_fkey"
  FOREIGN KEY ("instanceId") REFERENCES "TBLWHATSAPPINSTANCIA"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Novas tabelas ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TBLFILAATENDIMENTO" (
  "id"        TEXT NOT NULL,
  "doctorId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "color"     TEXT,
  "kind"      "AttendanceQueueKind" NOT NULL DEFAULT 'CUSTOM',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TBLFILAATENDIMENTO_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TBLFILAATENDIMENTOMEMBRO" (
  "id"        TEXT NOT NULL,
  "queueId"   TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLFILAATENDIMENTOMEMBRO_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "TBLCONVERSAEVENTO" (
  "id"             TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "type"           "ConversationEventType" NOT NULL,
  "actorUserId"    TEXT,
  "fromQueueId"    TEXT,
  "toQueueId"      TEXT,
  "fromUserId"     TEXT,
  "toUserId"       TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TBLCONVERSAEVENTO_pkey" PRIMARY KEY ("id")
);

-- ─── Backfill: sala/médico das conversas existentes ──────────────────────────

UPDATE "TBLCONVERSA" c
SET "doctorId" = i."doctorId"
FROM "TBLWHATSAPPINSTANCIA" i
WHERE c."instanceId" = i."id"
  AND c."doctorId" IS NULL;

UPDATE "TBLCONVERSA" c
SET "roomId" = lc."boundRoomId"
FROM "TBLWHATSAPPINSTANCIA" i
JOIN "TBLLIGHTCHATBOT" lc ON lc."id" = i."chatbotId"
WHERE c."instanceId" = i."id"
  AND c."roomId" IS NULL
  AND lc."boundRoomId" IS NOT NULL;

-- attendanceStatus: conversas existentes eram todas atendidas pelo Agente de
-- IA — a coluna nasce com DEFAULT 'BOT', o que já cobre o backfill (sem
-- UPDATE explícito para não sobrescrever estado real numa reexecução).

-- ─── Dedupe antes do unique (roomId, contactPhone) ───────────────────────────
-- Mantém a conversa mais recente de cada grupo e move para ela as mensagens
-- das demais. Mensagens repetidas (mesmo waMessageId) não são duplicadas.

DROP TABLE IF EXISTS "_tmp_conv_dedupe";
CREATE TEMP TABLE "_tmp_conv_dedupe" AS
SELECT "id" AS "loserId", "keeperId"
FROM (
  SELECT
    "id",
    ROW_NUMBER() OVER w AS rn,
    FIRST_VALUE("id") OVER w AS "keeperId"
  FROM "TBLCONVERSA"
  WHERE "roomId" IS NOT NULL
  WINDOW w AS (
    PARTITION BY "roomId", "contactPhone"
    ORDER BY "lastMessageAt" DESC NULLS LAST, "createdAt" DESC, "id" DESC
  )
) ranked
WHERE rn > 1;

-- Remove das conversas descartadas as mensagens cujo waMessageId já existe no
-- destino (ou em outra descartada do mesmo grupo), respeitando o unique
-- (conversationId, waMessageId) após a mudança.
DELETE FROM "TBLMENSAGEM" m
USING (
  SELECT
    m2."id",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(d."keeperId", m2."conversationId"), m2."waMessageId"
      ORDER BY (d."loserId" IS NULL) DESC, m2."timestamp" ASC, m2."id" ASC
    ) AS rn
  FROM "TBLMENSAGEM" m2
  LEFT JOIN "_tmp_conv_dedupe" d ON d."loserId" = m2."conversationId"
  WHERE m2."waMessageId" IS NOT NULL
    AND (
      d."loserId" IS NOT NULL
      OR m2."conversationId" IN (SELECT "keeperId" FROM "_tmp_conv_dedupe")
    )
) dup
WHERE m."id" = dup."id" AND dup.rn > 1;

UPDATE "TBLMENSAGEM" m
SET "conversationId" = d."keeperId"
FROM "_tmp_conv_dedupe" d
WHERE m."conversationId" = d."loserId";

UPDATE "TBLCONVERSA" k
SET
  "unreadCount"   = k."unreadCount" + agg."unread",
  "contactName"   = COALESCE(k."contactName", agg."contactName"),
  "contactAvatar" = COALESCE(k."contactAvatar", agg."contactAvatar")
FROM (
  SELECT
    d."keeperId",
    SUM(c."unreadCount") AS "unread",
    MAX(c."contactName") AS "contactName",
    MAX(c."contactAvatar") AS "contactAvatar"
  FROM "_tmp_conv_dedupe" d
  JOIN "TBLCONVERSA" c ON c."id" = d."loserId"
  GROUP BY d."keeperId"
) agg
WHERE k."id" = agg."keeperId";

DELETE FROM "TBLCONVERSA" c
USING "_tmp_conv_dedupe" d
WHERE c."id" = d."loserId";

DROP TABLE IF EXISTS "_tmp_conv_dedupe";

-- ─── Índices ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "TBLFILAATENDIMENTO_doctorId_active_idx" ON "TBLFILAATENDIMENTO"("doctorId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "TBLFILAATENDIMENTO_doctorId_kind_name_key" ON "TBLFILAATENDIMENTO"("doctorId", "kind", "name");
CREATE INDEX IF NOT EXISTS "TBLFILAATENDIMENTOMEMBRO_userId_idx" ON "TBLFILAATENDIMENTOMEMBRO"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "TBLFILAATENDIMENTOMEMBRO_queueId_userId_key" ON "TBLFILAATENDIMENTOMEMBRO"("queueId", "userId");
CREATE INDEX IF NOT EXISTS "TBLCONVERSAEVENTO_conversationId_createdAt_idx" ON "TBLCONVERSAEVENTO"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "TBLCONVERSA_doctorId_attendanceStatus_lastMessageAt_idx" ON "TBLCONVERSA"("doctorId", "attendanceStatus", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "TBLCONVERSA_assignedUserId_attendanceStatus_idx" ON "TBLCONVERSA"("assignedUserId", "attendanceStatus");
CREATE INDEX IF NOT EXISTS "TBLCONVERSA_queueId_attendanceStatus_idx" ON "TBLCONVERSA"("queueId", "attendanceStatus");
CREATE INDEX IF NOT EXISTS "TBLCONVERSA_patientId_idx" ON "TBLCONVERSA"("patientId");
CREATE UNIQUE INDEX IF NOT EXISTS "TBLCONVERSA_roomId_contactPhone_key" ON "TBLCONVERSA"("roomId", "contactPhone");
CREATE INDEX IF NOT EXISTS "TBLMENSAGEM_conversationId_timestamp_idx" ON "TBLMENSAGEM"("conversationId", "timestamp");

-- ─── Foreign keys ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE "TBLFILAATENDIMENTO" ADD CONSTRAINT "TBLFILAATENDIMENTO_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "TBLUSUARIO"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLFILAATENDIMENTOMEMBRO" ADD CONSTRAINT "TBLFILAATENDIMENTOMEMBRO_queueId_fkey"
    FOREIGN KEY ("queueId") REFERENCES "TBLFILAATENDIMENTO"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLFILAATENDIMENTOMEMBRO" ADD CONSTRAINT "TBLFILAATENDIMENTOMEMBRO_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "TBLUSUARIO"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "TBLCONVERSA"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_fromQueueId_fkey"
    FOREIGN KEY ("fromQueueId") REFERENCES "TBLFILAATENDIMENTO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_toQueueId_fkey"
    FOREIGN KEY ("toQueueId") REFERENCES "TBLFILAATENDIMENTO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_fromUserId_fkey"
    FOREIGN KEY ("fromUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSAEVENTO" ADD CONSTRAINT "TBLCONVERSAEVENTO_toUserId_fkey"
    FOREIGN KEY ("toUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_doctorId_fkey"
    FOREIGN KEY ("doctorId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_roomId_fkey"
    FOREIGN KEY ("roomId") REFERENCES "TBLSALA"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_queueId_fkey"
    FOREIGN KEY ("queueId") REFERENCES "TBLFILAATENDIMENTO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_assignedUserId_fkey"
    FOREIGN KEY ("assignedUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_resolvedById_fkey"
    FOREIGN KEY ("resolvedById") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLCONVERSA" ADD CONSTRAINT "TBLCONVERSA_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "TBLPACIENTE"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "TBLMENSAGEM" ADD CONSTRAINT "TBLMENSAGEM_authorUserId_fkey"
    FOREIGN KEY ("authorUserId") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
