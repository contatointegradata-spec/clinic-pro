<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { format } from 'date-fns'
import {
  FileCheck2, Search, RefreshCw, Download, FileDown, XCircle, ShieldCheck, Upload, Trash2, Plug, AlertTriangle, Receipt,
} from 'lucide-vue-next'
import api from '../../lib/api'
import toast from '../../lib/toast'
import { useQuery } from '../../composables/useQuery'
import type { Nfse, NfseConfig, NfseStatus, NfseUsage, Patient } from '../../types'
import Modal from '../../components/ui/Modal.vue'
import PageHeader from '../../components/ui/PageHeader.vue'
import EmitirNotaModal from '../../components/Financial/EmitirNotaModal.vue'
import { NFSE_STATUS, apiError, centsToBRL, formatDoc } from '../../components/Financial/nfse'

const route = useRoute()
const router = useRouter()
const tab = ref<'notas' | 'config'>(route.query.tab === 'config' ? 'config' : 'notas')
watch(tab, t => router.replace({ query: { ...route.query, tab: t === 'config' ? 'config' : undefined } }))

// ─── Notas ───────────────────────────────────────────────────────────
const status = ref<NfseStatus | ''>('')
const search = ref('')
const debounced = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
watch(search, v => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { debounced.value = v }, 300) })

const { data: list, isLoading, refetch: refetchList } = useQuery<{ items: Nfse[]; total: number }>({
  key: computed(() => `nfse-list-${status.value}-${debounced.value}`),
  queryFn: () => api.get('/nfse/invoices', { params: { ...(status.value && { status: status.value }), ...(debounced.value && { search: debounced.value }) } }).then(r => r.data),
})
const items = computed(() => list.value?.items ?? [])

const { data: usage, refetch: refetchUsage } = useQuery<NfseUsage>({
  key: 'nfse-usage',
  queryFn: () => api.get('/nfse/usage').then(r => r.data),
})

const { data: patientsRaw } = useQuery<Patient[]>({ key: 'patients', queryFn: () => api.get('/patients').then(r => r.data) })
const patients = computed<Patient[]>(() => patientsRaw.value ?? [])

const emitOpen = ref(false)
async function refreshAll() {
  await Promise.all([refetchList(), refetchUsage()])
}

// Detalhe
const detail = ref<Nfse | null>(null)
const busy = ref(false)
async function openDetail(id: string) {
  try {
    detail.value = (await api.get<Nfse>(`/nfse/invoices/${id}`)).data
  } catch (e) {
    toast.error(apiError(e, 'Nota não encontrada'))
  }
}
onMounted(() => { if (typeof route.query.nota === 'string') openDetail(route.query.nota) })

async function sync() {
  if (!detail.value) return
  busy.value = true
  try {
    detail.value = (await api.post<Nfse>(`/nfse/invoices/${detail.value.id}/sync`)).data
    toast(detail.value.status === 'PROCESSING' ? 'Ainda sem confirmação da Sefin.' : `Situação: ${NFSE_STATUS[detail.value.status].label}`)
    await refreshAll()
  } catch (e) {
    toast.error(apiError(e, 'Falha ao consultar'))
  } finally {
    busy.value = false
  }
}

async function download(kind: 'xml' | 'danfse') {
  if (!detail.value) return
  busy.value = true
  try {
    const res = await api.get(`/nfse/invoices/${detail.value.id}/${kind}`, { responseType: 'blob' })
    const url = URL.createObjectURL(res.data as Blob)
    if (kind === 'danfse') window.open(url, '_blank')
    else {
      const a = document.createElement('a')
      a.href = url
      a.download = `${detail.value.chaveAcesso ?? detail.value.idDps}.xml`
      a.click()
    }
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch {
    toast.error(kind === 'danfse' ? 'DANFSe indisponível no momento' : 'XML indisponível')
  } finally {
    busy.value = false
  }
}

const cancelOpen = ref(false)
const cancelMotivo = ref<'1' | '2' | '9'>('1')
const cancelJust = ref('')
async function confirmCancel() {
  if (!detail.value) return
  busy.value = true
  try {
    detail.value = (await api.post<Nfse>(`/nfse/invoices/${detail.value.id}/cancel`, { motivo: cancelMotivo.value, justificativa: cancelJust.value })).data
    cancelOpen.value = false
    cancelJust.value = ''
    toast.success('Nota cancelada')
    await refreshAll()
  } catch (e) {
    toast.error(apiError(e, 'Não foi possível cancelar'))
  } finally {
    busy.value = false
  }
}

// ─── Configuração ────────────────────────────────────────────────────
const config = ref<NfseConfig | null>(null)
const form = ref<Partial<NfseConfig>>({})
const savingConfig = ref(false)

async function loadConfig() {
  try {
    config.value = (await api.get<NfseConfig>('/nfse/config')).data
    form.value = { ...config.value }
  } catch (e) {
    toast.error(apiError(e, 'Não foi possível carregar a configuração'))
  }
}
onMounted(loadConfig)

const ready = computed(() => (config.value?.missing.length ?? 1) === 0)

async function saveConfig() {
  savingConfig.value = true
  try {
    const f = form.value
    const payload = {
      tipoDocumento: f.tipoDocumento,
      documento: f.documento ?? '',
      inscricaoMunicipal: f.inscricaoMunicipal || null,
      razaoSocial: f.razaoSocial ?? '',
      email: f.email || null,
      telefone: f.telefone || null,
      ...(f.codigoMunicipio ? { codigoMunicipio: f.codigoMunicipio.replace(/\D/g, '') } : {}),
      opcaoSimplesNacional: Number(f.opcaoSimplesNacional),
      regimeApuracaoSN: Number(f.opcaoSimplesNacional) === 3 ? Number(f.regimeApuracaoSN ?? 1) : null,
      regimeEspecial: Number(f.regimeEspecial ?? 0),
      codigoTributacaoNacional: f.codigoTributacaoNacional,
      codigoTributacaoMunicipal: f.codigoTributacaoMunicipal || null,
      descricaoServicoPadrao: f.descricaoServicoPadrao,
      aliquotaIss: f.aliquotaIss === null || f.aliquotaIss === undefined || String(f.aliquotaIss) === '' ? null : Number(f.aliquotaIss),
      percentualTributosSN: f.percentualTributosSN === null || f.percentualTributosSN === undefined || String(f.percentualTributosSN) === '' ? null : Number(f.percentualTributosSN),
      serie: f.serie,
      ...(f.proximoNumero !== config.value?.proximoNumero ? { proximoNumero: Number(f.proximoNumero) } : {}),
    }
    config.value = (await api.put<NfseConfig>('/nfse/config', payload)).data
    form.value = { ...config.value }
    toast.success('Configuração salva')
  } catch (e) {
    toast.error(apiError(e, 'Erro ao salvar'))
  } finally {
    savingConfig.value = false
  }
}

async function setAmbiente(ambiente: 'PRODUCAO' | 'HOMOLOGACAO') {
  if (ambiente === 'PRODUCAO' && !confirm(`Ativar PRODUÇÃO? As notas passam a ter valor fiscal e cada nota autorizada custa ${centsToBRL(config.value?.unitPriceCents ?? 20)}.`)) return
  try {
    config.value = (await api.put<NfseConfig>('/nfse/config', { ambiente })).data
    form.value = { ...config.value }
    toast.success(ambiente === 'PRODUCAO' ? 'Produção ativada' : 'Homologação ativada')
  } catch (e) {
    toast.error(apiError(e, 'Não foi possível trocar o ambiente'))
  }
}

const certFile = ref<File | null>(null)
const certPassword = ref('')
const uploading = ref(false)
async function uploadCert() {
  if (!certFile.value || !certPassword.value) return
  uploading.value = true
  try {
    const buf = new Uint8Array(await certFile.value.arrayBuffer())
    let bin = ''
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i])
    config.value = (await api.post<NfseConfig>('/nfse/config/certificate', { pfxBase64: btoa(bin), password: certPassword.value })).data
    form.value = { ...config.value }
    certFile.value = null
    certPassword.value = ''
    toast.success('Certificado salvo com segurança')
  } catch (e) {
    toast.error(apiError(e, 'Certificado inválido'))
  } finally {
    uploading.value = false
  }
}

async function removeCert() {
  if (!confirm('Remover o certificado digital? A emissão fica bloqueada até enviar outro.')) return
  try {
    config.value = (await api.delete<NfseConfig>('/nfse/config/certificate')).data
    form.value = { ...config.value }
  } catch (e) {
    toast.error(apiError(e, 'Erro ao remover'))
  }
}

const testing = ref(false)
async function testConn() {
  testing.value = true
  try {
    const { data } = await api.post<{ ok: boolean; message: string }>('/nfse/config/test')
    if (data.ok) toast.success(data.message)
    else toast.error(data.message)
  } catch (e) {
    toast.error(apiError(e, 'Falha no teste'))
  } finally {
    testing.value = false
  }
}

const fmtDate = (d: string | null | undefined, f = 'dd/MM/yyyy') => (d ? format(new Date(d), f) : '—')
const MOTIVOS = { '1': 'Erro na emissão', '2': 'Serviço não prestado', '9': 'Outros' } as const
</script>

<template>
  <div class="space-y-6 page-stagger">
    <PageHeader title="Notas fiscais" subtitle="NFS-e pelo Emissor Nacional (Sefin Nacional)">
      <template #actions>
        <button v-if="tab === 'notas'" class="btn-primary" @click="emitOpen = true"><FileCheck2 class="w-4 h-4" /> Emitir nota</button>
      </template>
    </PageHeader>

    <div class="flex items-center justify-between gap-3 flex-wrap">
      <div class="seg-control">
        <button class="seg-btn px-4" :class="{ active: tab === 'notas' }" @click="tab = 'notas'">Notas</button>
        <button class="seg-btn px-4" :class="{ active: tab === 'config' }" @click="tab = 'config'">
          Configuração <span v-if="config && !ready" class="ml-1 w-1.5 h-1.5 inline-block rounded-full bg-amber-500" />
        </button>
      </div>
      <span v-if="config" class="text-xs px-2.5 py-1 rounded-full font-medium" :class="config.ambiente === 'PRODUCAO' ? 'bg-emerald-50 text-emerald-700' : 'bg-sky-50 text-sky-700'">
        {{ config.ambiente === 'PRODUCAO' ? 'Produção' : 'Homologação (sem valor fiscal)' }}
      </span>
    </div>

    <!-- ─── Notas ─────────────────────────────────────────────── -->
    <template v-if="tab === 'notas'">
      <div v-if="config && !ready" class="card py-3 flex items-center gap-3 bg-amber-50/60 ring-1 ring-amber-200">
        <AlertTriangle class="w-4 h-4 text-amber-600 flex-shrink-0" />
        <p class="text-sm text-amber-800 flex-1">Para emitir, complete: {{ config.missing.join(', ') }}.</p>
        <button class="btn-secondary text-xs" @click="tab = 'config'">Configurar</button>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Autorizadas no mês</p>
          <p class="text-lg font-bold text-slate-900 tabular-nums">{{ usage?.byStatus.AUTHORIZED ?? 0 }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Valor faturado</p>
          <p class="text-lg font-bold text-emerald-600 tabular-nums">{{ centsToBRL(usage?.invoicedCents ?? 0) }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Custo de emissão</p>
          <p class="text-lg font-bold text-slate-900 tabular-nums">{{ centsToBRL(usage?.billedCents ?? 0) }}</p>
          <p class="text-[11px] text-slate-400">{{ usage?.billedCount ?? 0 }} × {{ centsToBRL(usage?.unitPriceCents ?? 20) }}</p>
        </div>
        <div class="card py-3">
          <p class="text-xs text-slate-500 uppercase tracking-wide mb-1">Com pendência</p>
          <p class="text-lg font-bold text-amber-600 tabular-nums">{{ (usage?.byStatus.REJECTED ?? 0) + (usage?.byStatus.PROCESSING ?? 0) + (usage?.byStatus.ERROR ?? 0) }}</p>
        </div>
      </div>

      <div class="card py-4">
        <div class="flex flex-wrap items-center gap-3">
          <div class="relative flex-1 min-w-[200px]">
            <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input v-model="search" class="input-field pl-9" placeholder="Tomador, CPF/CNPJ, número ou chave" />
          </div>
          <select v-model="status" class="input-field py-2 text-sm w-auto">
            <option value="">Status: todos</option>
            <option v-for="(s, k) in NFSE_STATUS" :key="k" :value="k">{{ s.label }}</option>
          </select>
        </div>
      </div>

      <div class="card p-0 overflow-hidden">
        <div v-if="isLoading" class="py-16 flex justify-center">
          <div class="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
        </div>
        <div v-else-if="items.length === 0" class="empty-state py-14">
          <div class="w-14 h-14 bg-slate-100 rounded-2xl flex items-center justify-center mb-3"><Receipt class="w-7 h-7 text-slate-300" /></div>
          <p class="text-slate-500 font-semibold">Nenhuma nota ainda</p>
          <p class="text-slate-400 text-sm mt-1">Emita pelo Fluxo de caixa (em uma receita) ou como nota avulsa.</p>
        </div>
        <div v-else class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="bg-slate-50/80 border-b border-slate-200">
                <th class="table-head-cell">Nº</th>
                <th class="table-head-cell">Tomador</th>
                <th class="table-head-cell hidden md:table-cell">Emissão</th>
                <th class="table-head-cell text-right">Valor</th>
                <th class="table-head-cell">Status</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="n in items" :key="n.id" class="table-row cursor-pointer" @click="openDetail(n.id)">
                <td class="table-cell tabular-nums text-slate-700 whitespace-nowrap">
                  {{ n.numeroNfse ?? `DPS ${n.numeroDps}` }}
                  <span v-if="n.ambiente === 'HOMOLOGACAO'" class="ml-1 text-[10px] text-sky-600">homolog.</span>
                </td>
                <td class="table-cell max-w-[260px]">
                  <p class="text-sm font-medium text-slate-900 truncate">{{ n.tomadorNome }}</p>
                  <p class="text-xs text-slate-400">{{ formatDoc(n.tomadorDocumento) || 'Sem documento' }}</p>
                </td>
                <td class="table-cell hidden md:table-cell text-slate-600 tabular-nums">{{ fmtDate(n.issuedAt ?? n.createdAt) }}</td>
                <td class="table-cell text-right font-semibold tabular-nums">{{ centsToBRL(n.valorCents) }}</td>
                <td class="table-cell">
                  <span class="status-badge gap-1.5" :class="NFSE_STATUS[n.status].cls"><span class="w-1.5 h-1.5 rounded-full" :class="NFSE_STATUS[n.status].dot" />{{ NFSE_STATUS[n.status].label }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ─── Configuração ──────────────────────────────────────── -->
    <template v-else-if="config">
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <form class="card xl:col-span-2 space-y-5" @submit.prevent="saveConfig">
          <div>
            <h2 class="font-semibold text-slate-900">Prestador</h2>
            <p class="text-xs text-slate-400">Precisa estar cadastrado no Emissor Nacional (gov.br/nfse) e o município ser conveniado.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="label">Tipo</label>
              <select v-model="form.tipoDocumento" class="input-field"><option value="CPF">CPF (autônomo)</option><option value="CNPJ">CNPJ</option></select>
            </div>
            <div class="sm:col-span-2">
              <label class="label">{{ form.tipoDocumento }} *</label>
              <input v-model="form.documento" class="input-field" inputmode="numeric" />
            </div>
            <div class="sm:col-span-2">
              <label class="label">Nome / Razão social</label>
              <input v-model="form.razaoSocial" class="input-field" />
            </div>
            <div>
              <label class="label">Inscrição municipal</label>
              <input v-model="form.inscricaoMunicipal" class="input-field" />
            </div>
            <div>
              <label class="label">Município (código IBGE) *</label>
              <input v-model="form.codigoMunicipio" class="input-field" inputmode="numeric" maxlength="7" placeholder="Ex.: 3170206" />
            </div>
            <div>
              <label class="label">E-mail</label>
              <input v-model="form.email" type="email" class="input-field" />
            </div>
            <div>
              <label class="label">Telefone</label>
              <input v-model="form.telefone" class="input-field" />
            </div>
          </div>

          <div class="border-t border-slate-100 pt-5">
            <h2 class="font-semibold text-slate-900">Tributação</h2>
            <p class="text-xs text-slate-400">Confirme com seu contador. Os valores entram em toda nota emitida.</p>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label class="label">Simples Nacional</label>
              <select v-model.number="form.opcaoSimplesNacional" class="input-field">
                <option :value="1">Não optante</option>
                <option :value="2">MEI</option>
                <option :value="3">ME/EPP</option>
              </select>
            </div>
            <div v-if="Number(form.opcaoSimplesNacional) === 3">
              <label class="label">Apuração (ME/EPP)</label>
              <select v-model.number="form.regimeApuracaoSN" class="input-field">
                <option :value="1">Tributos federais e municipal pelo SN</option>
                <option :value="2">Federais pelo SN, ISSQN fora do SN</option>
                <option :value="3">Federais e municipal fora do SN</option>
              </select>
            </div>
            <div>
              <label class="label">Regime especial</label>
              <select v-model.number="form.regimeEspecial" class="input-field">
                <option :value="0">Nenhum</option>
                <option :value="1">Ato cooperado</option>
                <option :value="2">Estimativa</option>
                <option :value="3">Microempresa municipal</option>
                <option :value="4">Notário ou registrador</option>
                <option :value="5">Profissional autônomo</option>
                <option :value="6">Sociedade de profissionais</option>
              </select>
            </div>
            <div>
              <label class="label">Cód. tributação nacional *</label>
              <input v-model="form.codigoTributacaoNacional" class="input-field" placeholder="040101 (medicina)" />
            </div>
            <div>
              <label class="label">Cód. tributação municipal</label>
              <input v-model="form.codigoTributacaoMunicipal" class="input-field" placeholder="Opcional" />
            </div>
            <div>
              <label class="label">Alíquota ISS (%)</label>
              <input v-model="form.aliquotaIss" class="input-field" inputmode="decimal" placeholder="Usa a do município" />
            </div>
            <div v-if="Number(form.opcaoSimplesNacional) !== 1">
              <label class="label">% tributos (SN)</label>
              <input v-model="form.percentualTributosSN" class="input-field" inputmode="decimal" placeholder="Opcional" />
            </div>
            <div class="sm:col-span-3">
              <label class="label">Descrição padrão do serviço *</label>
              <input v-model="form.descricaoServicoPadrao" class="input-field" maxlength="2000" />
            </div>
            <div>
              <label class="label">Série da DPS</label>
              <input v-model="form.serie" class="input-field" inputmode="numeric" maxlength="5" />
            </div>
            <div>
              <label class="label">Próximo número</label>
              <input v-model.number="form.proximoNumero" type="number" min="1" class="input-field" />
            </div>
          </div>

          <div class="flex justify-end">
            <button class="btn-primary" type="submit" :disabled="savingConfig">{{ savingConfig ? 'Salvando…' : 'Salvar configuração' }}</button>
          </div>
        </form>

        <div class="space-y-6">
          <div class="card space-y-3">
            <div class="flex items-center gap-2"><ShieldCheck class="w-4 h-4 text-primary-600" /><h2 class="font-semibold text-slate-900">Certificado digital A1</h2></div>
            <template v-if="config.hasCertificate">
              <div class="text-sm">
                <p class="font-medium text-slate-800 break-words">{{ config.certSubject }}</p>
                <p class="text-xs text-slate-500">Válido até {{ fmtDate(config.certValidTo) }}<template v-if="config.certDocumento"> · {{ formatDoc(config.certDocumento) }}</template></p>
                <p v-if="config.certDocMismatch" class="text-xs text-amber-700 mt-1">O documento do certificado difere do prestador — confirme que ele tem procuração no Emissor Nacional.</p>
              </div>
              <button class="btn-secondary text-xs" @click="removeCert"><Trash2 class="w-3.5 h-3.5" /> Remover</button>
            </template>
            <p v-else class="text-xs text-slate-500">Envie o arquivo .pfx/.p12 do seu e-CNPJ ou e-CPF. Ele é guardado criptografado e usado só para assinar e transmitir suas notas.</p>
            <div class="space-y-2">
              <input type="file" accept=".pfx,.p12" class="block w-full text-xs text-slate-600 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5" @change="certFile = ($event.target as HTMLInputElement).files?.[0] ?? null" />
              <input v-model="certPassword" type="password" autocomplete="off" class="input-field" placeholder="Senha do certificado" />
              <button class="btn-primary w-full justify-center text-xs" :disabled="!certFile || !certPassword || uploading" @click="uploadCert">
                <Upload class="w-3.5 h-3.5" /> {{ uploading ? 'Enviando…' : config.hasCertificate ? 'Substituir certificado' : 'Enviar certificado' }}
              </button>
            </div>
          </div>

          <div class="card space-y-3">
            <h2 class="font-semibold text-slate-900">Ambiente</h2>
            <div class="seg-control w-full">
              <button class="seg-btn flex-1" :class="{ active: config.ambiente === 'HOMOLOGACAO' }" @click="setAmbiente('HOMOLOGACAO')">Homologação</button>
              <button class="seg-btn flex-1" :class="{ active: config.ambiente === 'PRODUCAO' }" @click="setAmbiente('PRODUCAO')">Produção</button>
            </div>
            <p class="text-xs text-slate-500">Teste primeiro em homologação (sem valor fiscal, sem custo). Em produção, cada nota autorizada custa <b>{{ centsToBRL(config.unitPriceCents) }}</b>.</p>
            <button class="btn-secondary w-full justify-center text-xs" :disabled="testing || !config.hasCertificate" @click="testConn">
              <Plug class="w-3.5 h-3.5" /> {{ testing ? 'Testando…' : 'Testar conexão com a Sefin' }}
            </button>
            <ul v-if="config.missing.length" class="text-xs text-amber-700 list-disc ml-4 space-y-0.5">
              <li v-for="m in config.missing" :key="m">{{ m }}</li>
            </ul>
            <p v-else class="text-xs text-emerald-700">Tudo pronto para emitir.</p>
          </div>
        </div>
      </div>
    </template>

    <!-- ─── Detalhe ───────────────────────────────────────────── -->
    <Modal :is-open="!!detail" :title="detail?.numeroNfse ? `NFS-e nº ${detail.numeroNfse}` : `DPS ${detail?.numeroDps ?? ''}`" :subtitle="detail ? NFSE_STATUS[detail.status].label : ''" size="lg" @close="detail = null; router.replace({ query: { ...route.query, nota: undefined } })">
      <div v-if="detail" class="space-y-4 text-sm">
        <div class="grid grid-cols-2 gap-3">
          <div><p class="text-xs text-slate-400">Tomador</p><p class="font-medium text-slate-800">{{ detail.tomadorNome }}</p><p class="text-xs text-slate-500">{{ formatDoc(detail.tomadorDocumento) || 'Sem documento' }}</p></div>
          <div><p class="text-xs text-slate-400">Valor</p><p class="font-semibold text-slate-900">{{ centsToBRL(detail.valorCents) }}</p></div>
          <div><p class="text-xs text-slate-400">Competência</p><p>{{ fmtDate(detail.competencia) }}</p></div>
          <div><p class="text-xs text-slate-400">Emitida em</p><p>{{ fmtDate(detail.issuedAt, 'dd/MM/yyyy HH:mm') }}</p></div>
          <div class="col-span-2"><p class="text-xs text-slate-400">Serviço ({{ detail.codigoTributacao }})</p><p class="whitespace-pre-line">{{ detail.descricao }}</p></div>
          <div v-if="detail.chaveAcesso" class="col-span-2"><p class="text-xs text-slate-400">Chave de acesso</p><p class="font-mono text-xs break-all">{{ detail.chaveAcesso }}</p></div>
          <div v-if="detail.transaction" class="col-span-2"><p class="text-xs text-slate-400">Lançamento</p><p>{{ detail.transaction.description }}</p></div>
        </div>

        <div v-if="detail.mensagens?.length" class="rounded-xl ring-1 p-3 space-y-1" :class="detail.status === 'REJECTED' ? 'bg-red-50 ring-red-200 text-red-800' : 'bg-slate-50 ring-slate-200 text-slate-700'">
          <p v-for="(m, i) in detail.mensagens" :key="i" class="text-xs"><b v-if="m.codigo">{{ m.codigo }}</b> {{ m.descricao }}<span v-if="m.complemento" class="opacity-70"> — {{ m.complemento }}</span></p>
        </div>
        <p v-if="detail.status === 'CANCELLED'" class="text-xs text-slate-500">Cancelada em {{ fmtDate(detail.cancelledAt, 'dd/MM/yyyy HH:mm') }} · {{ MOTIVOS[detail.cancelMotivo as keyof typeof MOTIVOS] ?? '' }} — {{ detail.cancelJustificativa }}</p>

        <div class="flex flex-wrap gap-2 pt-3 border-t border-slate-100">
          <button v-if="detail.status === 'PROCESSING'" class="btn-secondary text-xs" :disabled="busy" @click="sync"><RefreshCw class="w-3.5 h-3.5" /> Consultar situação</button>
          <button v-if="detail.chaveAcesso" class="btn-secondary text-xs" :disabled="busy" @click="download('danfse')"><FileDown class="w-3.5 h-3.5" /> DANFSe (PDF)</button>
          <button v-if="detail.hasXml" class="btn-secondary text-xs" :disabled="busy" @click="download('xml')"><Download class="w-3.5 h-3.5" /> XML</button>
          <button v-if="detail.status === 'AUTHORIZED'" class="btn-secondary text-xs text-red-600 ml-auto" :disabled="busy" @click="cancelOpen = true"><XCircle class="w-3.5 h-3.5" /> Cancelar nota</button>
        </div>
      </div>
    </Modal>

    <Modal :is-open="cancelOpen" title="Cancelar NFS-e" subtitle="O cancelamento é registrado na Sefin Nacional e não pode ser desfeito." size="sm" @close="cancelOpen = false">
      <form class="space-y-3" @submit.prevent="confirmCancel">
        <div>
          <label class="label">Motivo</label>
          <select v-model="cancelMotivo" class="input-field">
            <option v-for="(label, k) in MOTIVOS" :key="k" :value="k">{{ label }}</option>
          </select>
        </div>
        <div>
          <label class="label">Justificativa (15 a 255 caracteres)</label>
          <textarea v-model="cancelJust" class="input-field min-h-[80px]" maxlength="255" />
        </div>
        <button class="btn-primary w-full justify-center bg-red-600 hover:bg-red-700" type="submit" :disabled="busy || cancelJust.trim().length < 15">Confirmar cancelamento</button>
      </form>
    </Modal>

    <EmitirNotaModal :is-open="emitOpen" :patients="patients" @close="emitOpen = false" @issued="n => { refreshAll(); openDetail(n.id) }" />
  </div>
</template>
