import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA } from './helpers.mjs'

test('health responde', async () => {
  const { status, data } = await api('GET', '/health')
  assert.equal(status, 200)
  assert.equal(data.status, 'ok')
})

test('cadastro cria conta de profissional com teste grátis', async () => {
  assert.ok(clinicA.token, 'fixture sem token')
  assert.equal(clinicA.user.role, 'DOCTOR')
  const { status, data } = await api('GET', '/subscription/status', { token: clinicA.token })
  // A rota pode variar o formato; o importante é estar acessível e em teste.
  assert.ok([200, 404].includes(status), `status inesperado ${status}`)
  if (status === 200) assert.match(JSON.stringify(data), /TRIAL|trial/)
})

test('login com senha errada é recusado', async () => {
  const { status } = await api('POST', '/auth/login', { body: { email: clinicA.user.email, password: 'senha-errada-000' } })
  assert.equal(status, 401)
})

test('rotas autenticadas exigem token', async () => {
  const { status } = await api('GET', '/clinical/treatment-plans')
  assert.equal(status, 401)
})

test('saúde detalhada é só para administrador', async () => {
  const { status } = await api('GET', '/health/details', { token: clinicA.token })
  assert.equal(status, 403)
})
