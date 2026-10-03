import { defineStore } from 'pinia'

export const useUnsavedChangesStore = defineStore('unsavedChanges', {
  state: () => ({
    hasUnsavedChanges: false,
  }),
  actions: {
    setHasUnsavedChanges(value: boolean) {
      this.hasUnsavedChanges = value
    },
  },
})
