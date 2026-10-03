<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { UserPlus, AlertTriangle } from 'lucide-vue-next'
import toast from '../../lib/toast'
import api from '../../lib/api'
import Modal from '../ui/Modal.vue'
import type { Patient } from '../../types'

const props = defineProps<{ isOpen: boolean }>()
const emit = defineEmits<{ close: []; created: [patient: Patient] }>()

const nameInput = ref<HTMLInputElement | null>(null)
watch(() => props.isOpen, (open) => {
  if (open) nextTick(() => nameInput.value?.focus())
})

const saving = ref(false)
const name = ref('')
const phone = ref('')
const duplicate = ref<{ id: string; name: string; phone: string; status: string } | null>(null)

function resetForm() {
  name.value = ''
  phone.value = ''
  duplicate.value = null
}

function handleClose() {
  resetForm()
  emit('close')
}

async function handleSubmit(e: Event) {
  e.preventDefault()
  if (!name.value.trim() || phone.value.replace(/\D/g, '').length < 10) {
    toast.error('Nome e telefone são obrigatórios')
    return
  }
  saving.value = true
  try {
    const { data } = await api.post<Patient>('/patients/pre-register', {
      name: name.value.trim(),
      phone: phone.value,
      origin: 'AGENDA',
    })
    toast.success('Pré-cadastro criado! Equipe será notificada para finalizar o cadastro.')
    emit('created', data)
    resetForm()
  } catch (err: unknown) {
    const error = err as {
      response?: {
        data?: {
          message?: string
          existingPatient?: { id: string; name: string; phone: string; status: string }
        }
      }
    }
    if (error.response?.data?.existingPatient) {
      duplicate.value = error.response.data.existingPatient
    } else {
      toast.error(error.response?.data?.message || 'Erro ao criar pré-cadastro')
    }
  } finally {
    saving.value = false
  }
}

function handleUseDuplicate() {
  if (!duplicate.value) return
  const patient: Patient = {
    id: duplicate.value.id,
    name: duplicate.value.name,
    phone: duplicate.value.phone,
    active: true,
    status: duplicate.value.status as Patient['status'],
    origin: 'MANUAL',
    createdAt: '',
  }
  emit('created', patient)
  resetForm()
}
</script>

<template>
  <Modal
    :is-open="isOpen"
    title="Pré-cadastro rápido"
    subtitle="Apenas nome e telefone são necessários agora"
    size="sm"
    @close="handleClose"
  >
    <div v-if="duplicate" class="space-y-4">
      <div class="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <AlertTriangle class="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p class="text-sm font-semibold text-amber-800">Paciente já cadastrado</p>
          <p class="text-sm text-amber-700 mt-1">{{ duplicate.name }}</p>
          <p class="text-xs text-amber-600 mt-0.5">{{ duplicate.phone }}</p>
        </div>
      </div>
      <div class="flex gap-3">
        <button type="button" class="btn-primary flex-1" @click="handleUseDuplicate">
          Usar paciente existente
        </button>
        <button type="button" class="btn-secondary" @click="duplicate = null">
          Tentar outro
        </button>
      </div>
    </div>

    <form v-else class="space-y-4" @submit="handleSubmit">
      <div class="flex items-start gap-2.5 p-3 bg-primary-50 border border-primary-100 rounded-xl">
        <UserPlus class="w-4 h-4 text-primary-600 flex-shrink-0 mt-0.5" />
        <p class="text-xs text-primary-700 leading-relaxed">
          O cadastro completo poderá ser finalizado depois na tela de
          <strong>Pacientes</strong>. Médico e secretaria serão notificados.
        </p>
      </div>

      <div>
        <label class="label">Nome completo *</label>
        <input
          ref="nameInput"
          v-model="name"
          class="input-field"
          placeholder="Nome do paciente"
          required
        />
      </div>

      <div>
        <label class="label">Telefone *</label>
        <input
          v-model="phone"
          class="input-field"
          placeholder="(11) 99999-9999"
          required
        />
      </div>

      <div class="flex gap-3 pt-1">
        <button type="submit" :disabled="saving" class="btn-primary flex-1">
          {{ saving ? 'Salvando...' : 'Salvar pré-cadastro' }}
        </button>
        <button type="button" class="btn-secondary" @click="handleClose">
          Cancelar
        </button>
      </div>
    </form>
  </Modal>
</template>
