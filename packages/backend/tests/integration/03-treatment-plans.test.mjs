import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, createPatient } from './helpers.mjs'

const A = clinicA?.token

test('orçamento: totais, envio, aprovação pelo link, sessões e conclusão', async () => {
  const p = await createPatient(A, 'Mariana Orcamento')
  const created = await api('POST', `/clinical/patients/${p.id}/treatment-plans`, {
    token: A,
    body: { title: 'Harmonização', discount: 100, validUntil: '2099-12-31', items: [{ name: 'Toxina', quantity: 1, unitPrice: 1200 }, { name: 'Drenagem', quantity: 3, unitPrice: 150 }] },
  })
  assert.equal(created.status, 201)
  const plan = created.data
  assert.equal(plan.subtotal, 1650)
  assert.equal(plan.total, 1550)
  assert.equal(plan.sessions, 4)

  // sessão antes de aprovar → bloqueado
  assert.equal((await api('POST', `/clinical/treatment-plan-items/${plan.items[1].id}/sessions`, { token: A, body: { delta: 1 } })).status, 409)

  const sent = await api('POST', `/clinical/treatment-plans/${plan.id}/send`, { token: A })
  assert.equal(sent.data.status, 'ENVIADO')
  assert.match(sent.data.whatsappMessage, /orcamento\//)

  const token = plan.publicUrl.split('/').pop()
  const pub = await api('GET', `/public/treatment-plans/${token}`)
  assert.equal(pub.status, 200)
  assert.equal(pub.data.total, 1550)
  assert.equal(pub.data.patient, undefined, 'a página pública não expõe dados da paciente')
  assert.ok(!JSON.stringify(pub.data).includes(p.phone), 'telefone não pode vazar no link público')

  const semAceite = await api('POST', `/public/treatment-plans/${token}/decision`, { body: { decision: 'APROVAR', name: 'Mariana Silva' } })
  assert.equal(semAceite.status, 400)
  const aprovado = await api('POST', `/public/treatment-plans/${token}/decision`, { body: { decision: 'APROVAR', name: 'Mariana Silva', accepted: true } })
  assert.equal(aprovado.status, 200)
  assert.equal(aprovado.data.status, 'APROVADO')
  const deNovo = await api('POST', `/public/treatment-plans/${token}/decision`, { body: { decision: 'RECUSAR', name: 'Mariana Silva' } })
  assert.equal(deNovo.status, 409, 'não pode responder duas vezes')

  const editar = await api('PUT', `/clinical/treatment-plans/${plan.id}`, { token: A, body: { title: 'Outro título', items: [{ name: 'x', unitPrice: 1 }] } })
  assert.equal(editar.status, 409, 'aprovado não pode ser alterado')

  let last
  for (let i = 0; i < 4; i++) {
    last = await api('POST', `/clinical/treatment-plan-items/${plan.items[1].id}/sessions`, { token: A, body: { delta: 1 } })
  }
  assert.equal(last.data.items[1].completedQty, 3, 'não passa da quantidade contratada')
  last = await api('POST', `/clinical/treatment-plan-items/${plan.items[0].id}/sessions`, { token: A, body: { delta: 1 } })
  assert.equal(last.data.status, 'CONCLUIDO')
  assert.equal(last.data.sessionsDone, 4)

  const notifs = await api('GET', '/notifications', { token: A })
  assert.match(JSON.stringify(notifs.data), /Orçamento aprovado/)
})

test('link público inválido ou cancelado não abre', async () => {
  assert.equal((await api('GET', '/public/treatment-plans/nao-existe-xxxxxxxxxxxxxxx')).status, 404)
  assert.equal((await api('GET', '/public/treatment-plans/..%2F..%2Fpatients')).status, 404)

  const p = await createPatient(A)
  const plan = (await api('POST', `/clinical/patients/${p.id}/treatment-plans`, { token: A, body: { title: 'Cancelado', items: [{ name: 'Limpeza', unitPrice: 250 }] } })).data
  await api('PATCH', `/clinical/treatment-plans/${plan.id}/status`, { token: A, body: { status: 'CANCELADO' } })
  assert.equal((await api('GET', `/public/treatment-plans/${plan.publicUrl.split('/').pop()}`)).status, 404)
})

test('orçamento vencido não pode ser aprovado', async () => {
  const p = await createPatient(A)
  const plan = (await api('POST', `/clinical/patients/${p.id}/treatment-plans`, { token: A, body: { title: 'Vencido', validUntil: '2020-01-01', items: [{ name: 'Clareamento', unitPrice: 600 }] } })).data
  const token = plan.publicUrl.split('/').pop()
  const pub = await api('GET', `/public/treatment-plans/${token}`)
  assert.equal(pub.data.expired, true)
  const r = await api('POST', `/public/treatment-plans/${token}/decision`, { body: { decision: 'APROVAR', name: 'Fulana de Tal', accepted: true } })
  assert.equal(r.status, 409)
})
