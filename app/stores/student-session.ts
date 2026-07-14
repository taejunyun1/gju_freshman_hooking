import { defineStore } from 'pinia'
import { ref } from 'vue'

type InitialCredentials = {
  nickname: string
  initialPassword: string
}

export const useStudentSessionStore = defineStore('student-session', () => {
  const initialCredentials = ref<InitialCredentials | null>(null)

  const setInitialCredentials = (credentials: InitialCredentials): void => {
    initialCredentials.value = credentials
  }

  const consumeInitialCredentials = (): InitialCredentials | null => {
    const credentials = initialCredentials.value
    initialCredentials.value = null
    return credentials
  }

  return { initialCredentials, setInitialCredentials, consumeInitialCredentials }
})
