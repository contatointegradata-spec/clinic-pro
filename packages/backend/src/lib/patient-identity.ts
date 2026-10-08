import type { Patient, Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { comparePatientsByPriority, computePhoneKey, isLidLike, phoneVariants, toLidJid } from './phone'
import { lookupPhoneByLid, onLidMappingLearned } from './whatsapp-identity'

// ─── Identidade do paciente: deduplicação e fusão ────────────────────────────
// O mesmo telefone pode aparecer em mais de um cadastro por dois motivos bem
// diferentes, e o sistema precisa distinguir os dois:
//   1) DUPLICIDADE — a mesma pessoa cadastrada duas vezes (lead do Agente de
//      IA criado antes do cadastro manual, número com/sem o 9º dígito, LID do
//      WhatsApp no lugar do telefone...). Deve ser fundida.
//   2) TELEFONE COMPARTILHADO — mãe que marca consulta pros filhos, casal com
//      um WhatsApp só. São pessoas diferentes e NUNCA podem ser fundidas.
// Por isso a fusão automática só acontece quando é inequívoca (ver
// pickAutoMergeTarget); todo o resto aparece como "possível duplicado" em
// GET /api/patients/duplicates para alguém decidir (POST /:id/merge).

const GENERIC_NAME_EXACT = new Set(['', 'nao informado', 'contato whatsapp', 'novo contato', 'paciente', 'sem nome', 'desconhecido'])

/** Nome sem acento, minúsculo, só letras/espaço — pra comparar nomes. */
export function normalizePersonName(name: string | null | undefined): string {
  return (name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Nome placeholder (lead sem nome real): "Novo contato (...)", "Contato WhatsApp", vazio, telefone/LID. */
export function isGenericPatientName(name: string | null | undefined): boolean {
  const raw = (name || '').trim()
  if (raw.includes('@')) return true
  if (/^[\d\s()+\-.]*$/.test(raw)) return true // vazio ou só número
  const n = normalizePersonName(raw)
  if (GENERIC_NAME_EXACT.has(n)) return true
  return n.startsWith('novo contato') || n.startsWith('contato whatsapp') || n.startsWith('contato do whatsapp')
}

/**
 * "Nome parecido" = mesma pessoa provável: nomes normalizados iguais, ou um
 * contém o outro começando pelo mesmo primeiro nome ("Kelven" × "Kelven
 * Pereira da Silva"). "Maria Souza" × "Maria Silva" NÃO são parecidos.
 */
export function namesLookAlike(a: string | null | undefined, b: string | null | undefined): boolean {
  if (isGenericPatientName(a) || isGenericPatientName(b)) return false
  const na = normalizePersonName(a)
  const nb = normalizePersonName(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const ta = na.split(' ')
  const tb = nb.split(' ')
  if (ta[0] !== tb[0]) return false
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta]
  // Todos os tokens do nome curto aparecem, na ordem, no nome longo
  let i = 0
  for (const t of long) if (t === short[i]) i++
  return i === short.length
}

const LEAD_RANK: Record<string, number> = { NOVO: 1, EM_ANALISE: 2, CONVERTIDO: 3 }

/** leadStatus resultante da fusão: o mais avançado; DESCARTADO só se nenhum outro estiver vivo. */
export function mergeLeadStatus(a: string | null, b: string | null): string | null {
  const alive = [a, b].filter((s): s is string => !!s && s in LEAD_RANK)
  if (alive.length) return alive.sort((x, y) => LEAD_RANK[y] - LEAD_RANK[x])[0]
  if (a === 'DESCARTADO' || b === 'DESCARTADO') return 'DESCARTADO'
  return a ?? b ?? null
}

const STATUS_RANK: Record<string, number> = { ATIVO: 0, INCOMPLETO: 1, PRE_CADASTRO: 2, INATIVO: 3 }

export class PatientMergeError extends Error {
  constructor(message: string, public readonly status: number = 400) {
    super(message)
  }
}

/**
 * Funde o paciente `dropId` dentro de `keepId` (mesmo médico) numa transação:
 * move TODAS as relações (consultas, prontuários, avaliações, financeiro,
 * consentimentos LGPD, documentos gerados, planos, conversas do Atendimento,
 * sessão do chatbot, histórico do Agente de IA, notificações), completa os
 * campos vazios do mantido com os do removido, consolida status/leadStatus/
 * origin, registra AuditLog e apaga o removido. Retorna o paciente mantido.
 */
export async function mergePatients(
  keepId: string,
  dropId: string,
  opts: { actorUserId?: string | null; reason: string },
): Promise<Patient> {
  if (keepId === dropId) throw new PatientMergeError('Não é possível mesclar um paciente com ele mesmo.')

  return prisma.$transaction(async (tx) => {
    const [keep, drop] = await Promise.all([
      tx.patient.findUnique({ where: { id: keepId } }),
      tx.patient.findUnique({ where: { id: dropId } }),
    ])
    if (!keep || !drop) throw new PatientMergeError('Paciente não encontrado.', 404)
    if (keep.doctorId !== drop.doctorId) throw new PatientMergeError('Só é possível mesclar pacientes do mesmo médico.')
    if (keep.anonymizedAt || drop.anonymizedAt) throw new PatientMergeError('Pacientes anonimizados (LGPD) não podem ser mesclados.')

    // ── Relações 1:N simples ──
    const moved = {
      appointments: (await tx.appointment.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      medicalRecords: (await tx.medicalRecord.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      assessments: (await tx.assessment.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      transactions: (await tx.transaction.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      consents: (await tx.patientConsent.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      generatedDocuments: (await tx.generatedDocument.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      conversations: (await tx.conversation.updateMany({ where: { patientId: dropId }, data: { patientId: keepId } })).count,
      plans: 0,
    }

    // ── Planos de saúde (único por paciente+plano): o do mantido prevalece ──
    const [keepPlans, dropPlans] = await Promise.all([
      tx.patientPlan.findMany({ where: { patientId: keepId } }),
      tx.patientPlan.findMany({ where: { patientId: dropId } }),
    ])
    for (const dp of dropPlans) {
      const kp = keepPlans.find(p => p.healthPlanId === dp.healthPlanId)
      if (!kp) {
        await tx.patientPlan.update({ where: { id: dp.id }, data: { patientId: keepId } })
        moved.plans++
      } else {
        await tx.patientPlan.update({
          where: { id: kp.id },
          data: {
            value: kp.value ?? dp.value,
            walletNumber: kp.walletNumber || dp.walletNumber,
            validUntil: kp.validUntil ?? dp.validUntil,
          },
        })
        await tx.patientPlan.delete({ where: { id: dp.id } })
      }
    }

    // ── Histórico do Agente de IA (chaveado por telefone, não por id) ──
    const keepPhoneReal = !!computePhoneKey(keep.phone)
    // (lead só com LID: phone '' ou dígitos do LID, histórico sob os dígitos do LID)
    const fromPhones = [
      ...(drop.phone ? (isLidLike(drop.phone) ? [drop.phone] : phoneVariants(drop.phone)) : []),
      ...(drop.whatsappLid ? [drop.whatsappLid, drop.whatsappLid.split('@')[0]] : []),
    ].filter(ph => !!ph && ph !== keep.phone)
    if (keep.doctorId && keepPhoneReal && fromPhones.length) {
      const chatbots = await tx.lightChatbot.findMany({ where: { doctorId: keep.doctorId }, select: { id: true } })
      if (chatbots.length) {
        await tx.aiAgentMessage.updateMany({
          where: { chatbotId: { in: chatbots.map(c => c.id) }, contactPhone: { in: fromPhones } },
          data: { contactPhone: keep.phone },
        })
      }
    }

    // ── Notificações apontando pro removido ──
    await tx.notification.updateMany({ where: { entityId: dropId }, data: { entityId: keepId } })

    // ── Campos do mantido: completa os vazios com os do removido ──
    // Campos únicos (cpf, chatbotSessionId) precisam sair do removido antes.
    const takeCpf = !keep.cpf && !!drop.cpf
    const takeSession = !keep.chatbotSessionId && !!drop.chatbotSessionId
    if (takeCpf || takeSession || drop.cpf || drop.chatbotSessionId) {
      await tx.patient.update({ where: { id: dropId }, data: { cpf: null, chatbotSessionId: null } })
    }

    const keepHasRealPhone = keepPhoneReal
    const dropHasRealPhone = !!computePhoneKey(drop.phone)
    const notes = [keep.notes, drop.notes && drop.notes !== keep.notes ? drop.notes : null].filter(Boolean).join('\n')
    const statusRank = (s: string) => STATUS_RANK[s] ?? 9

    const data: Prisma.PatientUncheckedUpdateInput = {
      name: isGenericPatientName(keep.name) && !isGenericPatientName(drop.name) ? drop.name : keep.name,
      email: keep.email || drop.email,
      birthDate: keep.birthDate ?? drop.birthDate,
      cpf: keep.cpf || drop.cpf,
      rg: keep.rg || drop.rg,
      address: keep.address || drop.address,
      notes: notes || null,
      responsibleName: keep.responsibleName || drop.responsibleName,
      responsiblePhone: keep.responsiblePhone || drop.responsiblePhone,
      roomId: keep.roomId ?? drop.roomId,
      createdByUserId: keep.createdByUserId ?? drop.createdByUserId,
      completedByUserId: keep.completedByUserId ?? drop.completedByUserId,
      completedAt: keep.completedAt ?? drop.completedAt,
      chatbotSessionId: keep.chatbotSessionId ?? drop.chatbotSessionId,
      whatsappLid: keep.whatsappLid ?? drop.whatsappLid,
      active: keep.active || drop.active,
      status: statusRank(drop.status) < statusRank(keep.status) ? drop.status : keep.status,
      // Origem CHATBOT preservada: o paciente continua contando como lead
      // (convertido) nas métricas do CRM.
      origin: keep.origin === 'CHATBOT' || drop.origin === 'CHATBOT' ? 'CHATBOT' : keep.origin,
      leadStatus: mergeLeadStatus(keep.leadStatus, drop.leadStatus),
      // Lead entrou no funil na data do primeiro contato, seja qual for o cadastro mantido.
      createdAt: keep.createdAt < drop.createdAt ? keep.createdAt : drop.createdAt,
    }
    if (!keepHasRealPhone && dropHasRealPhone) data.phone = drop.phone

    const updated = await tx.patient.update({ where: { id: keepId }, data })

    await tx.auditLog.create({
      data: {
        clinicId: keep.doctorId,
        userId: opts.actorUserId || 'system',
        action: 'PATIENT_MERGED',
        description: `Paciente "${drop.name}" mesclado em "${updated.name}" (${opts.reason})`,
        metadata: {
          keepId,
          dropId,
          reason: opts.reason,
          moved,
          dropped: {
            name: drop.name,
            phone: drop.phone,
            status: drop.status,
            origin: drop.origin,
            leadStatus: drop.leadStatus,
            cpf: drop.cpf,
            email: drop.email,
            createdAt: drop.createdAt.toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    })

    await tx.patient.delete({ where: { id: dropId } })
    return updated
  }, { timeout: 30_000 })
}

// ─── Fusão automática segura ────────────────────────────────────────────────

type Candidate = Pick<Patient, 'id' | 'name' | 'status' | 'origin' | 'active' | 'createdAt' | 'doctorId' | 'phoneKey' | 'anonymizedAt'>

function isLeadLike(p: Candidate): boolean {
  return p.status === 'PRE_CADASTRO' || p.origin === 'CHATBOT'
}

/**
 * Dado um grupo de pacientes do MESMO médico com o MESMO phoneKey, devolve os
 * pares (drop → keep) que podem ser fundidos sem risco:
 *  a) lead com nome genérico ("Novo contato (...)", "Contato WhatsApp", vazio)
 *     → funde no cadastro com nome real de maior prioridade. Se o telefone tem
 *     mais de uma pessoa com nome real (família) e o lead genérico já tem
 *     consulta, não dá pra saber de quem é → não funde.
 *  b) mesmo nome normalizado (sem acento/caixa), os dois são lead
 *     (PRE_CADASTRO ou origem CHATBOT) e pelo menos um foi criado pelo
 *     chatbot/Agente de IA → funde no de maior prioridade. Dois cadastros
 *     feitos por humanos nunca são fundidos sozinhos.
 * Nomes reais diferentes NUNCA são fundidos automaticamente, e cadastros que
 * alguém confirmou como "outra pessoa" (PATIENT_DUPLICATE_CONFIRMED) ficam
 * fora da fusão automática.
 */
export function planAutoMerges(
  group: Candidate[],
  appointmentCount: Map<string, number>,
  confirmedDistinct: Set<string> = new Set(),
): Array<{ dropId: string; keepId: string; reason: string }> {
  const sorted = [...group].filter(p => !p.anonymizedAt).sort(comparePatientsByPriority)
  const plans: Array<{ dropId: string; keepId: string; reason: string }> = []
  const named = sorted.filter(p => !isGenericPatientName(p.name))
  const generic = sorted.filter(p => isGenericPatientName(p.name))

  // b) mesmo nome
  const byName = new Map<string, Candidate[]>()
  for (const p of named) {
    const k = normalizePersonName(p.name)
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const survivors: Candidate[] = []
  for (const members of byName.values()) {
    const keep = members[0]
    survivors.push(keep)
    for (const other of members.slice(1)) {
      const botMade = other.origin === 'CHATBOT' || keep.origin === 'CHATBOT'
      const confirmed = confirmedDistinct.has(other.id) || confirmedDistinct.has(keep.id)
      if (isLeadLike(other) && isLeadLike(keep) && botMade && !confirmed) plans.push({ dropId: other.id, keepId: keep.id, reason: 'auto:mesmo-telefone-mesmo-nome' })
      else survivors.push(other)
    }
  }

  // a) genéricos
  const distinctPeople = byName.size
  const target = survivors.sort(comparePatientsByPriority)[0] ?? generic[0]
  if (!target) return plans
  for (const g of generic) {
    if (g.id === target.id) continue
    if (!isLeadLike(g) || confirmedDistinct.has(g.id)) continue
    if (distinctPeople > 1 && (appointmentCount.get(g.id) ?? 0) > 0) continue
    plans.push({ dropId: g.id, keepId: target.id, reason: 'auto:lead-generico-mesmo-telefone' })
  }
  return plans
}

async function loadAppointmentCounts(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const rows = await prisma.appointment.groupBy({ by: ['patientId'], where: { patientId: { in: ids } }, _count: { _all: true } })
  return new Map(rows.map(r => [r.patientId, r._count._all]))
}

/** Pacientes que alguém cadastrou confirmando "é outra pessoa" apesar do mesmo telefone. */
async function loadConfirmedDistinct(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await prisma.auditLog.findMany({
    where: { action: 'PATIENT_DUPLICATE_CONFIRMED', OR: ids.map(id => ({ metadata: { path: ['patientId'], equals: id } })) },
    select: { metadata: true },
  })
  return new Set(rows.map(r => (r.metadata as { patientId?: string } | null)?.patientId).filter((x): x is string => !!x))
}

async function planForGroup(group: Candidate[]) {
  const ids = group.map(g => g.id)
  const [counts, confirmed] = await Promise.all([loadAppointmentCounts(ids), loadConfirmedDistinct(ids)])
  return planAutoMerges(group, counts, confirmed)
}

const CANDIDATE_SELECT = {
  id: true, name: true, status: true, origin: true, active: true, createdAt: true, doctorId: true, phoneKey: true, anonymizedAt: true,
} as const

async function executePlans(plans: Array<{ dropId: string; keepId: string; reason: string }>): Promise<number> {
  let merged = 0
  for (const plan of plans) {
    try {
      await mergePatients(plan.keepId, plan.dropId, { reason: plan.reason })
      merged++
      log('info', 'patient.auto_merged', { keepId: plan.keepId, dropId: plan.dropId, reason: plan.reason })
    } catch (err) {
      log('error', 'patient.auto_merge_failed', { keepId: plan.keepId, dropId: plan.dropId, error: (err as Error)?.message })
    }
  }
  return merged
}

/**
 * Fusão automática segura para o telefone de UM paciente (chamar logo depois
 * de criar/atualizar um lead). Idempotente. Retorna o id do paciente que
 * sobrou para esse cadastro (ele mesmo, ou aquele em que foi fundido).
 */
export async function autoMergePatientDuplicates(patientId: string): Promise<string | null> {
  const p = await prisma.patient.findUnique({ where: { id: patientId }, select: CANDIDATE_SELECT })
  if (!p) return null
  if (!p.doctorId || !p.phoneKey) return p.id
  const group = await prisma.patient.findMany({ where: { doctorId: p.doctorId, phoneKey: p.phoneKey, anonymizedAt: null }, select: CANDIDATE_SELECT })
  if (group.length < 2) return p.id
  const plans = await planForGroup(group)
  await executePlans(plans)
  return plans.find(pl => pl.dropId === p.id)?.keepId ?? p.id
}

/** Fusão automática segura em todos os grupos de telefone repetido (de um médico, ou de todos). */
export async function autoMergeAllDuplicates(doctorId?: string | null): Promise<number> {
  const groups = await prisma.patient.groupBy({
    by: ['doctorId', 'phoneKey'],
    where: { phoneKey: { not: null }, doctorId: doctorId ? doctorId : { not: null }, anonymizedAt: null },
    _count: { _all: true },
    having: { id: { _count: { gt: 1 } } },
  })
  let merged = 0
  for (const g of groups) {
    const members = await prisma.patient.findMany({ where: { doctorId: g.doctorId, phoneKey: g.phoneKey, anonymizedAt: null }, select: CANDIDATE_SELECT })
    const plans = await planForGroup(members)
    merged += await executePlans(plans)
  }
  return merged
}

// ─── Possíveis duplicados (para revisão humana) ─────────────────────────────

export type DuplicateGroup = {
  phoneKey: string
  doctorId: string | null
  kind: 'same_name' | 'shared_phone'
  patients: Array<Pick<Patient, 'id' | 'name' | 'phone' | 'status' | 'origin' | 'leadStatus' | 'cpf' | 'createdAt'> & { appointments: number }>
}

/**
 * Grupos de pacientes com o mesmo phoneKey (por médico). `same_name` = há
 * nomes parecidos (provável duplicidade, sugerir mesclar); `shared_phone` =
 * nomes diferentes (provável família — só informativo).
 */
export async function findDuplicateGroups(doctorIds: string[] | null): Promise<DuplicateGroup[]> {
  const scope = doctorIds === null ? {} : { doctorId: { in: doctorIds } }
  const keys = await prisma.patient.groupBy({
    by: ['doctorId', 'phoneKey'],
    where: { ...scope, phoneKey: { not: null }, anonymizedAt: null },
    _count: { _all: true },
    having: { id: { _count: { gt: 1 } } },
  })
  if (!keys.length) return []
  const rows = await prisma.patient.findMany({
    where: { ...scope, anonymizedAt: null, OR: keys.map(k => ({ doctorId: k.doctorId, phoneKey: k.phoneKey })) },
    select: {
      id: true, name: true, phone: true, status: true, origin: true, leadStatus: true, cpf: true, createdAt: true, active: true, doctorId: true, phoneKey: true,
      _count: { select: { appointments: true } },
    },
  })
  const groups = new Map<string, DuplicateGroup>()
  for (const r of rows.sort(comparePatientsByPriority)) {
    const k = `${r.doctorId}|${r.phoneKey}`
    const g = groups.get(k) ?? { phoneKey: r.phoneKey!, doctorId: r.doctorId, kind: 'shared_phone' as const, patients: [] }
    g.patients.push({
      id: r.id, name: r.name, phone: r.phone, status: r.status, origin: r.origin, leadStatus: r.leadStatus, cpf: r.cpf, createdAt: r.createdAt,
      appointments: r._count.appointments,
    })
    groups.set(k, g)
  }
  for (const g of groups.values()) {
    const ps = g.patients
    const similar = ps.some((a, i) => ps.some((b, j) => j > i && (namesLookAlike(a.name, b.name) || isGenericPatientName(a.name) || isGenericPatientName(b.name))))
    g.kind = similar ? 'same_name' : 'shared_phone'
  }
  return Array.from(groups.values()).sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'same_name' ? -1 : 1))
}

/**
 * Pacientes do mesmo médico com o mesmo telefone (phoneKey), excluindo
 * `excludeId`, separados em "nome parecido" (provável a mesma pessoa) e
 * "telefone compartilhado" (outra pessoa). Usado na validação do cadastro.
 */
export async function findPhoneMatches(doctorId: string | null, rawPhone: string, name: string, excludeId?: string) {
  const key = computePhoneKey(rawPhone)
  if (!key) return { similar: [] as Patient[], shared: [] as Patient[] }
  const rows = await prisma.patient.findMany({
    where: {
      ...(doctorId ? { doctorId } : { doctorId: null }),
      phoneKey: key,
      anonymizedAt: null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  })
  rows.sort(comparePatientsByPriority)
  return {
    similar: rows.filter(r => namesLookAlike(r.name, name)),
    shared: rows.filter(r => !namesLookAlike(r.name, name)),
  }
}

// ─── Leads com LID no lugar do telefone ─────────────────────────────────────

/**
 * Lead criado só com o LID do WhatsApp (sem telefone real). Se o vínculo
 * LID↔telefone já é conhecido (TBLWHATSAPPLID), troca pelo telefone real e
 * aplica a fusão automática; senão garante que o nome não exiba o LID.
 */
export async function fixLidPatient(patientId: string): Promise<void> {
  const p = await prisma.patient.findUnique({ where: { id: patientId } })
  if (!p || p.anonymizedAt) return
  const lid = p.whatsappLid ?? toLidJid(p.phone)
  if (!lid) return
  const realPhone = await lookupPhoneByLid(lid)
  const genericName = isGenericPatientName(p.name)

  if (realPhone && computePhoneKey(realPhone)) {
    const oldPhone = p.phone
    await prisma.patient.update({
      where: { id: p.id },
      data: { phone: realPhone, whatsappLid: lid, ...(genericName ? { name: 'Contato WhatsApp' } : {}) },
    })
    // Histórico do Agente de IA gravado sob os dígitos do LID passa pro telefone real
    // (leads novos têm phone '' e o histórico fica sob os dígitos do LID)
    if (p.doctorId) {
      const chatbots = await prisma.lightChatbot.findMany({ where: { doctorId: p.doctorId }, select: { id: true } })
      if (chatbots.length) {
        await prisma.aiAgentMessage.updateMany({
          where: { chatbotId: { in: chatbots.map(c => c.id) }, contactPhone: { in: [oldPhone, lid, lid.split('@')[0]].filter(x => !!x && x !== realPhone) } },
          data: { contactPhone: realPhone },
        })
      }
    }
    log('info', 'patient.lid_resolved', { patientId: p.id })
    await autoMergePatientDuplicates(p.id)
    return
  }

  const data: Prisma.PatientUpdateInput = {}
  if (!p.whatsappLid) data.whatsappLid = lid
  if (genericName && p.name !== 'Contato WhatsApp') data.name = 'Contato WhatsApp'
  if (Object.keys(data).length) await prisma.patient.update({ where: { id: p.id }, data })
}

export async function fixAllLidPatients(): Promise<number> {
  // phoneKey nulo + whatsappLid = telefone ainda não resolvido
  const rows = await prisma.patient.findMany({
    where: { anonymizedAt: null, phoneKey: null, OR: [{ whatsappLid: { not: null } }, { phone: { contains: '@lid' } }] },
    select: { id: true },
  })
  for (const r of rows) {
    await fixLidPatient(r.id).catch(err => log('error', 'patient.lid_fix_failed', { patientId: r.id, error: (err as Error)?.message }))
  }
  return rows.length
}

// Vínculo LID↔telefone aprendido agora → corrige leads que só tinham o LID.
onLidMappingLearned(async (lidJid) => {
  const rows = await prisma.patient.findMany({ where: { whatsappLid: lidJid, phoneKey: null, anonymizedAt: null }, select: { id: true } })
  for (const r of rows) await fixLidPatient(r.id)
})

// ─── Manutenção (inicialização + periódica) ─────────────────────────────────

/** Preenche phoneKey/whatsappLid de linhas antigas (escritas fora do middleware). */
export async function backfillPhoneKeys(): Promise<number> {
  const rows = await prisma.patient.findMany({
    where: { phoneKey: null, whatsappLid: null, anonymizedAt: null },
    select: { id: true, phone: true },
  })
  let updated = 0
  for (const r of rows) {
    const key = computePhoneKey(r.phone)
    const lid = toLidJid(r.phone)
    if (!key && !lid) continue
    await prisma.patient.update({ where: { id: r.id }, data: { phoneKey: key, whatsappLid: lid } })
    updated++
  }
  return updated
}

let running = false

/** Rotina idempotente: backfill de phoneKey → leads com LID → fusão automática segura. */
export async function runPatientIdentityMaintenance(): Promise<void> {
  if (running) return
  running = true
  try {
    const backfilled = await backfillPhoneKeys()
    const lidLeads = await fixAllLidPatients()
    const merged = await autoMergeAllDuplicates()
    if (backfilled || lidLeads || merged) log('info', 'patient.identity_maintenance', { backfilled, lidLeads, merged })
  } catch (err) {
    log('error', 'patient.identity_maintenance_failed', { error: (err as Error)?.message })
  } finally {
    running = false
  }
}

const INTERVAL_MS = 30 * 60 * 1000
let interval: NodeJS.Timeout | null = null

export function startPatientIdentityJobs(): void {
  if (interval) return
  setTimeout(() => { runPatientIdentityMaintenance().catch(() => {}) }, 15_000)
  interval = setInterval(() => { runPatientIdentityMaintenance().catch(() => {}) }, INTERVAL_MS)
}

function log(level: 'info' | 'error', event: string, extra: Record<string, unknown>) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, module: 'PATIENT', event, ...extra })
  if (level === 'error') console.error(line)
  else console.log(line)
}

