import { prisma } from '../prisma'
import { findPatientsByPhone, normalizePatientPhone } from '../phone'
import { autoMergePatientDuplicates, isGenericPatientName, namesLookAlike } from '../patient-identity'
import type { SystemAction } from './types'

// Mesmo formato usado por POST /patients/pre-register (routes/patients.ts) —
// status PRE_CADASTRO, origin CHATBOT. Reaproveita a checagem de duplicidade
// (mesmo padrão de findDuplicatePatient) direto aqui.
export const createPreScheduling: SystemAction = {
  key: 'create_pre_scheduling',
  name: 'Criar pré-agendamento',
  description: 'Registra o interesse do paciente para contato posterior da secretaria (sem confirmar horário).',
  implemented: true,
  inputs: [
    { key: 'nome', label: 'Nome', required: true },
    { key: 'telefone', label: 'Telefone', required: true },
    { key: 'cpf', label: 'CPF', required: false },
    { key: 'observacao', label: 'Observação', required: false },
    { key: 'salaId', label: 'Sala', required: false },
  ],
  outputs: [
    { key: 'preAgendamentoId', label: 'ID do pré-agendamento', required: true },
    { key: 'protocolo', label: 'Protocolo', required: true },
    { key: 'status', label: 'Status', required: true },
  ],
  async execute(ctx, input) {
    const phone = String(input.telefone ?? '').replace(/\D/g, '')
    const cpf = input.cpf ? String(input.cpf).replace(/\D/g, '') : undefined

    const name = String(input.nome ?? '').trim()

    // Mesmo telefone ≠ mesma pessoa (mãe que marca pro filho): só reaproveita
    // o cadastro com CPF igual, nome parecido, ou um lead ainda sem nome real
    // (que recebe o nome informado). Nome diferente → novo pré-cadastro.
    let duplicate = cpf ? await prisma.patient.findFirst({ where: { doctorId: ctx.doctorId, cpf } }) : null
    if (!duplicate) {
      const samePhone = await findPatientsByPhone(prisma, ctx.doctorId, phone)
      duplicate = !name || isGenericPatientName(name)
        ? samePhone[0] ?? null
        : samePhone.find(p => namesLookAlike(p.name, name)) ?? null
      if (!duplicate && name && !isGenericPatientName(name)) {
        const genericLead = samePhone.find(p => isGenericPatientName(p.name) && (p.status === 'PRE_CADASTRO' || p.origin === 'CHATBOT'))
        if (genericLead) duplicate = await prisma.patient.update({ where: { id: genericLead.id }, data: { name } })
      }
    }
    if (duplicate) {
      return {
        success: true,
        data: { preAgendamentoId: duplicate.id, protocolo: `PA-${duplicate.id.slice(0, 8).toUpperCase()}`, status: duplicate.status },
      }
    }

    const patient = await prisma.patient.create({
      data: {
        doctorId: ctx.doctorId,
        name,
        phone: normalizePatientPhone(phone),
        cpf: cpf || null,
        notes: input.observacao ? String(input.observacao) : null,
        roomId: input.salaId ? String(input.salaId) : null,
        status: 'PRE_CADASTRO',
        origin: 'CHATBOT',
        leadStatus: 'NOVO',
      },
    })
    await autoMergePatientDuplicates(patient.id).catch(() => null)

    return {
      success: true,
      data: {
        preAgendamentoId: patient.id,
        protocolo: `PA-${patient.id.slice(0, 8).toUpperCase()}`,
        status: patient.status,
      },
    }
  },
}
