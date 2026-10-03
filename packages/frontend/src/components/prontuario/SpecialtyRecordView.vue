<script setup lang="ts">
import { computed, h, type FunctionalComponent } from 'vue'
import type { SpecialtyKey } from './specialtyUtils'

interface Props {
  specialtyType: string
  data: Record<string, unknown>
}

const props = defineProps<Props>()

const d = computed(() => props.data)
const key = computed(() => props.specialtyType as SpecialtyKey)

// ─── Shared primitives (local functional components, mirroring the React originals) ──

const Field: FunctionalComponent<{ label: string; value: unknown }> = (p) => {
  const v = p.value as string | number | undefined | null
  if (!v && v !== 0) return null
  return h('div', [
    h('p', { class: 'text-xs text-slate-400 font-medium mb-0.5' }, p.label),
    h('p', { class: 'text-sm text-slate-800' }, String(v)),
  ])
}
Field.props = ['label', 'value']

const FieldBlock: FunctionalComponent<{ label: string; value: unknown }> = (p) => {
  const v = p.value as string | undefined | null
  if (!v) return null
  return h('div', [
    h('p', { class: 'text-xs text-slate-400 font-medium mb-0.5' }, p.label),
    h(
      'p',
      { class: 'text-sm text-slate-800 whitespace-pre-wrap bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 leading-relaxed' },
      v
    ),
  ])
}
FieldBlock.props = ['label', 'value']

const SectionTitle: FunctionalComponent = (_props, { slots }) =>
  h(
    'p',
    { class: 'text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1 mb-2 mt-3 first:mt-0' },
    slots.default?.()
  )

const riscoConfig: Record<string, string> = {
  Baixo: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  Moderado: 'bg-orange-50 text-orange-700 border-orange-200',
  Alto: 'bg-red-50 text-red-700 border-red-200',
}

const RiscoBadge: FunctionalComponent<{ level: string }> = (p) => {
  const level = p.level
  if (!level || level === 'Sem risco') {
    return h(
      'span',
      { class: 'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200' },
      'Sem risco identificado'
    )
  }
  const cls = riscoConfig[level] ?? 'bg-slate-50 text-slate-700 border-slate-200'
  return h(
    'span',
    { class: `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}` },
    `${level === 'Alto' || level === 'Moderado' ? '⚠️ ' : ''}${level}`
  )
}
RiscoBadge.props = ['level']
</script>

<template>
  <!-- ─── Psicologia ─────────────────────────────────────────────────────── -->
  <div v-if="key === 'PSICOLOGIA'" class="space-y-3">
    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <Field label="Tipo de Sessão" :value="d.tipoSessao" />
      <Field label="Abordagem" :value="d.abordagem" />
      <Field label="Objetivo da Sessão" :value="d.objetivo" />
      <div>
        <p class="text-xs text-slate-400 font-medium mb-1">Nível de Risco</p>
        <RiscoBadge :level="String(d.risco ?? 'Sem risco')" />
      </div>
    </div>

    <FieldBlock label="Síntese Clínica" :value="d.sinteseClinica" />

    <template v-if="!!(d.instrumentos || d.planoProximaSessao || d.encaminhamentos)">
      <SectionTitle>Complementar</SectionTitle>
      <div class="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Instrumentos Aplicados" :value="d.instrumentos" />
        <Field label="Plano Próxima Sessão" :value="d.planoProximaSessao" />
      </div>
      <Field label="Encaminhamentos" :value="d.encaminhamentos" />
    </template>
  </div>

  <!-- ─── Nutrição ───────────────────────────────────────────────────────── -->
  <div v-else-if="key === 'NUTRICAO'" class="space-y-3">
    <template v-if="!!(d.peso || d.altura || d.imc || d.cintura)">
      <SectionTitle>Medidas Antropométricas</SectionTitle>
      <div class="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Peso" :value="d.peso ? `${d.peso} kg` : null" />
        <Field label="Altura" :value="d.altura ? `${d.altura} cm` : null" />
        <Field label="IMC" :value="d.imc" />
        <Field label="Cintura" :value="d.cintura ? `${d.cintura} cm` : null" />
      </div>
    </template>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <Field label="Objetivo" :value="d.objetivo" />
      <Field label="Diagnóstico Nutricional" :value="d.diagnosticoNutricional" />
      <Field label="Intolerâncias / Alergias" :value="d.intolerancias" />
      <Field label="Adesão ao Plano" :value="d.adesao ? `${d.adesao}/10` : null" />
    </div>

    <FieldBlock label="Recordatório 24h" :value="d.recordatorio24h" />
    <FieldBlock label="Prescrição Dietética" :value="d.prescricaoDietetica" />
    <Field label="Metas" :value="d.metas" />
  </div>

  <!-- ─── Nutrologia ─────────────────────────────────────────────────────── -->
  <div v-else-if="key === 'NUTROLOGIA'" class="space-y-3">
    <template v-if="!!(d.peso || d.imc || d.cintura)">
      <SectionTitle>Medidas Antropométricas</SectionTitle>
      <div class="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Peso" :value="d.peso ? `${d.peso} kg` : null" />
        <Field label="IMC" :value="d.imc" />
        <Field label="Cintura" :value="d.cintura ? `${d.cintura} cm` : null" />
        <div>
          <p class="text-xs text-slate-400 font-medium mb-1">Risco Cardiometabólico</p>
          <RiscoBadge :level="String(d.riscoCardiometabolico ?? 'Baixo')" />
        </div>
      </div>
    </template>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <Field label="Diagnóstico (CID-10)" :value="d.cid" />
      <Field label="Deficiências Nutricionais" :value="d.deficiencias" />
    </div>

    <FieldBlock label="Exames Laboratoriais" :value="d.examesLab" />
    <FieldBlock label="Conduta / Prescrição" :value="d.conduta" />
    <Field label="Encaminhamentos" :value="d.encaminhamentos" />
  </div>

  <!-- ─── Psiquiatria ────────────────────────────────────────────────────── -->
  <div v-else-if="key === 'PSIQUIATRIA'" class="space-y-3">
    <template v-if="!!(d.emcAparencia || d.emcHumor || d.emcPensamento || d.emcPercepcao)">
      <SectionTitle>Exame do Estado Mental</SectionTitle>
      <div class="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="Aparência / Atitude" :value="d.emcAparencia" />
        <Field label="Humor / Afeto" :value="d.emcHumor" />
        <Field label="Pensamento / Linguagem" :value="d.emcPensamento" />
        <Field label="Percepção" :value="d.emcPercepcao" />
      </div>
    </template>

    <div class="grid grid-cols-2 gap-x-6 gap-y-3">
      <div>
        <p class="text-xs text-slate-400 font-medium mb-1">Risco Suicida</p>
        <RiscoBadge :level="String(d.riscoSuicidio ?? 'Sem risco')" />
      </div>
      <Field label="Diagnóstico (CID-10)" :value="d.cid" />
    </div>

    <template v-if="!!(d.phq9 || d.gad7)">
      <SectionTitle>Escalas</SectionTitle>
      <div class="grid grid-cols-2 gap-x-6 gap-y-3">
        <Field label="PHQ-9 (Depressão)" :value="d.phq9" />
        <Field label="GAD-7 (Ansiedade)" :value="d.gad7" />
      </div>
    </template>

    <Field label="Uso de Substâncias" :value="d.substancias" />
    <FieldBlock label="Medicamentos / Resposta Terapêutica" :value="d.medicamentos" />
    <FieldBlock label="Conduta" :value="d.conduta" />
    <FieldBlock label="Plano de Segurança" :value="d.planoSeguranca" />
  </div>

  <!-- ─── SOAP (Clínico Geral) ───────────────────────────────────────────── -->
  <div v-else-if="key === 'CLINICO_GERAL'" class="space-y-3">
    <Field label="Diagnóstico (CID-10)" :value="d.cid" />
    <FieldBlock label="S — Subjetivo" :value="d.subjetivo" />
    <FieldBlock label="O — Objetivo" :value="d.objetivo" />
    <FieldBlock label="A — Avaliação" :value="d.avaliacao" />
    <FieldBlock label="P — Plano" :value="d.plano" />
  </div>
</template>
