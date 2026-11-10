import { useCallback, useEffect, useState } from 'react'
import type { TodoConnectForm } from '../../main/ipc'

/** The connect form the main process asked for (menu item or Connect button), until closed. */
export function useConnectForm(): [TodoConnectForm | null, () => void] {
  const [form, setForm] = useState<TodoConnectForm | null>(null)
  useEffect(() => window.focusScreen.onTodoConnectForm(setForm), [])
  const close = useCallback(() => setForm(null), [])
  return [form, close]
}
