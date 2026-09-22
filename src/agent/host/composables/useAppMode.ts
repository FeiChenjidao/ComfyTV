import { ref } from 'vue'

const isBuilderMode = ref(false)

export function useAppMode() {
  return { isBuilderMode }
}
