// Utilitários compartilhados pelos testes de integração (ver ../run-integration.mjs).
export const API = process.env.API_URL
const fixtures = JSON.parse(process.env.TEST_FIXTURES || '{}')
export const clinicA = fixtures.clinicA
export const clinicB = fixtures.clinicB

export async function api(method, path, { body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: res.status, data }
}

let seq = 0
export async function createPatient(token, name = 'Paciente Teste') {
  seq += 1
  const phone = `119${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`
  const { status, data } = await api('POST', '/patients', { token, body: { name: `${name} ${seq}`, phone } })
  if (status !== 201) throw new Error(`createPatient ${status} ${JSON.stringify(data)}`)
  return data
}

export function isoDay(offsetDays = 0) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10)
}

// PNG 1×1 válido — suficiente para o fluxo de fotos.
export const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
