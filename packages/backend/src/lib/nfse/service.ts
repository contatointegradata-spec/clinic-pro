import { Nfse, NfseConfig, Prisma } from '@prisma/client'
import { prisma } from '../prisma'
import { NFSE_UNIT_PRICE_CENTS } from '../billing-config'
import { logAudit } from '../secretaryAccess'
import { decryptSecret, encryptSecret } from './crypto'
import { CertificateError, parsePfx } from './certificate'
import { SefinCredentials, SefinMessage, SefinTransportError, extractMessages, field, sefin } from './client'
import { CANCEL_MOTIVOS, buildCancelEventXml, buildDpsXml, buildIdDps, gunzipB64, gzipB64, readTag, signXml } from './xml'

// ─── Regras de negócio da NFS-e ──────────────────────────────────────────────
// Ciclo de vida de uma nota (Nfse.status):
//   PROCESSING → AUTHORIZED   (Sefin gerou a NFS-e)
//   PROCESSING → REJECTED     (Sefin rejeitou a DPS — erros de negócio; pode corrigir e emitir de novo)
//   PROCESSING → (fica)       (falha de transporte: resultado desconhecido → reconciliação por GET /dps/{id})
//   PROCESSING → ERROR        (reconciliação confirmou que a DPS nunca virou NFS-e)
//   AUTHORIZED → CANCELLED    (evento e101101 aceito)
// Regras:
// - Uma transação tem no máximo UMA nota viva (PROCESSING/AUTHORIZED).
// - Número da DPS alocado atomicamente (sem duplicidade sob concorrência).
// - Só AUTHORIZED em PRODUCAO é cobrada (R$ NFSE_UNIT_PRICE_CENTS); cancelamento não estorna.
// - Logs nunca incluem dados do tomador nem o XML.

export class NfseError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) {
    super(message)
  }
}

function log(event: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: 'info', module: 'NFSE', event, ...meta }))
}

const onlyDigits = (v: string | null | undefined) => (v ?? '').replace(/\D/g, '')

// ─── Validações de documento ─────────────────────────────────────────────────

export function isValidCpf(raw: string): boolean {
  const cpf = onlyDigits(raw)
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i)
    const r = (sum * 10) % 11
    return r === 10 ? 0 : r
  }
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10])
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = onlyDigits(raw)
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const sum = weights.reduce((acc, w, i) => acc + Number(cnpj[i]) * w, 0)
    const r = sum % 11
    return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(cnpj[12]) && calc(13) === Number(cnpj[13])
}

function docType(doc: string): 'CPF' | 'CNPJ' | null {
  const d = onlyDigits(doc)
  if (d.length === 11 && isValidCpf(d)) return 'CPF'
  if (d.length === 14 && isValidCnpj(d)) return 'CNPJ'
  return null
}

// ─── Configuração ────────────────────────────────────────────────────────────

export async function getOrCreateConfig(doctorId: string): Promise<NfseConfig> {
  return prisma.nfseConfig.upsert({ where: { doctorId }, create: { doctorId }, update: {} })
}

/** O que falta para emitir (lista vazia = pronto). */
export function configReadiness(c: NfseConfig): string[] {
  const missing: string[] = []
  const doc = onlyDigits(c.documento)
  if (!(c.tipoDocumento === 'CNPJ' ? isValidCnpj(doc) : isValidCpf(doc))) missing.push(`${c.tipoDocumento} do prestador válido`)
  if (!/^\d{7}$/.test(c.codigoMunicipio)) missing.push('Código IBGE do município (7 dígitos)')
  if (!/^\d{6}$/.test(onlyDigits(c.codigoTributacaoNacional))) missing.push('Código de tributação nacional (6 dígitos)')
  if (!c.descricaoServicoPadrao.trim()) missing.push('Descrição padrão do serviço')
  if (!/^\d{1,5}$/.test(c.serie)) missing.push('Série da DPS (1 a 5 dígitos)')
  if (!c.certPfxEnc || !c.certPasswordEnc) missing.push('Certificado digital A1 (.pfx)')
  else if (c.certValidTo && c.certValidTo.getTime() < Date.now()) missing.push('Certificado digital válido (o atual expirou)')
  return missing
}

export function configView(c: NfseConfig) {
  const { certPfxEnc, certPasswordEnc, ...rest } = c
  const certDocMismatch = Boolean(c.certDocumento && onlyDigits(c.documento) && c.certDocumento !== onlyDigits(c.documento))
  return {
    ...rest,
    aliquotaIss: c.aliquotaIss ? Number(c.aliquotaIss) : null,
    percentualTributosSN: c.percentualTributosSN ? Number(c.percentualTributosSN) : null,
    hasCertificate: Boolean(certPfxEnc && certPasswordEnc),
    certDocMismatch,
    missing: configReadiness(c),
    unitPriceCents: NFSE_UNIT_PRICE_CENTS,
  }
}

export interface ConfigInput {
  ambiente?: 'PRODUCAO' | 'HOMOLOGACAO'
  tipoDocumento?: 'CPF' | 'CNPJ'
  documento?: string
  inscricaoMunicipal?: string | null
  razaoSocial?: string
  email?: string | null
  telefone?: string | null
  codigoMunicipio?: string
  opcaoSimplesNacional?: number
  regimeApuracaoSN?: number | null
  regimeEspecial?: number
  codigoTributacaoNacional?: string
  codigoTributacaoMunicipal?: string | null
  codigoNbs?: string | null
  descricaoServicoPadrao?: string
  aliquotaIss?: number | null
  percentualTributosSN?: number | null
  serie?: string
  proximoNumero?: number
}

export async function updateConfig(doctorId: string, actorUserId: string, input: ConfigInput) {
  const current = await getOrCreateConfig(doctorId)
  const data: Prisma.NfseConfigUpdateInput = { ...input }
  if (input.documento !== undefined) data.documento = onlyDigits(input.documento)
  if (input.codigoMunicipio !== undefined) data.codigoMunicipio = onlyDigits(input.codigoMunicipio)
  if (input.codigoTributacaoNacional !== undefined) data.codigoTributacaoNacional = onlyDigits(input.codigoTributacaoNacional)
  if (input.serie !== undefined) data.serie = onlyDigits(input.serie)

  // Mudar série/numeração não pode reutilizar número já usado nessa série/ambiente.
  const ambiente = input.ambiente ?? current.ambiente
  const serie = (data.serie as string | undefined) ?? current.serie
  if (input.proximoNumero !== undefined || input.serie !== undefined || input.ambiente !== undefined) {
    const last = await prisma.nfse.aggregate({ where: { doctorId, ambiente, serie }, _max: { numeroDps: true } })
    const minNext = (last._max.numeroDps ?? 0) + 1
    const requested = input.proximoNumero ?? (input.serie !== undefined || input.ambiente !== undefined ? minNext : current.proximoNumero)
    if (requested < minNext) {
      throw new NfseError(400, `O próximo número da DPS precisa ser pelo menos ${minNext} (já existem notas até o número ${minNext - 1} na série ${serie}).`)
    }
    data.proximoNumero = requested
  }

  // Ir para PRODUÇÃO exige configuração completa.
  if (input.ambiente === 'PRODUCAO' && current.ambiente !== 'PRODUCAO') {
    const preview = { ...current, ...data } as NfseConfig
    const missing = configReadiness(preview)
    if (missing.length > 0) throw new NfseError(400, `Complete a configuração antes de ativar a produção: ${missing.join(', ')}.`, { missing })
  }

  const updated = await prisma.nfseConfig.update({ where: { doctorId }, data })
  await logAudit({ userId: actorUserId, action: 'NFSE_CONFIG_UPDATED', description: 'Configuração fiscal (NFS-e) atualizada', metadata: { doctorId, ambiente: updated.ambiente } })
  return configView(updated)
}

export async function saveCertificate(doctorId: string, actorUserId: string, pfxBase64: string, password: string) {
  const pfx = Buffer.from(pfxBase64, 'base64')
  if (pfx.length < 500 || pfx.length > 50_000) throw new NfseError(400, 'Arquivo de certificado inválido (envie o .pfx/.p12 do certificado A1).')
  let parsed
  try {
    parsed = parsePfx(pfx, password)
  } catch (err) {
    throw new NfseError(400, err instanceof CertificateError ? err.message : 'Certificado inválido.')
  }
  if (parsed.validTo.getTime() < Date.now()) throw new NfseError(400, `Este certificado expirou em ${parsed.validTo.toLocaleDateString('pt-BR')}.`)
  if (parsed.validFrom.getTime() > Date.now()) throw new NfseError(400, 'Este certificado ainda não está válido.')

  await getOrCreateConfig(doctorId)
  const updated = await prisma.nfseConfig.update({
    where: { doctorId },
    data: {
      certPfxEnc: encryptSecret(pfx),
      certPasswordEnc: encryptSecret(password),
      certSubject: parsed.subject,
      certDocumento: parsed.documento,
      certValidFrom: parsed.validFrom,
      certValidTo: parsed.validTo,
    },
  })
  await logAudit({ userId: actorUserId, action: 'NFSE_CERT_UPLOADED', description: 'Certificado A1 enviado', metadata: { doctorId, validTo: parsed.validTo.toISOString() } })
  return configView(updated)
}

export async function removeCertificate(doctorId: string, actorUserId: string) {
  await getOrCreateConfig(doctorId)
  const updated = await prisma.nfseConfig.update({
    where: { doctorId },
    data: { certPfxEnc: null, certPasswordEnc: null, certSubject: null, certDocumento: null, certValidFrom: null, certValidTo: null },
  })
  await logAudit({ userId: actorUserId, action: 'NFSE_CERT_REMOVED', description: 'Certificado A1 removido', metadata: { doctorId } })
  return configView(updated)
}

function credentials(c: NfseConfig, ambiente: 'PRODUCAO' | 'HOMOLOGACAO' = c.ambiente): SefinCredentials {
  if (!c.certPfxEnc || !c.certPasswordEnc) throw new NfseError(400, 'Envie o certificado digital A1 antes de emitir.')
  try {
    return { ambiente, pfx: decryptSecret(c.certPfxEnc), passphrase: decryptSecret(c.certPasswordEnc).toString('utf8') }
  } catch {
    throw new NfseError(400, 'Não foi possível ler o certificado salvo — envie o .pfx novamente.')
  }
}

function keyMaterial(cred: SefinCredentials) {
  return parsePfx(cred.pfx, cred.passphrase)
}

export async function testConnection(doctorId: string) {
  const c = await getOrCreateConfig(doctorId)
  if (!/^\d{7}$/.test(c.codigoMunicipio)) throw new NfseError(400, 'Informe o código IBGE do município antes de testar.')
  const cred = credentials(c)
  try {
    const res = await sefin.convenioMunicipio(cred, c.codigoMunicipio)
    const ok = res.status >= 200 && res.status < 300
    return {
      ok,
      status: res.status,
      ambiente: c.ambiente,
      message: ok
        ? 'Conexão com a Sefin Nacional OK (certificado aceito).'
        : res.status === 404
          ? 'Conectou, mas o município não foi encontrado/conveniado no Sistema Nacional NFS-e.'
          : `A Sefin respondeu com status ${res.status}.`,
      convenio: ok ? res.body : null,
      erros: ok ? [] : extractMessages(res.body),
    }
  } catch (err) {
    throw new NfseError(502, `Falha ao conectar na Sefin Nacional: ${(err as Error).message}`)
  }
}

// ─── Emissão ─────────────────────────────────────────────────────────────────

export interface EmitInput {
  transactionId?: string
  patientId?: string
  tomador?: { documento?: string | null; nome?: string; email?: string | null } | null
  valorCents?: number
  descricao?: string
  competencia?: string // YYYY-MM-DD
}

async function allocateNumber(doctorId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    UPDATE "TBLNFSECONFIG" SET "proximoNumero" = "proximoNumero" + 1, "updatedAt" = NOW()
    WHERE "doctorId" = ${doctorId}
    RETURNING "proximoNumero" - 1 AS n`
  if (!rows[0]) throw new NfseError(400, 'Configuração fiscal não encontrada.')
  return Number(rows[0].n)
}

const LIVE_STATUSES = ['PROCESSING', 'AUTHORIZED'] as const

export async function emitNfse(doctorId: string, actorUserId: string, input: EmitInput): Promise<Nfse> {
  const config = await getOrCreateConfig(doctorId)
  const missing = configReadiness(config)
  if (missing.length > 0) throw new NfseError(400, `Configuração fiscal incompleta: ${missing.join(', ')}.`, { missing })

  // Origem: transação (receita) ou avulsa
  let valorCents = input.valorCents ?? 0
  let patientId = input.patientId ?? null
  let descricao = input.descricao?.trim() || ''
  if (input.transactionId) {
    const tx = await prisma.transaction.findFirst({
      where: { id: input.transactionId, doctorId },
      include: { appointment: { select: { patientId: true } } },
    })
    if (!tx) throw new NfseError(404, 'Lançamento não encontrado.')
    if (tx.type !== 'INCOME') throw new NfseError(400, 'Só é possível emitir nota de uma receita.')
    if (tx.status === 'CANCELLED') throw new NfseError(400, 'Este lançamento está cancelado.')
    const live = await prisma.nfse.findFirst({ where: { transactionId: tx.id, status: { in: [...LIVE_STATUSES] } } })
    if (live) throw new NfseError(409, live.status === 'AUTHORIZED' ? 'Este lançamento já tem nota fiscal emitida.' : 'Já existe uma emissão em processamento para este lançamento.', { nfseId: live.id })
    valorCents = input.valorCents ?? Math.round(tx.amount * 100)
    patientId = patientId ?? tx.patientId ?? tx.appointment?.patientId ?? null
    if (!descricao) descricao = config.descricaoServicoPadrao
  }
  if (!descricao) descricao = config.descricaoServicoPadrao
  if (!Number.isInteger(valorCents) || valorCents <= 0) throw new NfseError(400, 'Informe um valor maior que zero.')
  if (valorCents > 100_000_000) throw new NfseError(400, 'Valor acima do limite permitido.')
  if (descricao.length > 2000) throw new NfseError(400, 'Descrição do serviço muito longa (máx. 2000 caracteres).')

  // Tomador: paciente vinculado (snapshot) ou informado
  const patient = patientId
    ? await prisma.patient.findFirst({ where: { id: patientId, doctorId, anonymizedAt: null }, select: { id: true, name: true, cpf: true, email: true } })
    : null
  if (patientId && !patient) throw new NfseError(404, 'Paciente não encontrado.')
  const tomadorDoc = onlyDigits(input.tomador?.documento ?? patient?.cpf ?? '')
  const tomadorNome = (input.tomador?.nome ?? patient?.name ?? '').trim()
  const tomadorEmail = (input.tomador?.email ?? patient?.email ?? '') || null
  let tomadorTipo: 'CPF' | 'CNPJ' | null = null
  if (tomadorDoc) {
    tomadorTipo = docType(tomadorDoc)
    if (!tomadorTipo) throw new NfseError(400, 'CPF/CNPJ do tomador inválido.')
    if (!tomadorNome) throw new NfseError(400, 'Informe o nome do tomador.')
  }
  if (!tomadorNome) throw new NfseError(400, 'Informe o tomador (paciente) da nota.')

  const competencia = input.competencia ? new Date(`${input.competencia}T12:00:00-03:00`) : new Date()
  if (Number.isNaN(competencia.getTime())) throw new NfseError(400, 'Data de competência inválida.')
  if (competencia.getTime() > Date.now() + 24 * 60 * 60 * 1000) throw new NfseError(400, 'A competência não pode ser futura.')

  const cred = credentials(config)
  const keys = keyMaterial(cred)
  const numero = await allocateNumber(doctorId)
  const tipoDocumento = config.tipoDocumento === 'CNPJ' ? 'CNPJ' : 'CPF'
  const idDps = buildIdDps({ codigoMunicipio: config.codigoMunicipio, tipoDocumento, documento: config.documento, serie: config.serie, numero })

  const dpsXml = signXml(buildDpsXml({
    idDps,
    ambiente: config.ambiente,
    emitidaEm: new Date(),
    serie: config.serie,
    numero,
    competencia,
    prestador: {
      tipoDocumento,
      documento: config.documento,
      inscricaoMunicipal: config.inscricaoMunicipal,
      telefone: config.telefone,
      email: config.email,
      codigoMunicipio: config.codigoMunicipio,
      opcaoSimplesNacional: config.opcaoSimplesNacional,
      regimeApuracaoSN: config.regimeApuracaoSN,
      regimeEspecial: config.regimeEspecial,
    },
    tomador: tomadorTipo ? { tipoDocumento: tomadorTipo, documento: tomadorDoc, nome: tomadorNome, email: tomadorEmail } : null,
    servico: {
      codigoTributacaoNacional: config.codigoTributacaoNacional,
      codigoTributacaoMunicipal: config.codigoTributacaoMunicipal,
      codigoNbs: config.codigoNbs,
      descricao,
    },
    valorCents,
    aliquotaIss: config.aliquotaIss ? Number(config.aliquotaIss) : null,
    percentualTributosSN: config.percentualTributosSN ? Number(config.percentualTributosSN) : null,
  }), 'infDPS', keys.privateKeyPem, keys.certificatePem)

  // Tentativas anteriores rejeitadas/erro liberam o vínculo único com a transação.
  if (input.transactionId) {
    await prisma.nfse.updateMany({ where: { transactionId: input.transactionId, status: { in: ['REJECTED', 'ERROR', 'CANCELLED'] } }, data: { transactionId: null } })
  }

  let nfse = await prisma.nfse.create({
    data: {
      doctorId,
      ambiente: config.ambiente,
      status: 'PROCESSING',
      serie: config.serie,
      numeroDps: numero,
      idDps,
      transactionId: input.transactionId ?? null,
      patientId: patient?.id ?? null,
      tomadorTipoDoc: tomadorTipo,
      tomadorDocumento: tomadorDoc || null,
      tomadorNome,
      tomadorEmail,
      valorCents,
      descricao,
      codigoTributacao: config.codigoTributacaoNacional,
      competencia,
      dpsXml,
      createdById: actorUserId,
    },
  })
  log('emit.sent', { nfseId: nfse.id, doctorId, ambiente: config.ambiente, numero })

  try {
    const res = await sefin.emitir(cred, gzipB64(dpsXml))
    nfse = await applyEmitResponse(nfse, res.status, res.body)
  } catch (err) {
    if (err instanceof SefinTransportError) {
      // Resultado desconhecido: fica PROCESSING e a reconciliação descobre.
      nfse = await prisma.nfse.update({
        where: { id: nfse.id },
        data: { mensagens: [{ codigo: null, descricao: `Sem resposta da Sefin (${err.message}). A plataforma vai consultar o resultado automaticamente.`, complemento: null }] as unknown as Prisma.InputJsonValue },
      })
      log('emit.transport_error', { nfseId: nfse.id })
    } else {
      throw err
    }
  }

  await logAudit({ userId: actorUserId, action: 'NFSE_EMITTED', description: `NFS-e ${nfse.status}`, metadata: { nfseId: nfse.id, doctorId, status: nfse.status } })
  return nfse
}

async function markAuthorized(nfse: Nfse, chave: string, nfseXml: string | null, alertas: SefinMessage[] = []): Promise<Nfse> {
  const updated = await prisma.nfse.update({
    where: { id: nfse.id },
    data: {
      status: 'AUTHORIZED',
      chaveAcesso: chave,
      nfseXml,
      numeroNfse: nfseXml ? readTag(nfseXml, 'nNFSe') : null,
      issuedAt: new Date(),
      billableCents: nfse.ambiente === 'PRODUCAO' ? NFSE_UNIT_PRICE_CENTS : 0,
      mensagens: alertas.length > 0 ? (alertas as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
    },
  })
  log('emit.authorized', { nfseId: nfse.id, ambiente: nfse.ambiente })
  return updated
}

async function applyEmitResponse(nfse: Nfse, status: number, body: unknown): Promise<Nfse> {
  const chave = field<string>(body, 'chaveAcesso')
  if (status >= 200 && status < 300 && chave) {
    const xmlB64 = field<string>(body, 'nfseXmlGZipB64')
    return markAuthorized(nfse, chave, xmlB64 ? gunzipB64(xmlB64) : null, extractMessages(body, 'alertas'))
  }
  if (status >= 400 && status < 500) {
    const erros = extractMessages(body)
    // E0014-ish "DPS já processada": a nota existe — reconcilia em vez de rejeitar.
    const duplicada = erros.some(e => /j[áa] (foi )?(processad|gerad|existe)/i.test(e.descricao))
    if (duplicada) return syncProcessing(nfse)
    log('emit.rejected', { nfseId: nfse.id, codes: erros.map(e => e.codigo) })
    return prisma.nfse.update({
      where: { id: nfse.id },
      data: { status: 'REJECTED', mensagens: (erros.length ? erros : [{ codigo: String(status), descricao: 'A Sefin rejeitou a DPS.', complemento: null }]) as unknown as Prisma.InputJsonValue },
    })
  }
  // 5xx: resultado incerto — mantém PROCESSING para reconciliar.
  return prisma.nfse.update({
    where: { id: nfse.id },
    data: { mensagens: [{ codigo: String(status), descricao: 'A Sefin está instável. A plataforma vai consultar o resultado automaticamente.', complemento: null }] as unknown as Prisma.InputJsonValue },
  })
}

/** Reconciliação: DPS enviada sem resposta conclusiva → consulta GET /dps/{id}. */
async function syncProcessing(nfse: Nfse): Promise<Nfse> {
  const config = await prisma.nfseConfig.findUnique({ where: { doctorId: nfse.doctorId } })
  if (!config) return nfse
  const cred = credentials(config, nfse.ambiente)
  try {
    const dps = await sefin.consultarDps(cred, nfse.idDps)
    const chave = field<string>(dps.body, 'chaveAcesso')
    if (dps.status >= 200 && dps.status < 300 && chave) {
      const res = await sefin.consultarNfse(cred, chave)
      const xmlB64 = field<string>(res.body, 'nfseXmlGZipB64')
      return markAuthorized(nfse, chave, xmlB64 ? gunzipB64(xmlB64) : null)
    }
    // Não encontrada há mais de 15 min → nunca virou NFS-e.
    if (dps.status === 404 && Date.now() - nfse.createdAt.getTime() > 15 * 60_000) {
      return prisma.nfse.update({
        where: { id: nfse.id },
        data: { status: 'ERROR', mensagens: [{ codigo: '404', descricao: 'A DPS não foi processada pela Sefin. Emita novamente.', complemento: null }] as unknown as Prisma.InputJsonValue },
      })
    }
  } catch (err) {
    log('sync.failed', { nfseId: nfse.id, error: (err as Error).message })
  }
  return nfse
}

export async function syncNfse(doctorId: string, id: string): Promise<Nfse> {
  const nfse = await prisma.nfse.findFirst({ where: { id, doctorId } })
  if (!nfse) throw new NfseError(404, 'Nota não encontrada.')
  if (nfse.status !== 'PROCESSING') return nfse
  return syncProcessing(nfse)
}

// ─── Cancelamento ────────────────────────────────────────────────────────────

export async function cancelNfse(doctorId: string, actorUserId: string, id: string, motivo: string, justificativa: string): Promise<Nfse> {
  const nfse = await prisma.nfse.findFirst({ where: { id, doctorId } })
  if (!nfse) throw new NfseError(404, 'Nota não encontrada.')
  if (nfse.status !== 'AUTHORIZED' || !nfse.chaveAcesso) throw new NfseError(409, 'Só é possível cancelar uma nota autorizada.')
  if (!CANCEL_MOTIVOS[motivo]) throw new NfseError(400, 'Motivo de cancelamento inválido.')
  const just = justificativa.trim()
  if (just.length < 15 || just.length > 255) throw new NfseError(400, 'A justificativa deve ter entre 15 e 255 caracteres.')

  const config = await getOrCreateConfig(doctorId)
  const cred = credentials(config, nfse.ambiente)
  const keys = keyMaterial(cred)
  const xml = signXml(buildCancelEventXml({
    ambiente: nfse.ambiente,
    autorTipoDocumento: config.tipoDocumento === 'CNPJ' ? 'CNPJ' : 'CPF',
    autorDocumento: config.documento,
    chaveAcesso: nfse.chaveAcesso,
    motivo,
    justificativa: just,
  }), 'infPedReg', keys.privateKeyPem, keys.certificatePem)

  let res
  try {
    res = await sefin.registrarEvento(cred, nfse.chaveAcesso, gzipB64(xml))
  } catch (err) {
    throw new NfseError(502, `Sem resposta da Sefin ao cancelar: ${(err as Error).message}. Tente novamente.`)
  }
  if (res.status < 200 || res.status >= 300) {
    const erros = extractMessages(res.body)
    throw new NfseError(422, erros[0]?.descricao ?? `A Sefin recusou o cancelamento (status ${res.status}).`, { erros })
  }

  const updated = await prisma.nfse.update({
    where: { id: nfse.id },
    data: { status: 'CANCELLED', cancelMotivo: motivo, cancelJustificativa: just, cancelledAt: new Date() },
  })
  await logAudit({ userId: actorUserId, action: 'NFSE_CANCELLED', description: `NFS-e cancelada (${CANCEL_MOTIVOS[motivo]})`, metadata: { nfseId: id, doctorId } })
  log('cancel.ok', { nfseId: id })
  return updated
}

// ─── DANFSe / consultas ──────────────────────────────────────────────────────

export async function getDanfse(doctorId: string, id: string): Promise<Buffer> {
  const nfse = await prisma.nfse.findFirst({ where: { id, doctorId } })
  if (!nfse?.chaveAcesso) throw new NfseError(404, 'Nota sem chave de acesso.')
  const config = await getOrCreateConfig(doctorId)
  const res = await sefin.danfse(credentials(config, nfse.ambiente), nfse.chaveAcesso).catch(err => {
    throw new NfseError(502, `Não foi possível obter o DANFSe: ${(err as Error).message}`)
  })
  if (res.status !== 200 || !res.contentType.includes('pdf')) throw new NfseError(502, `O Ambiente Nacional não retornou o DANFSe (status ${res.status}).`)
  return res.raw
}

export async function usageSummary(doctorId: string, month?: string) {
  const ref = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 7)
  const [y, m] = ref.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1, 3))
  const end = new Date(Date.UTC(y, m, 1, 3))
  const [billed, byStatus] = await Promise.all([
    prisma.nfse.aggregate({
      where: { doctorId, ambiente: 'PRODUCAO', billableCents: { gt: 0 }, issuedAt: { gte: start, lt: end } },
      _count: { _all: true },
      _sum: { billableCents: true, valorCents: true },
    }),
    prisma.nfse.groupBy({ by: ['status'], where: { doctorId, createdAt: { gte: start, lt: end } }, _count: { _all: true } }),
  ])
  return {
    month: ref,
    unitPriceCents: NFSE_UNIT_PRICE_CENTS,
    billedCount: billed._count._all,
    billedCents: billed._sum.billableCents ?? 0,
    invoicedCents: billed._sum.valorCents ?? 0,
    byStatus: Object.fromEntries(byStatus.map(s => [s.status, s._count._all])),
  }
}

// ─── Reconciliação periódica ─────────────────────────────────────────────────

let syncRunning = false
export function startNfseSyncJob(): void {
  const run = async () => {
    if (syncRunning) return
    syncRunning = true
    try {
      const pending = await prisma.nfse.findMany({
        where: { status: 'PROCESSING', createdAt: { lt: new Date(Date.now() - 2 * 60_000) } },
        take: 50,
        orderBy: { createdAt: 'asc' },
      })
      for (const n of pending) await syncProcessing(n)
    } catch (err) {
      console.error('[nfse] sync job falhou:', (err as Error)?.message)
    } finally {
      syncRunning = false
    }
  }
  setTimeout(run, 60_000)
  setInterval(run, 10 * 60_000)
}
