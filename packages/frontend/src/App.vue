<script setup lang="ts">
import ErrorBoundary from './components/system/ErrorBoundary.vue'
import Toaster from './components/system/Toaster.vue'
</script>

<template>
  <ErrorBoundary>
    <router-view />
    <Toaster />
  </ErrorBoundary>
</template>
