import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, createPatient } from './helpers.mjs'

const A = clinicA?.token
const sleep = ms => new Promise(r => setTimeout(r, ms))

test('concluir procedimento com intervalo cria retorno; reagendar marca como agendado', async () => {
  const typeName = `Toxina ${Date.now()}`
  const type = await api('POST', '/appointment-types', { token: A, body: { name: typeName, baseValue: 1200, hasReturns: false, returnIntervalDays: 120 } })
  assert.equal(type.status, 201)
  assert.equal(type.data.returnIntervalDays, 120)

  const p = await createPatient(A)
  const appt = await api('POST', '/appointments', {
    token: A,
    body: { patientId: p.id, doctorId: clinicA.user.id, title: 'Toxina', date: new Date(Date.now() - 3_600_000).toISOString(), duration: 30, type: typeName },
  })
  assert.equal(appt.status, 201)
  const done = await api('PUT', `/appointments/${appt.data.id}`, { token: A, body: { status: 'COMPLETED' } })
  assert.equal(done.status, 200)

  let returns
  for (let i = 0; i < 10; i++) {
    returns = await api('GET', `/clinical/patients/${p.id}/returns`, { token: A })
    if (returns.data.length) break
    await sleep(300)
  }
  assert.equal(returns.data.length, 1)
  const ret = returns.data[0]
  assert.equal(ret.procedureName, typeName)
  assert.equal(ret.status, 'PENDENTE')
  assert.match(ret.dueDate, /T12:00:00\.000Z$/, 'retorno é "só data" (meio-dia UTC)')
  const days = Math.round((new Date(ret.dueDate) - Date.now()) / 86_400_000)
  assert.ok(days >= 118 && days <= 121, `retorno deveria cair em ~120 dias, caiu em ${days}`)

  // concluir de novo não duplica
  await api('PUT', `/appointments/${appt.data.id}`, { token: A, body: { status: 'COMPLETED' } })
  await sleep(300)
  assert.equal((await api('GET', `/clinical/patients/${p.id}/returns`, { token: A })).data.length, 1)

  await api('POST', '/appointments', {
    token: A,
    body: { patientId: p.id, doctorId: clinicA.user.id, title: 'Retorno', date: new Date(Date.now() + 100 * 86_400_000).toISOString(), duration: 30, type: typeName },
  })
  let status
  for (let i = 0; i < 10; i++) {
    status = (await api('GET', `/clinical/patients/${p.id}/returns`, { token: A })).data[0].status
    if (status === 'AGENDADO') break
    await sleep(300)
  }
  assert.equal(status, 'AGENDADO')
})

test('retorno manual: criar, adiar e descartar', async () => {
  const p = await createPatient(A)
  const r = await api('POST', `/clinical/patients/${p.id}/returns`, { token: A, body: { procedureName: 'Limpeza semestral', dueDate: '2030-01-10' } })
  assert.equal(r.status, 201)
  const moved = await api('PATCH', `/clinical/returns/${r.data.id}`, { token: A, body: { dueDate: '2030-02-10' } })
  assert.equal(moved.data.status, 'PENDENTE')
  const discarded = await api('PATCH', `/clinical/returns/${r.data.id}`, { token: A, body: { status: 'DESCARTADO' } })
  assert.equal(discarded.data.status, 'DESCARTADO')
})
