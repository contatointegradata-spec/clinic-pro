-- Migration: patient_cpf_por_medico
-- O CPF do paciente era único no sistema inteiro, então o mesmo paciente não
-- podia ser cadastrado por dois médicos diferentes (multitenant). Passa a ser
-- único por médico: (doctorId, cpf).
--
-- Seguro para os dados atuais: se o CPF já era único globalmente, também é
-- único por médico. O índice antigo pode ter qualquer um dos dois nomes
-- (criado como "Patient" na migration inicial ou como TBLPACIENTE pelo
-- `prisma db push` da produção) — os dois são removidos.
-- Idempotente (IF EXISTS / IF NOT EXISTS), no padrão das migrations >= 20260628.

DROP INDEX IF EXISTS "TBLPACIENTE_cpf_key";
DROP INDEX IF EXISTS "Patient_cpf_key";

CREATE UNIQUE INDEX IF NOT EXISTS "TBLPACIENTE_doctorId_cpf_key" ON "TBLPACIENTE"("doctorId", "cpf");
