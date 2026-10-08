import { test } from 'node:test'
import assert from 'node:assert/strict'
import { api, clinicA, clinicB, createPatient, PNG_1PX } from './helpers.mjs'

const A = clinicA?.token
const B = clinicB?.token

test('odontograma: valida dente, registra e atualiza', async () => {
  const p = await createPatient(A)
  const bad = await api('POST', `/clinical/patients/${p.id}/dental-chart`, { token: A, body: { tooth: '19', faces: [], condition: 'CARIE' } })
  assert.equal(bad.status, 400, 'dente 19 não existe na numeração FDI')

  const ok = await api('POST', `/clinical/patients/${p.id}/dental-chart`, { token: A, body: { tooth: '36', faces: ['O', 'M'], condition: 'CARIE', status: 'PLANEJADO' } })
  assert.equal(ok.status, 201)
  const upd = await api('PUT', `/clinical/dental-chart/${ok.data.id}`, { token: A, body: { status: 'REALIZADO' } })
  assert.equal(upd.status, 200)
  assert.equal(upd.data.status, 'REALIZADO')
})

test('mapa de aplicação baixa o estoque e não deixa ficar negativo', async () => {
  const p = await createPatient(A)
  const prod = await api('POST', '/stock/products', { token: A, body: { name: 'Toxina 100U teste', unit: 'frasco', quantity: 2 } })
  assert.equal(prod.status, 201)

  const app = await api('POST', `/clinical/patients/${p.id}/applications`, {
    token: A, body: { area: 'Glabela', product: 'Toxina', productId: prod.data.id, quantity: 20, unit: 'U', lot: 'L1', stockQty: 1 },
  })
  assert.equal(app.status, 201)
  const tooMuch = await api('POST', `/clinical/patients/${p.id}/applications`, {
    token: A, body: { area: 'Testa', product: 'Toxina', productId: prod.data.id, stockQty: 5 },
  })
  assert.equal(tooMuch.status, 400)

  const products = await api('GET', '/stock/products', { token: A })
  assert.equal(products.data.find(x => x.id === prod.data.id).quantity, 1)
})

test('fotos: aceita imagem, recusa outro tipo de arquivo', async () => {
  const p = await createPatient(A)
  const ok = await api('POST', `/clinical/patients/${p.id}/photos`, { token: A, body: { image: PNG_1PX, thumbnail: PNG_1PX, category: 'ANTES' } })
  assert.equal(ok.status, 201)
  const html = await api('POST', `/clinical/patients/${p.id}/photos`, { token: A, body: { image: 'data:text/html;base64,PGgxPm9pPC9oMT4=', thumbnail: PNG_1PX } })
  assert.equal(html.status, 400)
  const list = await api('GET', `/clinical/patients/${p.id}/photos`, { token: A })
  assert.equal(list.data.length, 1)
  assert.ok(list.data[0].thumbnailUrl.startsWith('data:image/'))
})

test('isolamento: outra clínica não enxerga nada da paciente', async () => {
  const p = await createPatient(A, 'Paciente Sigilosa')
  const photo = await api('POST', `/clinical/patients/${p.id}/photos`, { token: A, body: { image: PNG_1PX, thumbnail: PNG_1PX } })
  const plan = await api('POST', `/clinical/patients/${p.id}/treatment-plans`, { token: A, body: { title: 'Plano sigiloso', items: [{ name: 'Toxina', unitPrice: 1000 }] } })

  for (const path of [
    `/patients/${p.id}`,
    `/clinical/patients/${p.id}/dental-chart`,
    `/clinical/patients/${p.id}/applications`,
    `/clinical/patients/${p.id}/photos`,
    `/clinical/photos/${photo.data.id}`,
    `/clinical/treatment-plans/${plan.data.id}`,
    `/clinical/patients/${p.id}/returns`,
  ]) {
    const r = await api('GET', path, { token: B })
    assert.ok([403, 404].includes(r.status), `${path} deveria ser bloqueado, veio ${r.status}`)
  }
  const write = await api('POST', `/clinical/patients/${p.id}/dental-chart`, { token: B, body: { tooth: '11', faces: [], condition: 'COROA' } })
  assert.equal(write.status, 404)
  const del = await api('DELETE', `/clinical/photos/${photo.data.id}`, { token: B })
  assert.equal(del.status, 404)

  const listB = await api('GET', '/clinical/treatment-plans', { token: B })
  assert.ok(!listB.data.some(x => x.id === plan.data.id))
})
