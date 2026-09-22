import { ref } from 'vue'

const resolvedUserInfo = ref<{ id: string } | null>(null)
const userDisplayName = ref<string | undefined>(undefined)
const userEmail = ref<string | undefined>(undefined)
const isLoggedIn = ref(false)

export function useCurrentUser() {
  return { resolvedUserInfo, userDisplayName, userEmail, isLoggedIn }
}
