<script setup lang="ts">
import { computed, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { useSecretaryPermissions, type SecretaryPermissionKey } from '../../composables/useSecretaryPermissions'

const props = defineProps<{ permission: SecretaryPermissionKey | SecretaryPermissionKey[] }>()
const { isSecretary, can, isLoading } = useSecretaryPermissions()
const router = useRouter()

const permissions = computed(() => Array.isArray(props.permission) ? props.permission : [props.permission])
const allowed = computed(() => !isSecretary.value || permissions.value.some(can))

watchEffect(() => {
  if (isSecretary.value && !isLoading.value && !allowed.value) {
    router.replace('/dashboard')
  }
})
</script>

<template>
  <template v-if="!(isSecretary && isLoading)">
    <slot v-if="allowed" />
  </template>
</template>
