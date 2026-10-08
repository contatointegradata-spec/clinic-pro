import { prisma } from './prisma'
import { getEffectiveDoctorId } from './secretaryAccess'
import type { AuthRequest } from '../middleware/auth'

// Escopo de médicos visível pelo usuário — mesmo padrão de patients.ts e
// medical-records.ts. null = ADMIN (sem filtro).
export async function resolveDoctorScope(req: AuthRequest): Promise<string[] | null> {
  if (req.user!.role === 'ADMIN') return null
  if (req.user!.role === 'DOCTOR') return [req.user!.userId]
  const links = await prisma.doctorSecretary.findMany({
    where: { secretaryId: req.user!.userId, active: true },
    select: { doctorId: true },
  })
  return links.map(l => l.doctorId)
}

export function doctorScopeWhere(scope: string[] | null): { doctorId?: string | { in: string[] } } {
  if (scope === null) return {}
  return { doctorId: scope.length === 1 ? scope[0] : { in: scope } }
}

// Carrega o paciente garantindo que ele pertence ao escopo do usuário.
// Retorna null tanto para "não existe" quanto para "não é seu" — a rota
// responde 404 nos dois casos para não vazar existência entre clínicas.
export async function loadPatientInScope(req: AuthRequest, patientId: string) {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { id: true, name: true, phone: true, doctorId: true },
  })
  if (!patient) return null
  const scope = await resolveDoctorScope(req)
  if (scope === null) return patient
  if (!patient.doctorId || !scope.includes(patient.doctorId)) return null
  return patient
}

// doctorId gravado nos registros clínicos: o dono do paciente; na falta dele,
// o médico efetivo do usuário (secretária → médico vinculado).
export async function recordDoctorId(req: AuthRequest, patient: { doctorId: string | null }): Promise<string> {
  if (patient.doctorId) return patient.doctorId
  return (await getEffectiveDoctorId(req)) ?? req.user!.userId
}

// Confere que um registro (com doctorId) está no escopo do usuário.
export async function inScope(req: AuthRequest, doctorId: string): Promise<boolean> {
  const scope = await resolveDoctorScope(req)
  return scope === null || scope.includes(doctorId)
}
