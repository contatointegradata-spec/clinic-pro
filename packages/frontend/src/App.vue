<script setup lang="ts">
import ErrorBoundary from './components/system/ErrorBoundary.vue'
import Toaster from './components/system/Toaster.vue'
</script>

<template>
  <ErrorBoundary>
    <router-view v-slot="{ Component }">
      <transition name="app-fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
    <Toaster />
  </ErrorBoundary>
</template>
