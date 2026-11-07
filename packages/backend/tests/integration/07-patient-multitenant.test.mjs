import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, clinicB } from './helpers.mjs'

const A = clinicA?.token
const B = clinicB?.token

// CPF válido de teste diferente a cada execução (só os dígitos importam aqui).
const cpf = `9${String(Date.now()).slice(-10)}`
const phone = `119${String(Date.now()).slice(-8)}`

test('mesmo paciente (mesmo CPF e telefone) pode ser cadastrado por dois médicos', async () => {
  const a = await api('POST', '/patients', { token: A, body: { name: 'Joana Multitenant', phone, cpf } })
  assert.equal(a.status, 201, JSON.stringify(a.data))

  const b = await api('POST', '/patients', { token: B, body: { name: 'Joana Multitenant', phone, cpf } })
  assert.equal(b.status, 201, `segundo médico deveria conseguir cadastrar: ${JSON.stringify(b.data)}`)
  assert.notEqual(a.data.id, b.data.id, 'cada médico tem o seu cadastro')

  // Cada um enxerga só o seu
  assert.equal((await api('GET', `/patients/${b.data.id}`, { token: A })).status, 403)
  assert.equal((await api('GET', `/patients/${a.data.id}`, { token: B })).status, 403)
})

test('CPF repetido dentro do MESMO médico continua bloqueado, com mensagem clara', async () => {
  const dup = await api('POST', '/patients', { token: A, body: { name: 'Outra Pessoa', phone: '11988887777', cpf } })
  assert.equal(dup.status, 409)
  assert.equal(dup.data.code, 'PATIENT_CPF_DUPLICATE')
  assert.match(dup.data.message, /CPF/)
})

test('pré-cadastro do mesmo CPF em outro médico não quebra', async () => {
  const cpf2 = `8${String(Date.now()).slice(-10)}`
  const a = await api('POST', '/patients/pre-register', { token: A, body: { name: 'Carla Pre', phone: '11977776666', cpf: cpf2 } })
  assert.equal(a.status, 201, JSON.stringify(a.data))
  const b = await api('POST', '/patients/pre-register', { token: B, body: { name: 'Carla Pre', phone: '11977776666', cpf: cpf2 } })
  assert.equal(b.status, 201, `pré-cadastro no segundo médico: ${JSON.stringify(b.data)}`)
})

test('editar paciente para um CPF já usado no mesmo médico devolve 409 (não 500)', async () => {
  const other = await api('POST', '/patients', { token: A, body: { name: 'Paulo Edicao', phone: '11966665555' } })
  assert.equal(other.status, 201)
  const upd = await api('PUT', `/patients/${other.data.id}`, { token: A, body: { name: 'Paulo Edicao', phone: '11966665555', cpf } })
  assert.equal(upd.status, 409, JSON.stringify(upd.data))
  assert.equal(upd.data.code, 'PATIENT_CPF_DUPLICATE')
})
