import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useOnboardingTourStore = defineStore('onboardingTour', () => {
  const activeTour = ref<string | null>(null)
  return { activeTour }
})
