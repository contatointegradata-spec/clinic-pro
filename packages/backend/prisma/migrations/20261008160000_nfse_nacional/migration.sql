-- Migration: nfse_nacional
-- Emissão de NFS-e pelo Emissor Público Nacional (Sefin Nacional NFS-e):
-- configuração fiscal do prestador (com certificado A1 cifrado em repouso)
-- e notas emitidas (DPS/NFS-e, status, cancelamento, cobrança por nota).
--
-- Idempotente (IF NOT EXISTS / DO ... EXCEPTION), no padrão das migrations
-- >= 20260628 que rodam via `prisma migrate deploy` (ver scripts/migrate.sh).

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "NfseAmbiente" AS ENUM ('PRODUCAO', 'HOMOLOGACAO');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "NfseStatus" AS ENUM ('PROCESSING', 'AUTHORIZED', 'REJECTED', 'CANCELLED', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TBLNFSECONFIG" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "ambiente" "NfseAmbiente" NOT NULL DEFAULT 'HOMOLOGACAO',
    "tipoDocumento" TEXT NOT NULL DEFAULT 'CPF',
    "documento" TEXT NOT NULL DEFAULT '',
    "inscricaoMunicipal" TEXT,
    "razaoSocial" TEXT NOT NULL DEFAULT '',
    "email" TEXT,
    "telefone" TEXT,
    "codigoMunicipio" TEXT NOT NULL DEFAULT '',
    "opcaoSimplesNacional" INTEGER NOT NULL DEFAULT 1,
    "regimeApuracaoSN" INTEGER,
    "regimeEspecial" INTEGER NOT NULL DEFAULT 0,
    "codigoTributacaoNacional" TEXT NOT NULL DEFAULT '040101',
    "codigoTributacaoMunicipal" TEXT,
    "codigoNbs" TEXT,
    "descricaoServicoPadrao" TEXT NOT NULL DEFAULT 'Consulta médica',
    "aliquotaIss" DECIMAL(5,2),
    "percentualTributosSN" DECIMAL(5,2),
    "serie" TEXT NOT NULL DEFAULT '1',
    "proximoNumero" INTEGER NOT NULL DEFAULT 1,
    "certPfxEnc" TEXT,
    "certPasswordEnc" TEXT,
    "certSubject" TEXT,
    "certDocumento" TEXT,
    "certValidFrom" TIMESTAMP(3),
    "certValidTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TBLNFSECONFIG_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TBLNFSE" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "ambiente" "NfseAmbiente" NOT NULL,
    "status" "NfseStatus" NOT NULL DEFAULT 'PROCESSING',
    "serie" TEXT NOT NULL,
    "numeroDps" INTEGER NOT NULL,
    "idDps" TEXT NOT NULL,
    "chaveAcesso" TEXT,
    "numeroNfse" TEXT,
    "transactionId" TEXT,
    "patientId" TEXT,
    "tomadorTipoDoc" TEXT,
    "tomadorDocumento" TEXT,
    "tomadorNome" TEXT NOT NULL,
    "tomadorEmail" TEXT,
    "valorCents" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "codigoTributacao" TEXT NOT NULL,
    "competencia" TIMESTAMP(3) NOT NULL,
    "dpsXml" TEXT,
    "nfseXml" TEXT,
    "mensagens" JSONB,
    "cancelMotivo" TEXT,
    "cancelJustificativa" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "billableCents" INTEGER NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TBLNFSE_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TBLNFSECONFIG_doctorId_key" ON "TBLNFSECONFIG"("doctorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TBLNFSE_chaveAcesso_key" ON "TBLNFSE"("chaveAcesso");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TBLNFSE_transactionId_key" ON "TBLNFSE"("transactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TBLNFSE_doctorId_status_createdAt_idx" ON "TBLNFSE"("doctorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TBLNFSE_doctorId_issuedAt_idx" ON "TBLNFSE"("doctorId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TBLNFSE_doctorId_ambiente_serie_numeroDps_key" ON "TBLNFSE"("doctorId", "ambiente", "serie", "numeroDps");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TBLNFSECONFIG" ADD CONSTRAINT "TBLNFSECONFIG_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "TBLUSUARIO"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TBLNFSE" ADD CONSTRAINT "TBLNFSE_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "TBLUSUARIO"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TBLNFSE" ADD CONSTRAINT "TBLNFSE_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "TBLUSUARIO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TBLNFSE" ADD CONSTRAINT "TBLNFSE_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "TBLTRANSACAO"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "TBLNFSE" ADD CONSTRAINT "TBLNFSE_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "TBLPACIENTE"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

