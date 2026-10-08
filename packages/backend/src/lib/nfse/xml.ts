import zlib from 'node:zlib'
import { SignedXml } from 'xml-crypto'

// ─── Leiautes XML do Sistema Nacional NFS-e (v1.00) ──────────────────────────
// DPS (Declaração de Prestação de Serviço) e Pedido de Registro de Evento
// (cancelamento e101101). A ordem dos elementos segue o XSD do leiaute
// nacional (AnexoI/AnexoII do Manual dos Contribuintes) — validação final é
// feita pela Sefin; teste sempre em Produção Restrita (homologação) antes.

export const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse'
export const VER_APLIC = 'CliniQPro-1.0'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function el(tag: string, value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  return `<${tag}>${esc(String(value))}</${tag}>`
}

const onlyDigits = (v: string) => v.replace(/\D/g, '')

/** Data/hora no fuso de Brasília no formato TSDateTimeUTC (AAAA-MM-DDThh:mm:ss-03:00). */
export function brDateTime(date = new Date()): string {
  const local = new Date(date.getTime() - 3 * 60 * 60 * 1000)
  return local.toISOString().slice(0, 19) + '-03:00'
}

export function brDate(date = new Date()): string {
  return brDateTime(date).slice(0, 10)
}

/** Id da DPS: "DPS" + cMun(7) + tpInsc(1: 1=CPF, 2=CNPJ) + inscFed(14) + série(5) + nDPS(15) = 45 chars. */
export function buildIdDps(params: { codigoMunicipio: string; tipoDocumento: 'CPF' | 'CNPJ'; documento: string; serie: string; numero: number }): string {
  return 'DPS'
    + onlyDigits(params.codigoMunicipio).padStart(7, '0')
    + (params.tipoDocumento === 'CNPJ' ? '2' : '1')
    + onlyDigits(params.documento).padStart(14, '0')
    + onlyDigits(params.serie).padStart(5, '0')
    + String(params.numero).padStart(15, '0')
}

export interface DpsInput {
  idDps: string
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO'
  emitidaEm: Date
  serie: string
  numero: number
  competencia: Date
  prestador: {
    tipoDocumento: 'CPF' | 'CNPJ'
    documento: string
    inscricaoMunicipal?: string | null
    telefone?: string | null
    email?: string | null
    codigoMunicipio: string
    opcaoSimplesNacional: number
    regimeApuracaoSN?: number | null
    regimeEspecial: number
  }
  tomador?: {
    tipoDocumento: 'CPF' | 'CNPJ'
    documento: string
    nome: string
    email?: string | null
  } | null
  servico: {
    codigoTributacaoNacional: string
    codigoTributacaoMunicipal?: string | null
    codigoNbs?: string | null
    descricao: string
  }
  valorCents: number
  aliquotaIss?: number | null
  percentualTributosSN?: number | null
}

const money = (cents: number) => (cents / 100).toFixed(2)
const pct = (v: number) => v.toFixed(2)

export function buildDpsXml(d: DpsInput): string {
  const p = d.prestador
  const docTag = p.tipoDocumento === 'CNPJ' ? 'CNPJ' : 'CPF'
  // Emitente = prestador (tpEmit 1): nome/endereço do prestador NÃO são
  // informados na DPS — a Sefin usa o Cadastro Nacional de Contribuintes.
  const prest = `<prest>${el(docTag, onlyDigits(p.documento))}${el('IM', p.inscricaoMunicipal)}${el('fone', p.telefone ? onlyDigits(p.telefone) : null)}${el('email', p.email)}`
    + `<regTrib>${el('opSimpNac', p.opcaoSimplesNacional)}${p.opcaoSimplesNacional === 3 ? el('regApTribSN', p.regimeApuracaoSN ?? 1) : ''}${el('regEspTrib', p.regimeEspecial)}</regTrib></prest>`

  const t = d.tomador
  const toma = t && onlyDigits(t.documento)
    ? `<toma>${el(t.tipoDocumento === 'CNPJ' ? 'CNPJ' : 'CPF', onlyDigits(t.documento))}${el('xNome', t.nome.slice(0, 300))}${el('email', t.email)}</toma>`
    : ''

  const s = d.servico
  const serv = `<serv><locPrest>${el('cLocPrestacao', onlyDigits(p.codigoMunicipio))}</locPrest>`
    + `<cServ>${el('cTribNac', onlyDigits(s.codigoTributacaoNacional))}${el('cTribMun', s.codigoTributacaoMunicipal)}${el('xDescServ', s.descricao.slice(0, 2000))}${el('cNBS', s.codigoNbs)}</cServ></serv>`

  // ISSQN: operação tributável (1), sem retenção (1). Alíquota só quando configurada.
  const tribMun = `<tribMun>${el('tribISSQN', 1)}${el('tpRetISSQN', 1)}${d.aliquotaIss ? el('pAliq', pct(d.aliquotaIss)) : ''}</tribMun>`
  const isSN = p.opcaoSimplesNacional === 2 || p.opcaoSimplesNacional === 3
  const totTrib = isSN && d.percentualTributosSN != null
    ? `<totTrib>${el('pTotTribSN', pct(d.percentualTributosSN))}</totTrib>`
    : `<totTrib>${el('indTotTrib', 0)}</totTrib>`
  const valores = `<valores><vServPrest>${el('vServ', money(d.valorCents))}</vServPrest><trib>${tribMun}${totTrib}</trib></valores>`

  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<DPS xmlns="${NFSE_NS}" versao="1.00"><infDPS Id="${d.idDps}">`
    + el('tpAmb', d.ambiente === 'PRODUCAO' ? 1 : 2)
    + el('dhEmi', brDateTime(d.emitidaEm))
    + el('verAplic', VER_APLIC)
    + el('serie', onlyDigits(d.serie))
    + el('nDPS', d.numero)
    + el('dCompet', brDate(d.competencia))
    + el('tpEmit', 1)
    + el('cLocEmi', onlyDigits(p.codigoMunicipio))
    + prest + toma + serv + valores
    + `</infDPS></DPS>`
}

export const CANCEL_MOTIVOS: Record<string, string> = {
  '1': 'Erro na emissão',
  '2': 'Serviço não prestado',
  '9': 'Outros',
}

export function buildCancelEventXml(params: {
  ambiente: 'PRODUCAO' | 'HOMOLOGACAO'
  autorTipoDocumento: 'CPF' | 'CNPJ'
  autorDocumento: string
  chaveAcesso: string
  motivo: string
  justificativa: string
  numeroPedido?: number
}): string {
  const n = params.numeroPedido ?? 1
  const id = `PRE${params.chaveAcesso}101101${String(n).padStart(3, '0')}`
  return `<?xml version="1.0" encoding="UTF-8"?>`
    + `<pedRegEvento xmlns="${NFSE_NS}" versao="1.00"><infPedReg Id="${id}">`
    + el('tpAmb', params.ambiente === 'PRODUCAO' ? 1 : 2)
    + el('verAplic', VER_APLIC)
    + el('dhEvento', brDateTime())
    + el(params.autorTipoDocumento === 'CNPJ' ? 'CNPJAutor' : 'CPFAutor', onlyDigits(params.autorDocumento))
    + el('chNFSe', params.chaveAcesso)
    + el('nPedRegEvento', n)
    + `<e101101>${el('xDesc', 'Cancelamento de NFS-e')}${el('cMotivo', params.motivo)}${el('xMotivo', params.justificativa)}</e101101>`
    + `</infPedReg></pedRegEvento>`
}

/** Assinatura XMLDSig envelopada (RSA-SHA256, C14N) do elemento com Id (infDPS / infPedReg). */
export function signXml(xml: string, elementName: 'infDPS' | 'infPedReg', privateKeyPem: string, certificatePem: string): string {
  const xpath = `//*[local-name(.)='${elementName}']`
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certificatePem,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  })
  sig.addReference({
    xpath,
    transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  })
  sig.computeSignature(xml, { location: { reference: xpath, action: 'after' } })
  return sig.getSignedXml()
}

export function gzipB64(xml: string): string {
  return zlib.gzipSync(Buffer.from(xml, 'utf8')).toString('base64')
}

export function gunzipB64(b64: string): string {
  return zlib.gunzipSync(Buffer.from(b64, 'base64')).toString('utf8')
}

/** Lê o primeiro valor de uma tag simples (sem parser completo — só para campos de retorno). */
export function readTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)</(?:\\w+:)?${tag}>`))
  return m ? m[1] : null
}
