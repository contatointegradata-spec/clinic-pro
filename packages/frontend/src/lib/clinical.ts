// Tipos, catálogos e utilitários dos recursos de odontologia e estética
// (odontograma, mapa de aplicação, fotos, orçamentos e retornos).

export interface DentalChartEntry {
  id: string
  patientId: string
  tooth: string
  faces: string[]
  condition: string
  status: 'EXISTENTE' | 'PLANEJADO' | 'REALIZADO'
  notes: string | null
  date: string
  createdAt: string
}

export interface AestheticApplication {
  id: string
  patientId: string
  date: string
  area: string
  product: string
  productId: string | null
  quantity: number | null
  unit: string | null
  lot: string | null
  technique: string | null
  notes: string | null
  createdAt: string
}

export interface PatientPhoto {
  id: string
  patientId: string
  takenAt: string
  category: 'ANTES' | 'DURANTE' | 'DEPOIS' | 'OUTRO'
  area: string | null
  procedure: string | null
  notes: string | null
  width: number | null
  height: number | null
  createdAt: string
  thumbnailUrl: string
}

export type PlanStatus = 'RASCUNHO' | 'ENVIADO' | 'APROVADO' | 'RECUSADO' | 'CONCLUIDO' | 'CANCELADO'

export interface TreatmentPlanItem {
  id: string
  appointmentTypeId: string | null
  name: string
  region: string | null
  quantity: number
  unitPrice: number
  completedQty: number
  position: number
}

export interface TreatmentPlan {
  id: string
  patientId: string
  doctorId: string
  title: string
  status: PlanStatus
  notes: string | null
  discount: number
  validUntil: string | null
  sentAt: string | null
  approvedAt: string | null
  approvedName: string | null
  approvalChannel: string | null
  rejectedAt: string | null
  createdAt: string
  updatedAt: string
  items: TreatmentPlanItem[]
  patient: { id: string; name: string; phone: string }
  subtotal: number
  total: number
  sessions: number
  sessionsDone: number
  publicUrl: string
  whatsappMessage?: string
}

export type ReturnStatus = 'PENDENTE' | 'AVISADO' | 'AGENDADO' | 'CONCLUIDO' | 'DESCARTADO'

export interface ScheduledReturn {
  id: string
  patientId: string
  procedureName: string
  appointmentTypeId: string | null
  dueDate: string
  status: ReturnStatus
  notifiedAt: string | null
  notes: string | null
  patient: { id: string; name: string; phone: string }
}

// ─── Odontograma ──────────────────────────────────────────────────────────────

// Numeração FDI, na ordem em que os dentes aparecem na tela (visão do profissional:
// direita da paciente à esquerda da tela).
export const PERMANENT_UPPER = ['18', '17', '16', '15', '14', '13', '12', '11', '21', '22', '23', '24', '25', '26', '27', '28']
export const PERMANENT_LOWER = ['48', '47', '46', '45', '44', '43', '42', '41', '31', '32', '33', '34', '35', '36', '37', '38']
export const DECIDUOUS_UPPER = ['55', '54', '53', '52', '51', '61', '62', '63', '64', '65']
export const DECIDUOUS_LOWER = ['85', '84', '83', '82', '81', '71', '72', '73', '74', '75']

export const DENTAL_FACES = [
  { key: 'V', label: 'Vestibular' },
  { key: 'L', label: 'Lingual / Palatina' },
  { key: 'M', label: 'Mesial' },
  { key: 'D', label: 'Distal' },
  { key: 'O', label: 'Oclusal / Incisal' },
] as const

// Cores alinhadas à paleta da marca (Tailwind remapeado em tailwind.config.ts).
export const DENTAL_CONDITIONS: Record<string, { label: string; fill: string; chip: string; wholeTooth?: boolean }> = {
  HIGIDO: { label: 'Hígido', fill: '#FFFFFF', chip: 'bg-white text-slate-600 border-slate-200' },
  CARIE: { label: 'Cárie', fill: '#D98B6A', chip: 'bg-amber-50 text-amber-800 border-amber-200' },
  RESTAURACAO: { label: 'Restauração', fill: '#B38B6D', chip: 'bg-sand-100 text-sand-800 border-sand-300' },
  RESTAURACAO_INSATISFATORIA: { label: 'Restauração insatisfatória', fill: '#E6AA90', chip: 'bg-amber-50 text-amber-700 border-amber-200' },
  CANAL: { label: 'Tratamento de canal', fill: '#966C8A', chip: 'bg-mauve-50 text-mauve-700 border-mauve-200', wholeTooth: true },
  COROA: { label: 'Coroa', fill: '#C9A96E', chip: 'bg-gold-50 text-gold-800 border-gold-200', wholeTooth: true },
  IMPLANTE: { label: 'Implante', fill: '#7FA38A', chip: 'bg-emerald-50 text-emerald-800 border-emerald-200', wholeTooth: true },
  PROTESE: { label: 'Prótese', fill: '#DEC48F', chip: 'bg-gold-50 text-gold-700 border-gold-200', wholeTooth: true },
  AUSENTE: { label: 'Ausente', fill: '#E8E0D8', chip: 'bg-slate-100 text-slate-500 border-slate-200', wholeTooth: true },
  EXTRACAO_INDICADA: { label: 'Extração indicada', fill: '#B76E79', chip: 'bg-primary-50 text-primary-700 border-primary-200', wholeTooth: true },
  FRATURA: { label: 'Fratura', fill: '#C07052', chip: 'bg-amber-100 text-amber-800 border-amber-300' },
  SELANTE: { label: 'Selante', fill: '#A6C3AF', chip: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  APARELHO: { label: 'Aparelho ortodôntico', fill: '#CAA6BE', chip: 'bg-mauve-50 text-mauve-700 border-mauve-200', wholeTooth: true },
  OUTRO: { label: 'Outro', fill: '#A99D93', chip: 'bg-slate-100 text-slate-600 border-slate-200' },
}

export const DENTAL_STATUS: Record<DentalChartEntry['status'], { label: string; chip: string }> = {
  EXISTENTE: { label: 'Existente', chip: 'bg-slate-100 text-slate-600' },
  PLANEJADO: { label: 'Planejado', chip: 'bg-amber-50 text-amber-700' },
  REALIZADO: { label: 'Realizado', chip: 'bg-emerald-50 text-emerald-700' },
}

// ─── Harmonização / estética ──────────────────────────────────────────────────

export const FACE_AREAS = [
  'Testa', 'Glabela', 'Pés de galinha', 'Têmporas', 'Sobrancelha', 'Olheiras',
  'Malar / maçã do rosto', 'Nariz', 'Sulco nasogeniano', 'Lábios', 'Código de barras',
  'Bigode chinês / marionete', 'Mento / queixo', 'Mandíbula', 'Pescoço', 'Colo',
  'Masseter (bruxismo)', 'Axilas (hiperidrose)', 'Abdômen', 'Glúteos', 'Coxas', 'Braços',
]

export const APPLICATION_UNITS = ['U', 'mL', 'seringa', 'fio', 'frasco', 'sessão']

export const PRODUCT_SUGGESTIONS = [
  'Toxina botulínica', 'Ácido hialurônico', 'Bioestimulador de colágeno', 'Fios de PDO',
  'Skinbooster', 'Enzima / lipo de papada', 'Peeling químico', 'Microagulhamento',
]

// Posição (em % do desenho) de cada área no mapa facial — usada para marcar
// no desenho as áreas já tratadas.
export const FACE_MAP_POINTS: Record<string, { x: number; y: number }> = {
  'Testa': { x: 50, y: 17 },
  'Glabela': { x: 50, y: 30 },
  'Pés de galinha': { x: 22, y: 40 },
  'Têmporas': { x: 20, y: 28 },
  'Sobrancelha': { x: 34, y: 30 },
  'Olheiras': { x: 36, y: 42 },
  'Malar / maçã do rosto': { x: 28, y: 52 },
  'Nariz': { x: 50, y: 50 },
  'Sulco nasogeniano': { x: 40, y: 62 },
  'Lábios': { x: 50, y: 70 },
  'Código de barras': { x: 50, y: 65 },
  'Bigode chinês / marionete': { x: 38, y: 76 },
  'Mento / queixo': { x: 50, y: 86 },
  'Mandíbula': { x: 28, y: 76 },
  'Masseter (bruxismo)': { x: 22, y: 66 },
}

// ─── Fotos ────────────────────────────────────────────────────────────────────

export const PHOTO_CATEGORIES: Record<PatientPhoto['category'], { label: string; chip: string }> = {
  ANTES: { label: 'Antes', chip: 'bg-amber-50 text-amber-700' },
  DURANTE: { label: 'Durante', chip: 'bg-gold-50 text-gold-700' },
  DEPOIS: { label: 'Depois', chip: 'bg-emerald-50 text-emerald-700' },
  OUTRO: { label: 'Outro', chip: 'bg-slate-100 text-slate-600' },
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem')) }
    img.src = url
  })
}

function drawScaled(img: HTMLImageElement, maxSide: number): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#FFFFFF'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

// ~1.33 bytes de base64 por byte; o backend aceita até 6 MB por foto, mas
// mantemos abaixo de ~1 MB para upload rápido no celular.
const TARGET_BYTES = 950 * 1024

// Redimensiona e comprime no navegador: foto até 1800px e miniatura 360px, em JPEG.
export async function prepareClinicalPhoto(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Selecione um arquivo de imagem')
  const img = await loadImage(file)
  const canvas = drawScaled(img, 1800)
  let quality = 0.86
  let image = canvas.toDataURL('image/jpeg', quality)
  while (image.length * 0.75 > TARGET_BYTES && quality > 0.5) {
    quality -= 0.08
    image = canvas.toDataURL('image/jpeg', quality)
  }
  const thumbnail = drawScaled(img, 360).toDataURL('image/jpeg', 0.78)
  return { image, thumbnail, width: canvas.width, height: canvas.height }
}

// ─── Orçamentos ───────────────────────────────────────────────────────────────

export const PLAN_STATUS: Record<PlanStatus, { label: string; chip: string }> = {
  RASCUNHO: { label: 'Rascunho', chip: 'bg-slate-100 text-slate-600' },
  ENVIADO: { label: 'Aguardando aprovação', chip: 'bg-gold-50 text-gold-700' },
  APROVADO: { label: 'Aprovado', chip: 'bg-emerald-50 text-emerald-700' },
  RECUSADO: { label: 'Recusado', chip: 'bg-amber-50 text-amber-700' },
  CONCLUIDO: { label: 'Concluído', chip: 'bg-primary-50 text-primary-700' },
  CANCELADO: { label: 'Cancelado', chip: 'bg-slate-100 text-slate-400' },
}

export const APPROVAL_CHANNEL: Record<string, string> = {
  LINK: 'pelo link',
  PRESENCIAL: 'presencialmente',
  WHATSAPP: 'pelo WhatsApp',
  TELEFONE: 'por telefone',
  OUTRO: '',
}

// ─── Retornos ─────────────────────────────────────────────────────────────────

export const RETURN_STATUS: Record<ReturnStatus, { label: string; chip: string }> = {
  PENDENTE: { label: 'Pendente', chip: 'bg-amber-50 text-amber-700' },
  AVISADO: { label: 'Paciente avisada', chip: 'bg-gold-50 text-gold-700' },
  AGENDADO: { label: 'Agendado', chip: 'bg-emerald-50 text-emerald-700' },
  CONCLUIDO: { label: 'Concluído', chip: 'bg-primary-50 text-primary-700' },
  DESCARTADO: { label: 'Descartado', chip: 'bg-slate-100 text-slate-400' },
}

// ─── Formatação ───────────────────────────────────────────────────────────────

export function brl(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Datas "só dia" vêm como meio-dia UTC — formatar em UTC evita trocar o dia.
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' })
}

export function toDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

export function todayInput(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysUntil(iso: string): number {
  const due = new Date(iso)
  const today = new Date(`${todayInput()}T12:00:00.000Z`)
  return Math.round((due.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
}

export function whatsappLink(phone: string, text: string): string {
  let digits = phone.replace(/\D/g, '')
  if (digits.length <= 11) digits = `55${digits}`
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}
