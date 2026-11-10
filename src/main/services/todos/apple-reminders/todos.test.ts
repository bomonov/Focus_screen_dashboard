import { describe, expect, it } from 'vitest'
import type { HelperReminder } from './protocol'
import { toProviderTodos } from './todos'

function reminder(id: string, changes: Partial<HelperReminder> = {}): HelperReminder {
  return {
    id,
    list: 'home',
    title: id,
    due: null,
    done: false,
    completedAt: null,
    createdAt: 100,
    ...changes
  }
}

describe('toProviderTodos', () => {
  it('says "Apple Reminders" when there is only one list', () => {
    const todos = toProviderTodos([{ id: 'home', title: 'Home' }], [reminder('a')])
    expect(todos).toEqual([
      {
        id: 'a',
        title: 'a',
        context: 'Apple Reminders',
        due: null,
        done: false,
        completedAt: null
      }
    ])
  })

  it('names the list when there are several, except the default "Reminders" list', () => {
    const lists = [
      { id: 'home', title: 'Home' },
      { id: 'default', title: 'Reminders' },
      { id: 'blank', title: '' }
    ]
    const todos = toProviderTodos(lists, [
      reminder('a'),
      reminder('b', { list: 'default' }),
      reminder('c', { list: 'blank' }),
      reminder('d', { list: 'gone' })
    ])
    expect(Object.fromEntries(todos.map((todo) => [todo.id, todo.context]))).toEqual({
      a: 'Reminders · Home',
      b: 'Apple Reminders',
      c: 'Apple Reminders',
      d: 'Apple Reminders'
    })
  })

  it('orders by list name, then oldest first', () => {
    const lists = [
      { id: 'w', title: 'Work' },
      { id: 'h', title: 'Home' }
    ]
    const todos = toProviderTodos(lists, [
      reminder('w1', { list: 'w', createdAt: 1 }),
      reminder('h2', { list: 'h', createdAt: 50 }),
      reminder('h1', { list: 'h', createdAt: 10 }),
      reminder('h0', { list: 'h', createdAt: null })
    ])
    expect(todos.map((todo) => todo.id)).toEqual(['h0', 'h1', 'h2', 'w1'])
  })

  it('skips untitled reminders and keeps completion times only for done ones', () => {
    const todos = toProviderTodos(
      [],
      [
        reminder('blank', { title: '' }),
        reminder('done', { done: true, completedAt: 500 }),
        reminder('open', { completedAt: 500 })
      ]
    )
    expect(todos.map((todo) => [todo.id, todo.completedAt])).toEqual([
      ['done', 500],
      ['open', null]
    ])
  })
})
