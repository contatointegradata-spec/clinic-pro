import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, clinicB } from './helpers.mjs'

const A = clinicA?.token

test('lista as mensagens automáticas com o estado do WhatsApp', async () => {
  const { status, data } = await api('GET', '/automations', { token: A })
  assert.equal(status, 200)
  assert.ok(data.items.length >= 8)
  for (const ev of ['APPOINTMENT_REMINDER_24H', 'PROCEDURE_RETURN_DUE', 'PATIENT_BIRTHDAY']) {
    assert.ok(data.items.some(i => i.event === ev), `faltou ${ev}`)
  }
  assert.equal(data.connection.state, 'NO_WHATSAPP')
  assert.equal(data.canEdit, true)
  assert.ok(data.items.every(i => i.enabled === false), 'tudo começa desligado')
})

test('ativar grava texto e liga a automação; desativar mantém o texto', async () => {
  const text = 'Oi {nome}! Seu retorno de {tipo_atendimento} chegou. 💕'
  const on = await api('PUT', '/automations/PROCEDURE_RETURN_DUE', { token: A, body: { enabled: true, content: text } })
  assert.equal(on.status, 200)
  assert.equal(on.data.enabled, true)

  let list = (await api('GET', '/automations', { token: A })).data
  let item = list.items.find(i => i.event === 'PROCEDURE_RETURN_DUE')
  assert.equal(item.enabled, true)
  assert.equal(item.content, text)

  await api('PUT', '/automations/PROCEDURE_RETURN_DUE', { token: A, body: { enabled: false, content: text } })
  list = (await api('GET', '/automations', { token: A })).data
  item = list.items.find(i => i.event === 'PROCEDURE_RETURN_DUE')
  assert.equal(item.enabled, false)
  assert.equal(item.content, text)

  // a outra clínica não é afetada
  const other = (await api('GET', '/automations', { token: clinicB.token })).data
  assert.equal(other.items.find(i => i.event === 'PROCEDURE_RETURN_DUE').content === text, false)
})

test('valida evento e texto', async () => {
  assert.equal((await api('PUT', '/automations/NAO_EXISTE', { token: A, body: { enabled: true, content: 'Olá {nome}' } })).status, 404)
  assert.equal((await api('PUT', '/automations/PATIENT_BIRTHDAY', { token: A, body: { enabled: true, content: '' } })).status, 400)
})
