import { useCallback, useEffect, useState } from 'react'
import type { HomeworkFormOpen } from '../../main/ipc'

/** The To-do card's homework form: opened by its +, or by the right-click menu's Edit…. */
export function useHomeworkForm(): [
  HomeworkFormOpen | null,
  (form: HomeworkFormOpen) => void,
  () => void
] {
  const [form, setForm] = useState<HomeworkFormOpen | null>(null)
  useEffect(() => window.focusScreen.onHomeworkForm(setForm), [])
  const close = useCallback(() => setForm(null), [])
  return [form, setForm, close]
}
