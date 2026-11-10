import type { TodoState } from '../../main/ipc'
import { useBridgeValue } from './useBridgeValue'

const load = (): Promise<TodoState> => window.focusScreen.getTodos()
const subscribe = (listener: (todos: TodoState) => void): (() => void) =>
  window.focusScreen.onTodosChanged(listener)

export function useTodos(): TodoState | null {
  return useBridgeValue(load, subscribe)
}
