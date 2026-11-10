import type { FocusScreenApi } from '../main/ipc'

declare global {
  interface Window {
    focusScreen: FocusScreenApi
  }
}
