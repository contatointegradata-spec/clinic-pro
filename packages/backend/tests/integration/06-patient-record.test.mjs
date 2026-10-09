import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, clinicB, createPatient } from './helpers.mjs'

const A = clinicA?.token
const B = clinicB?.token

test('visão geral da ficha reúne agenda, prontuário, alertas e financeiro', async () => {
  const p = await createPatient(A, 'Ficha Completa')
  await api('POST', '/medical-records', {
    token: A,
    body: { patientId: p.id, doctorId: clinicA.user.id, type: 'ANAMNESE', title: 'Anamnese', antecedentesPessoais: 'Alergia a dipirona. Usa Xarelto. Nega diabetes.' },
  })
  const future = new Date(Date.now() + 3 * 86_400_000).toISOString()
  await api('POST', '/appointments', { token: A, body: { patientId: p.id, doctorId: clinicA.user.id, title: 'Avaliação', date: future, duration: 30 } })

  const { status, data } = await api('GET', `/clinical/patients/${p.id}/overview`, { token: A })
  assert.equal(status, 200)
  assert.equal(data.patient.id, p.id)
  assert.equal(data.upcomingAppointments.length, 1)
  assert.ok(data.recentRecords.some(r => r.type === 'ANAMNESE'))
  assert.ok(data.healthAlerts.includes('Alergia'))
  assert.ok(data.healthAlerts.includes('Anticoagulante'))
  assert.ok(!data.healthAlerts.includes('Diabetes'), '"Nega diabetes" não vira alerta')
  assert.deepEqual(Object.keys(data.financial).sort(), ['paid', 'pending'])
})

test('pagamentos e documentos da ficha respeitam a clínica', async () => {
  const p = await createPatient(A)
  assert.equal((await api('GET', `/clinical/patients/${p.id}/payments`, { token: A })).status, 200)
  assert.equal((await api('GET', `/clinical/patients/${p.id}/documents`, { token: A })).status, 200)
  for (const path of ['overview', 'payments', 'documents']) {
    assert.equal((await api('GET', `/clinical/patients/${p.id}/${path}`, { token: B })).status, 404, path)
  }
})

test('documento não pode ser gerado com paciente de outra clínica', async () => {
  const p = await createPatient(A, 'Paciente Protegida')
  const tpl = await api('POST', '/documents', { token: B, body: { name: 'Modelo B', type: 'ATESTADO', content: 'Declaro que {{paciente}} CPF {{cpf_contratante}} compareceu.' } })
  assert.ok([200, 201].includes(tpl.status), `criar modelo: ${tpl.status} ${JSON.stringify(tpl.data)}`)
  const r = await api('POST', `/documents/${tpl.data.id}/generate`, { token: B, body: { patientId: p.id } })
  assert.equal(r.status, 404)

  const own = await createPatient(B, 'Paciente da B')
  const ok = await api('POST', `/documents/${tpl.data.id}/generate`, { token: B, body: { patientId: own.id } })
  assert.equal(ok.status, 201)
  const docs = await api('GET', `/clinical/patients/${own.id}/documents`, { token: B })
  assert.equal(docs.data.length, 1)
  assert.match(docs.data[0].content, /Paciente da B/)
})

test('aniversariantes do mês', async () => {
  // "hoje" da clínica é America/Sao_Paulo (o servidor e o CI rodam em UTC)
  const br = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }))
  const month = br.getMonth() + 1
  const day = String(br.getDate()).padStart(2, '0')
  const mm = String(month).padStart(2, '0')
  const p = await createPatient(A, 'Aniversariante Hoje')
  await api('PUT', `/patients/${p.id}`, { token: A, body: { name: p.name, phone: p.phone, birthDate: `1990-${mm}-${day}`, confirmDuplicate: true } })
  const { status, data } = await api('GET', `/clinical/birthdays?month=${month}`, { token: A })
  assert.equal(status, 200)
  const me = data.patients.find(x => x.id === p.id)
  assert.ok(me, 'aniversariante deveria aparecer no mês')
  assert.equal(me.daysUntil, 0)
  const other = await api('GET', `/clinical/birthdays?month=${month}`, { token: B })
  assert.ok(!other.data.patients.some(x => x.id === p.id))
})

test('lista de pacientes traz a última consulta concluída', async () => {
  const p = await createPatient(A, 'Com Consulta')
  // Atendimento retroativo já entra como concluído (regra da agenda).
  const appt = await api('POST', '/appointments', { token: A, body: { patientId: p.id, doctorId: clinicA.user.id, title: 'Limpeza', date: new Date(Date.now() - 86_400_000).toISOString(), duration: 30, status: 'COMPLETED' } })
  assert.equal(appt.status, 201, JSON.stringify(appt.data))
  const list = await api('GET', `/patients?search=${encodeURIComponent('Com Consulta')}`, { token: A })
  const row = list.data.find(x => x.id === p.id)
  assert.equal(row.appointments.length, 1)
})
