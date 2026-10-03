import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// ─── Dados 100% fictícios para ambiente de demonstração ─────────────────────
// Nomes, CPFs e telefones abaixo são inventados — qualquer semelhança com
// pessoas reais é coincidência. Não roda sozinho em produção (só via
// `npm run prisma:seed`, não faz parte de scripts/migrate.sh).

const DEMO_PATIENTS = [
  { name: 'Ana Beatriz Fictícia', phone: '(11) 90000-0001', cpf: '000.000.000-01', birthYear: 1990 },
  { name: 'Bruno Cesar Exemplo', phone: '(11) 90000-0002', cpf: '000.000.000-02', birthYear: 1985 },
  { name: 'Carla Dias Teste', phone: '(11) 90000-0003', cpf: '000.000.000-03', birthYear: 1978 },
  { name: 'Diego Ferreira Demo', phone: '(11) 90000-0004', cpf: '000.000.000-04', birthYear: 2001 },
  { name: 'Elaine Gomes Amostra', phone: '(11) 90000-0005', cpf: '000.000.000-05', birthYear: 1995 },
  { name: 'Felipe Henrique Simulado', phone: '(11) 90000-0006', cpf: '000.000.000-06', birthYear: 1988 },
  { name: 'Gabriela Inácio Fake', phone: '(11) 90000-0007', cpf: '000.000.000-07', birthYear: 2010 },
  { name: 'Hugo Jorge Placeholder', phone: '(11) 90000-0008', cpf: '000.000.000-08', birthYear: 1965 },
  { name: 'Isabela Klein Mock', phone: '(11) 90000-0009', cpf: '000.000.000-09', birthYear: 1999 },
  { name: 'João Lima Ilustrativo', phone: '(11) 90000-0010', cpf: '000.000.000-10', birthYear: 1972 },
  { name: 'Karen Melo Exemplo', phone: '(11) 90000-0011', cpf: '000.000.000-11', birthYear: 1983 },
  { name: 'Lucas Nunes Fictício', phone: '(11) 90000-0012', cpf: '000.000.000-12', birthYear: 1992 },
]

async function main() {
  console.log('🌱 Iniciando seed ClinIQ Pro...\n')

  const adminPass = await bcrypt.hash('admin123', 10)
  await prisma.user.upsert({
    where: { email: 'admin@cliniq.com' },
    update: {},
    create: {
      name: 'Administrador',
      email: 'admin@cliniq.com',
      password: adminPass,
      role: 'ADMIN',
      phone: '(11) 99999-0000',
    },
  })

  // ── Ambiente de demonstração (médico + secretária + sala fictícios) ──
  const demoPass = await bcrypt.hash('demo12345', 10)

  const doctor = await prisma.user.upsert({
    where: { email: 'demo.medico@cliniq.com' },
    update: {},
    create: {
      name: 'Dr. Demo Silva (fictício)',
      email: 'demo.medico@cliniq.com',
      password: demoPass,
      role: 'DOCTOR',
      specialty: 'Clínico Geral',
      crm: 'CRM-00000-DEMO',
      phone: '(11) 98888-0000',
    },
  })

  const secretary = await prisma.user.upsert({
    where: { email: 'demo.secretaria@cliniq.com' },
    update: {},
    create: {
      name: 'Secretária Demo (fictícia)',
      email: 'demo.secretaria@cliniq.com',
      password: demoPass,
      role: 'SECRETARY',
      phone: '(11) 98888-0001',
    },
  })

  await prisma.doctorSecretary.upsert({
    where: { doctorId_secretaryId: { doctorId: doctor.id, secretaryId: secretary.id } },
    update: { active: true },
    create: { doctorId: doctor.id, secretaryId: secretary.id, active: true },
  })

  const room = await prisma.room.upsert({
    where: { id: 'demo-room-fictional' },
    update: {},
    create: {
      id: 'demo-room-fictional',
      doctorId: doctor.id,
      name: 'Consultório Demo (fictício)',
      cidade: 'São Paulo',
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '18:00',
      slotDurationMinutes: 30,
    },
  })

  const appointmentType = await prisma.appointmentType.upsert({
    where: { id: 'demo-apttype-consulta' },
    update: {},
    create: {
      id: 'demo-apttype-consulta',
      doctorId: doctor.id,
      name: 'Consulta (demo)',
      baseValue: 200,
    },
  })

  const paymentMethod = await prisma.paymentMethod.upsert({
    where: { id: 'demo-paymethod-pix' },
    update: {},
    create: { id: 'demo-paymethod-pix', doctorId: doctor.id, name: 'Pix (demo)', type: 'PIX' },
  })

  // ── Pacientes fictícios ──
  const patients = []
  for (const [i, p] of DEMO_PATIENTS.entries()) {
    const patient = await prisma.patient.upsert({
      where: { cpf: p.cpf },
      update: {},
      create: {
        name: p.name,
        phone: p.phone,
        cpf: p.cpf,
        email: `paciente.demo${i + 1}@exemplo.com`,
        birthDate: new Date(p.birthYear, 0, 15),
        doctorId: doctor.id,
        roomId: room.id,
        status: 'ATIVO',
        origin: 'MANUAL',
        createdByUserId: doctor.id,
      },
    })
    patients.push(patient)

    await prisma.patientConsent.upsert({
      where: { id: `demo-consent-${patient.id}` },
      update: {},
      create: {
        id: `demo-consent-${patient.id}`,
        patientId: patient.id,
        channel: 'PRESENCIAL',
        termsVersion: 'v1',
        recordedByUserId: doctor.id,
      },
    })
  }

  // ── Agendamentos (passados e futuros) ──
  const now = new Date()
  for (const [i, patient] of patients.entries()) {
    const daysOffset = (i % 2 === 0 ? -1 : 1) * (i + 1) * 2
    const date = new Date(now)
    date.setDate(date.getDate() + daysOffset)
    date.setHours(9 + (i % 8), 0, 0, 0)

    await prisma.appointment.upsert({
      where: { id: `demo-appt-${patient.id}` },
      update: {},
      create: {
        id: `demo-appt-${patient.id}`,
        patientId: patient.id,
        doctorId: doctor.id,
        createdById: doctor.id,
        roomId: room.id,
        title: `Consulta — ${patient.name}`,
        date,
        duration: 30,
        status: daysOffset < 0 ? 'COMPLETED' : 'SCHEDULED',
        type: appointmentType.name,
        value: appointmentType.baseValue,
      },
    })
  }

  // ── Alguns prontuários + lançamento financeiro (só nas consultas já concluídas) ──
  const pastPatients = patients.filter((_, i) => (i % 2 === 0))
  for (const patient of pastPatients.slice(0, 5)) {
    const record = await prisma.medicalRecord.upsert({
      where: { id: `demo-record-${patient.id}` },
      update: {},
      create: {
        id: `demo-record-${patient.id}`,
        patientId: patient.id,
        doctorId: doctor.id,
        title: 'Evolução (demo)',
        type: 'EVOLUCAO',
        content: 'Objetivo Clínico:\nPaciente fictício, dados de demonstração.\n\nSíntese:\nConsulta de rotina simulada.',
        specialtyType: 'GERAL',
        specialtyData: { objetivoClinico: 'Paciente fictício, dados de demonstração.', sintese: 'Consulta de rotina simulada.', encaminhamento: '' },
      },
    })

    await prisma.transaction.upsert({
      where: { id: `demo-tx-${patient.id}` },
      update: {},
      create: {
        id: `demo-tx-${patient.id}`,
        doctorId: doctor.id,
        medicalRecordId: record.id,
        patientId: patient.id,
        type: 'INCOME',
        amount: 200,
        description: `Consulta (demo) - ${patient.name}`,
        date: new Date(),
        paidAt: new Date(),
        status: 'PAID',
        category: 'Consulta',
        paymentMethodId: paymentMethod.id,
        paymentMethod: paymentMethod.name,
      },
    })
  }

  console.log('✅ Seed ClinIQ Pro concluído!\n')
  console.log('📋 Credenciais:')
  console.log('  Admin: admin@cliniq.com | admin123')
  console.log('  Médico (demo): demo.medico@cliniq.com | demo12345')
  console.log('  Secretária (demo): demo.secretaria@cliniq.com | demo12345\n')
  console.log(`👥 ${patients.length} pacientes fictícios criados, com agendamentos/prontuário/financeiro de exemplo.\n`)
  console.log('ℹ️  Planos de Saúde são criados por cada médico no painel de configurações.\n')
}

main()
  .catch(e => { console.error('❌ Erro no seed:', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
