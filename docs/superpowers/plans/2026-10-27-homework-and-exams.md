# Homework and Exams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local to-do source, Homework: the user adds homework and exams by hand in the To-do card, picks the class from their class calendar, sees a countdown to the next exam at the top of the card, and sees in the Next class week list what of theirs is due within 3 days.

**Architecture:** A `HomeworkBook` in main owns `userData/homework.json` (open homework and exams only; a ticked homework lives in memory for its hour). A `TodoProvider` for source `'homework'` wraps the book, so merging, sorting, overlays and the tick animation are unchanged; `TodoState` gains `exams` and `classes`. Adding, editing and deleting go through one invoke channel; right-click Edit/Delete come from the glass quick menu with the clicked item's id. The renderer adds a form and an exam strip to the To-do card, and tags to the class list once that branch is merged in.

**Tech Stack:** Electron, TypeScript strict, React, plain CSS, Vitest (node environment, `src/**/*.test.ts`).

**Spec:** `docs/superpowers/specs/2026-10-27-homework-and-exams-design.md`

## Global Constraints

- Run `npm run typecheck`, `npm run lint` and `npm test` after every task; all three must pass before its commit.
- Commit on branch `worktree-homework` after each task, ending the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push, never merge into main, never install.
- No new dependencies.
- IPC channel names and payload types only in `src/main/ipc.ts` (shared types in `src/main/services/todos/types.ts`, which stays free of imports).
- Everything from the renderer is untrusted: main re-checks every homework request.
- Never log, print or put in an error message a homework title or a class name (`console.warn('[todos] …', error)` with the error only).
- A ticked homework is never in `homework.json`: the write that ticks it removes it.
- Nearly due = due today through 3 days after today (local calendar days), plus overdue open homework. `DUE_SOON_DAYS = 3`, `DONE_KEEP_SEC = 3600`.
- Homework colour `--source-homework: #a78bfa`; icon: a pencil, outline and filled, same 24-unit viewBox and 1.8 stroke as `assets/sources/*`.
- Targets at least `var(--hit)` (44 px); text readable from 1 m; no finite CSS keyframe animations inside the card (use the Web Animations API, as `TodoList.tsx` does).
- Times are epoch seconds internally; format at display time. A day without a time is `{ kind: 'day', day: 'YYYY-MM-DD' }`.
- Tests are `.ts` only (Vitest's include); put view logic in pure `.ts` files and test those, never pixels.

## Review Focus

1. **A hand-edited or broken `homework.json`** (wrong types, duplicate ids, 10,000 entries, a ticked item from an older build): loads what's valid, caps at 500, never crashes. Pinned in Task 1.
2. **A stale id from a menu** (Edit or Delete on an item that was ticked, deleted or expired meanwhile): answers `{ ok: false }` with plain words, changes nothing. Pinned in Task 4.
3. **Class names differing only in case or spaces** ("BIO 181" saved, "bio 181" in the calendar): one chip, and the class list tag still lands on the class. Pinned in Tasks 3 and 9.
4. **Long titles** (200 characters, Japanese without spaces, emoji): main caps at 200 after trimming; the row, strip and tag wrap or clip with an ellipsis, never push the card wider. Pinned in Task 1 (cap); Tasks 6, 7, 9 use `overflow-wrap: anywhere` / ellipsis.
5. **Midnight and the exam's own start**: a timed exam leaves the strip the minute its time passes, a day-only one at the next local midnight; the countdown's day count steps at midnight, not 24 h after adding. Pinned in Tasks 1 and 7.

---

### Task 1: Homework entries: shared types, untrusted parsing, expiry

**Files:**

- Modify: `src/main/services/todos/types.ts` (add types only; `TodoSourceId` is unchanged until Task 3)
- Create: `src/main/services/todos/homework/shared.ts` (no imports: main and renderer both use it)
- Create: `src/main/services/todos/homework/entries.ts`
- Test: `src/main/services/todos/homework/entries.test.ts`, `src/main/services/todos/homework/shared.test.ts`

**Interfaces:**

- Produces, in `types.ts`:
  ```ts
  export type HomeworkKind = 'homework' | 'exam'
  /** What the form sends: a course is a class chip's text, null for "No class". */
  export interface HomeworkInput {
    kind: HomeworkKind
    title: string
    course: string | null
    due: TodoDue
  }
  export interface HomeworkEntry extends HomeworkInput {
    id: string
  }
  /** An exam for the countdown strip and the class list, soonest first. */
  export interface ExamItem {
    id: string
    title: string
    course: string | null
    due: TodoDue
  }
  ```
- Produces, in `shared.ts`: `DUE_SOON_DAYS = 3`, `DONE_KEEP_SEC = 3600`, `MAX_TITLE_CHARS = 200`, `MAX_COURSE_CHARS = 60`, and `courseKey(course: string): string` (trim, collapse runs of whitespace to one space, lower-case).
- Produces, in `entries.ts`: `MAX_ENTRIES = 500`; `parseHomeworkInput(raw: unknown): HomeworkInput | null`; `parseHomeworkFile(raw: unknown): HomeworkEntry[]`; `homeworkFile(entries: readonly HomeworkEntry[]): { version: 1; entries: HomeworkEntry[] }`; `examOver(due: TodoDue, nowSec: number): boolean`; `withoutEndedExams(entries: readonly HomeworkEntry[], nowSec: number): HomeworkEntry[]`.

- [ ] **Step 1: Write the failing tests**

`shared.test.ts`: `courseKey('  BIO   181 ')` and `courseKey('bio 181')` both equal `'bio 181'`.

`entries.test.ts`:

- `parseHomeworkInput` accepts `{ kind: 'homework', title: '  Problem set 7 ', course: ' MAT 265 ', due: { kind: 'day', day: '2026-10-30' } }` as title `'Problem set 7'`, course `'MAT 265'`; course `''` or `'   '` becomes `null`.
- rejects: an empty or whitespace title; a title of 201 characters after trimming (200 passes); a course over 60; `kind: 'quiz'`; `due.day: '2026-02-30'` and `'2026-1-5'`; `due.at: NaN` / `Infinity` / a string; extra junk like `due: null`; non-objects.
- `parseHomeworkFile`: `{ version: 1, entries: [valid, { id: 5 }, valid-with-same-id, …] }` keeps the valid ones, first of a duplicate id; anything not an object or without `entries` array gives `[]`; 10,000 valid entries give 500; an entry carrying `doneAt` from an older build is dropped (a ticked homework must not come back).
- `examOver`: `{ kind: 'time', at: 1000 }` is over at 1000, not at 999; `{ kind: 'day', day: '2026-11-12' }` is not over at local 2026-11-12 23:59:59, is over at local 2026-11-13 00:00:00 (build both with `new Date(y, m, d, …)`).
- `withoutEndedExams` drops ended exams only; an overdue homework stays.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/services/todos/homework`
Expected: FAIL, modules not found.

- [ ] **Step 3: Add the types, then implement `shared.ts` and `entries.ts`**

Entry ids must match `/^[A-Za-z0-9_-]{1,64}$/` to be kept (they become `homework:<id>` item ids and menu targets). Real dates: build the `Date` and check year, month and day come back unchanged.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npx vitest run src/main/services/todos/homework && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: entries, parsing and expiry`)

---

### Task 2: The homework book (`homework.json` and the hour in memory)

**Files:**

- Create: `src/main/services/todos/homework/book.ts`
- Test: `src/main/services/todos/homework/book.test.ts` (real files in `mkdtempSync(join(tmpdir(), 'homework-'))`)

**Interfaces:**

- Consumes: Task 1's types and functions.
- Produces:

  ```ts
  export interface TickedHomework {
    entry: HomeworkEntry
    doneAt: number
  }
  export interface HomeworkBook {
    /** Open homework (from the file), then the ones ticked in the last hour (memory only). */
    homework(): { open: HomeworkEntry[]; ticked: TickedHomework[] }
    /** Exams not over yet, soonest first. */
    exams(): HomeworkEntry[]
    /** The courses saved entries use, for the class chips. */
    courses(): string[]
    /** Open homework, exams, and the ticked ones of the last hour. */
    find(id: string): { entry: HomeworkEntry; ticked: boolean } | null
    add(input: HomeworkInput): HomeworkEntry | null // null when at MAX_ENTRIES
    edit(id: string, input: HomeworkInput): boolean // open homework and exams only
    remove(id: string): boolean // open, ticked or exam
    setDone(id: string, done: boolean): boolean
    /** Drops ended exams and ticked homework past the hour; true when anything went. */
    prune(): boolean
    subscribe(listener: () => void): () => void
  }
  export function openHomeworkBook(options: {
    filePath: string
    now?: () => number // epoch seconds
    makeId?: () => string // default: randomUUID()
  }): HomeworkBook
  ```

- [ ] **Step 1: Write the failing tests**

- `add` then reopen from the same path: the entry is there (with its id, kind, title, course, due).
- `setDone(id, true)`: the file no longer contains the entry (parse the JSON on disk and check its ids, and that the title string isn't anywhere in the file); `homework().ticked` has it with `doneAt` = now.
- `setDone(id, false)` 59 min later: the entry is back in the file and in `open`.
- 3,600 s after ticking, `prune()` is true and `ticked` is empty; `setDone(id, false)` then returns false.
- Reopening the book after a tick (a quit within the hour) shows neither `open` nor `ticked` for it.
- An exam whose time passed: dropped by `openHomeworkBook` (and the file rewritten without it), and by `prune()` while open; `exams()` never returns an ended exam even before `prune()` runs.
- `exams()` is soonest first, a day-only exam sorting at the end of its day (reuse `dueSortKey` from `merge.ts`).
- When the last entry goes, the file is removed (`existsSync` false).
- A broken file (`'{nope'`) opens as empty and a later `add` writes a good file.
- `subscribe` listeners fire after add, edit, remove, setDone and a `prune()` that changed something; never for a no-op.
- A failed write (point `filePath` into a directory that is a file) doesn't throw; `console.warn` gets called without the entry's title (spy and check every argument with `String(arg).includes(title)` false).

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/services/todos/homework/book.test.ts`
Expected: FAIL, `openHomeworkBook` not found.

- [ ] **Step 3: Implement `openHomeworkBook`**

Write with `writeJsonFile(filePath, homeworkFile(entries))`, remove with `rmSync(filePath, { force: true })` when empty, as `canvas/feedMarks.ts` does.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npx vitest run src/main/services/todos/homework && npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: the book, ticked ones off disk at once`)

---

### Task 3: Homework as a to-do source (provider, state, demo, icon)

**Files:**

- Modify: `src/main/services/todos/types.ts` (`TodoSourceId`, `TODO_SOURCE_NAMES`, `TodoItem.course`, `TodoState.exams`, `TodoState.classes`)
- Modify: `src/main/services/todos/provider.ts` (`ProviderTodo.course?`, optional `exams?`, `classes?`, `hasContent?` on `TodoProvider`)
- Modify: `src/main/services/todos/merge.ts` (`SOURCE_ORDER`, `toTodoItem` copies `course`)
- Modify: `src/main/services/todos/service.ts` (`compute`, `demoActive`)
- Create: `src/main/services/todos/homework/classes.ts`, `src/main/services/todos/homework/provider.ts`
- Modify: `src/main/services/todos/mock/provider.ts` (demo homework, exams, classes)
- Create: `assets/sources/homework-outline.svg`, `assets/sources/homework-filled.svg`
- Modify: `src/renderer/theme/tokens.css` (`--source-homework`), `src/renderer/widgets/TodoList.css` (`.source-icon--homework`), `src/renderer/widgets/todo/SourceIcon.tsx`, `src/renderer/widgets/todo/todoView.ts` (`CHIP_LABELS.homework = 'Homework'`), `src/renderer/screens/customize/SourcesSection.tsx` (`SOURCE_COLORS`), `src/renderer/screens/customize/customizeView.ts` (`NOTES.homework = 'On this Mac'`)
- Test: `homework/classes.test.ts`, `homework/provider.test.ts`, `merge.test.ts`, `service.test.ts`

**Interfaces:**

- Consumes: `HomeworkBook` (Task 2), `courseKey` (Task 1).
- Produces:
  - `TodoSourceId = 'canvas' | 'homework' | 'reminders' | 'google'`; `TODO_SOURCE_NAMES.homework = 'Homework'`; `SOURCE_ORDER = ['canvas', 'homework', 'reminders', 'google']` (so the chips read All · Canvas · Homework · Reminders · Google).
  - `TodoItem.course: string | null` (null for every other source).
  - `TodoState.exams: ExamItem[]` (soonest first) and `TodoState.classes: string[]` (the form's chips).
  - On `TodoProvider`: `exams?(): ExamItem[]`, `classes?(): string[]`, and `hasContent?(): boolean` ("a local source with nothing in it doesn't keep the demo away").
  - `classChoices(calendarTitles: readonly string[], saved: readonly string[]): string[]`: trimmed, inner spaces collapsed, one per `courseKey` (the calendar's spelling wins), sorted with `localeCompare(…, undefined, { numeric: true })`, empties dropped, each at most `MAX_COURSE_CHARS`.
  - `createHomeworkProvider(book: HomeworkBook): TodoProvider & { setCalendarClasses(titles: readonly string[]): void }`: source `'homework'`, name `'Homework'`, always `'connected'`; `list()` = open homework (done false) then ticked (done true, `completedAt` = `doneAt`), each `{ id, title, context: course ?? 'Homework', course, due, done, completedAt }`; `setDone` → `book.setDone`, rejecting with `TodoSourceError('setup', 'That homework is gone.')` when it returns false; `exams()` from `book.exams()`; `classes()` = `classChoices(calendar titles, book.courses())`; `hasContent()` = any open, ticked or exam; `start(onChange, onItemsChanged)` subscribes `onItemsChanged` to the book and to `setCalendarClasses` changes, and runs `book.prune()` every 60 s (cleared in `dispose`).
- Service: `compute()` sets `exams` = the active entries' `exams?.()` merged and sorted by `dueSortKey`, and `classes` = the active entries' `classes?.()` (deduped by `courseKey`). `demoActive()` treats an entry whose `provider.hasContent?.() === false` like a disconnected one. A demo homework provider joins `createMockTodoProviders()`: two homeworks (`Problem set 7`, MAT 265, due in 2 days; `Lab write-up`, CHM 113, due tomorrow 11:59 PM) and two exams (`Quiz 3`, CHM 113, in 2 days 10:30 AM; `Midterm`, BIO 181, in 16 days 9:00 AM), classes `['BIO 181', 'CHM 113', 'ENG 101', 'MAT 265']` (the demo calendar's).

- [ ] **Step 1: Write the failing tests**

- `classes.test.ts`: `classChoices(['MAT 265', 'bio  181', 'BIO 181', ''], ['BIO 181', 'CHM 113'])` equals `['bio 181', 'CHM 113', 'MAT 265']`; `'MAT 99'` sorts before `'MAT 265'`.
- `provider.test.ts` (with a real book in a temp dir): `list()` gives open then ticked with the shapes above; `context` is `'Homework'` with no course; `setDone` on a missing id rejects with `TodoSourceError`; `hasContent()` false on an empty book, true with only an exam; `setCalendarClasses` with new titles calls `onItemsChanged` once, the same titles again doesn't; `exams()` excludes homework.
- `merge.test.ts`: a homework item and a Canvas item due at the same moment sort Canvas first, then homework; `toTodoItem` copies `course` and defaults it to `null`.
- `service.test.ts`: with a `FakeProvider` exposing `exams()` and `classes()`, `get().exams` is merged and sorted and `get().classes` deduped; with demo providers and a real-provider list of [disconnected Canvas, empty homework (`hasContent` false)] the demo shows; once `hasContent` turns true and `onItemsChanged` fires, `get().demo` is false.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/services/todos`
Expected: FAIL.

- [ ] **Step 3: Implement**

The pencil: outline `<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14 7l3 3"/>`; filled, the first path with `fill="currentColor"` (the mockup's, `homework-icon.html` option A). Every `Record<TodoSourceId, …>` the compiler flags gets its homework value; `CONNECT_FROM_CARD` and `parse.ts`'s `SOURCES` stay without it (Homework has nothing to connect).

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS (the existing To-do, Customize and status tests included).

- [ ] **Step 5: Commit** (`Homework: a to-do source, with exams and class chips in the state`)

---

### Task 4: Add, edit and delete over IPC, wired into main

**Files:**

- Modify: `src/main/services/todos/types.ts`, `src/main/ipc.ts`, `src/preload/index.ts`
- Modify: `src/main/services/todos/parse.ts` (`parseHomeworkRequest`)
- Create: `src/main/services/todos/homework/requests.ts`, `src/main/services/todos/homework/dialogs.ts`
- Modify: `src/main/index.ts` (book at `join(userData, 'homework.json')`, provider into `createTodoService` after Canvas, calendar titles into the provider, the request handler)
- Test: `homework/requests.test.ts`, `parse.test.ts`

**Interfaces:**

- Consumes: Tasks 1–3.
- Produces:

  ```ts
  export type HomeworkRequest =
    | { kind: 'add'; input: HomeworkInput }
    | { kind: 'edit'; id: string; input: HomeworkInput }
    | { kind: 'delete'; id: string }
  export type HomeworkResult = { ok: true } | { ok: false; message: string }
  /** Main asks the card to open its form: empty for a new one, filled in to edit. */
  export interface HomeworkFormOpen {
    kind: HomeworkKind
    entry: HomeworkEntry | null
  }
  ```
  - Channels: `todosHomework: 'todos:homework'` (invoke, `[HomeworkRequest] → HomeworkResult`), `todosHomeworkForm: 'todos:homework-form'` (event to the Focus Screen, `HomeworkFormOpen`).
  - Preload/API: `sendHomework(request: HomeworkRequest): Promise<HomeworkResult>`, `onHomeworkForm(listener: (form: HomeworkFormOpen) => void): () => void`.
  - `parseHomeworkRequest(raw: unknown): HomeworkRequest | null` (ids as in Task 1, input via `parseHomeworkInput`).
  - `handleHomeworkRequest(book: HomeworkBook, request: HomeworkRequest, confirmDelete: (entry: HomeworkEntry) => Promise<boolean>): Promise<HomeworkResult>`.
  - `confirmHomeworkDelete(win: BrowserWindow | null, entry: HomeworkEntry): Promise<boolean>`: a native message box like `canvas/dialogs.ts`, "Delete “{title}”?" with Delete / Cancel, Cancel the default.

- [ ] **Step 1: Write the failing tests**

- `parse.test.ts`: a good add, edit and delete pass; an id with `/` or 65 characters, an unknown kind, or a bad input give `null`.
- `requests.test.ts` (fake book or a real one in a temp dir): add returns `{ ok: true }` and the book has it; add on a full book returns `{ ok: false, message: 'Your list is full. Delete some first.' }`; edit and delete of a missing id return `{ ok: false, message: 'That one’s gone already.' }` and change nothing; delete calls `confirmDelete` with the entry from `book.find` (a ticked one too) and only removes on `true` (on `false`: `{ ok: true }`, still there); no result message contains the entry's title.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/services/todos`
Expected: FAIL.

- [ ] **Step 3: Implement and wire**

In `index.ts`, the handler only answers the Focus Screen's and Customize's own pages (`handleFrom` as the other form handlers do). `calendar.subscribe((state) => homework.setCalendarClasses(state.events.map((event) => event.title)))`, plus one call with `calendar.get()` after both exist (the calendar service is created after the to-do service).

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: add, edit and delete from the renderer, checked in main`)

---

### Task 5: Right-click Edit… and Delete

**Files:**

- Modify: `src/main/ipc.ts` (`quickMenu` args), `src/preload/index.ts`, `src/renderer/hooks/useGlassMenus.ts`
- Create: `src/main/services/todos/homework/menu.ts`
- Modify: `src/main/index.ts` (the `quickMenu` handler)
- Test: `homework/menu.test.ts`

**Interfaces:**

- Consumes: Task 4's `HomeworkFormOpen`, `handleHomeworkRequest`, `confirmHomeworkDelete`.
- Produces:
  - `export interface QuickMenuTarget { kind: 'homework'; id: string }` (in `ipc.ts`); `[IpcChannel.quickMenu]: { args: [QuickMenuTarget | null]; result: CardMenu | null }`; `getQuickMenu(target: QuickMenuTarget | null)`.
  - `homeworkMenuItems(entry: HomeworkEntry, actions: { edit: (() => void) | null; remove(): void }): MenuItemConstructorOptions[]` → `Edit “{title}”…`, `Delete “{title}”…`, then a separator; titles over 40 characters cut to 39 + `…`.
  - The renderer marks every homework row and exam line with `data-homework-id="{entry id}"` (Tasks 6–7); `useGlassMenus` passes `{ kind: 'homework', id }` from `event.target.closest('[data-homework-id]')`, else `null`.

- [ ] **Step 1: Write the failing test**

`menu.test.ts`: labels for a short title; a 60-character title shows 39 characters and `…`; clicking each item calls its action once; with `edit: null` there's no Edit item.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/services/todos/homework/menu.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

In the handler: parse the target as untrusted (same id rule); if `book.find(id)` has it, prepend its items to `quickMenuItems(...)`. Edit sends `todosHomeworkForm` `{ kind: entry.kind, entry }` to the Focus Screen. Delete runs `handleHomeworkRequest(book, { kind: 'delete', id }, (e) => confirmHomeworkDelete(win, e))`. For a ticked homework (`found.ticked`), only Delete applies: `homeworkMenuItems` takes `edit: null` and leaves Edit out.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: Edit and Delete in the right-click menu`)

---

### Task 6: The add form in the To-do card

**Files:**

- Create: `src/renderer/widgets/todo/homeworkForm.ts` (pure), `src/renderer/widgets/todo/HomeworkForm.tsx`, `src/renderer/hooks/useHomeworkForm.ts`
- Modify: `src/renderer/widgets/TodoList.tsx` (+ button, title, form swap, `data-homework-id` on homework rows), `src/renderer/widgets/TodoList.css`, `src/renderer/widgets/todo/todoView.ts` (homework meta line without a source name: the context is the course already)
- Test: `src/renderer/widgets/todo/homeworkForm.test.ts`

**Interfaces:**

- Consumes: `TodoState.classes`, `HomeworkFormOpen`, `sendHomework`.
- Produces (pure, in `homeworkForm.ts`):

  ```ts
  export interface DueChoice {
    label: string
    day: string
  } // day 'YYYY-MM-DD'
  export interface FormValues {
    kind: HomeworkKind
    title: string
    course: string | null | undefined
    day: string | null
    time: string | null
  } // course undefined = not picked yet; time 'HH:MM' or null
  export const EXAM_NAMES = ['Midterm', 'Final', 'Quiz'] as const
  export const DEFAULT_TIME = '23:59'
  export function dueChoices(now: Date, locale?: string): DueChoice[] // Today, Tomorrow, then the next 4 days by short weekday
  export function toDue(day: string, time: string | null): TodoDue // time → local epoch seconds
  export function fromEntry(entry: HomeworkEntry): FormValues
  export function formProblem(values: FormValues): string | null
  export function toInput(values: FormValues): HomeworkInput | null
  export function formTitle(kind: HomeworkKind, editing: boolean): string // "Add homework", "Add exam", "Edit homework", "Edit exam"
  ```

  `useHomeworkForm(): [HomeworkFormOpen | null, open: (form: HomeworkFormOpen) => void, close: () => void]` (main's `onHomeworkForm` events and the + both open it).

- [ ] **Step 1: Write the failing tests**

- `dueChoices(new Date(2026, 9, 27, 14))` (a Tuesday) gives labels `Today, Tomorrow, Thu, Fri, Sat, Sun` with days `2026-10-27` … `2026-11-01`.
- `toDue('2026-10-30', null)` is `{ kind: 'day', day: '2026-10-30' }`; `toDue('2026-10-30', '23:59')` is `{ kind: 'time', at: new Date(2026, 9, 30, 23, 59).getTime() / 1000 }`.
- `fromEntry` round-trips both kinds of due (`toInput(fromEntry(e))` deep-equals `e` without its id).
- `formProblem`: blank title → `'Give it a name.'`; course `undefined` → `'Pick a class, or No class.'`; no day → `'Pick a due date.'` (`'Pick the exam’s date.'` for an exam); complete → `null`.
- `formTitle('exam', true)` is `'Edit exam'`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/widgets/todo/homeworkForm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the form and the card changes**

- The + (`aria-label="Add homework or an exam"`, `title` the same, 44 px round, after the chips in `.todo-list__header`) opens `{ kind: 'homework', entry: null }`; it shows whenever the card isn't showing the Canvas form, also when nothing is connected.
- While the form is open the card title is `formTitle(...)`, the "N left" count and chips hide (like the Canvas form), and the body is `<HomeworkForm>`.
- `HomeworkForm`: Homework / Exam with `TabBar` (in edit mode it shows but can't change); Name (`autoFocus`, `maxLength={200}`), and for an exam the `EXAM_NAMES` chips fill it; Class chips from `TodoState.classes` plus "No class" (`aria-pressed`); Due chips from `dueChoices` plus "Pick a date…", which shows an `<input type="date">`; Time chips "No time", "11:59 PM" (`DEFAULT_TIME`), "Pick…", which shows an `<input type="time">`; Cancel and Add (Save when editing). Enter submits, Esc cancels, the problem shows under the fields in `role="alert"`, and `sendHomework`'s `{ ok: false }` message shows the same way. On success or cancel, focus goes back to the +.
- Chips reuse the card's chip look (`TabBar`-less buttons, `min-height: var(--hit)`), wrapping; the form scrolls inside the card when the card is short.
- Homework rows get `data-homework-id={providerId}` (the part after `homework:`), and their meta reads "MAT 265 · Due Fri".

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: the add form in the To-do card`)

---

### Task 7: The exam countdown strip

**Files:**

- Create: `src/renderer/widgets/todo/examView.ts` (pure), `src/renderer/widgets/todo/ExamStrip.tsx`, `src/renderer/widgets/todo/ExamStrip.css`
- Modify: `src/renderer/widgets/TodoList.tsx` (strip above the notes and the list, on every filter, not while the form shows)
- Test: `src/renderer/widgets/todo/examView.test.ts`

**Interfaces:**

- Consumes: `TodoState.exams`, `DUE_SOON_DAYS`, `useNow`.
- Produces:

  ```ts
  export interface ExamCountdown {
    id: string
    /** "BIO 181 Midterm", or the title alone with no class. */
    name: string
    /** "16", "1", or "Today". */
    big: string
    /** "days", "day", or null under "Today". */
    unit: string | null
    /** "Thu, Nov 12 · 9:00 AM", "Tomorrow · 9:00 AM", "Today · 9:00 AM · in 3 h". */
    when: string
    /** Within DUE_SOON_DAYS: the accent. */
    near: boolean
  }
  export function examCountdown(exam: ExamItem, now: Date, locale?: string): ExamCountdown
  export function examStrip(
    exams: readonly ExamItem[],
    now: Date,
    locale?: string
  ): { first: ExamCountdown; rest: ExamCountdown[] } | null
  ```

- [ ] **Step 1: Write the failing tests** (now = `new Date(2026, 9, 27, 6)`, locale `'en-US'`)

- Exam at 2026-11-12 09:00: `big '16'`, `unit 'days'`, `when 'Thu, Nov 12 · 9:00 AM'`, `near false`, `name 'BIO 181 Midterm'`.
- Day-only 2026-11-12: `when 'Thu, Nov 12'`.
- 2026-10-30 09:00 (3 days): `near true`; 2026-10-31 (4 days): `near false`.
- 2026-10-28 09:00: `big '1'`, `unit 'day'`, `when 'Tomorrow · 9:00 AM'`.
- 2026-10-27 09:00 at 06:00: `big 'Today'`, `unit null`, `when 'Today · 9:00 AM · in 3 h'`; at 08:20, `'… · in 40 min'`; at 08:59:30, `'… · in 1 min'`. A day-only exam today: `when 'Today'`.
- The count steps at midnight: an exam at 2026-10-29 00:30 is `'2' days` at 2026-10-27 23:59, even though it's under 25 h away.
- `examStrip([])` is null; with three exams, `first` is the first and `rest` has two.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/widgets/todo/examView.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the view and the strip**

`ExamStrip`: the big number over its unit on the left, name over `when` on the right, gold border and number when `near` (`--accent` for the border, `--accent-text` for the number); `data-homework-id` on it; "+N more" (a button, 44 px target) unfolds `rest` in place as one line each ("CHM 113 Quiz 3 · Thu · 2 days"), each with its own `data-homework-id`, and folds again. On a short card (`@container` on the To-do card, `container-type: size` on `.todo-list`; one line under about 18rem tall) the strip is one line: `name · big unit`. Names clip with an ellipsis.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: the exam countdown at the top of the To-do card`)

---

### Task 8: Customize › To-do sources and the To-do status dot

**Files:**

- Modify: `src/renderer/screens/customize/customizeView.ts`, `src/renderer/screens/customize/SourcesSection.tsx`, `src/renderer/screens/Customize.css` (icon size in the row)
- Modify: `src/main/services/status/cardStatus.ts`
- Test: `src/renderer/screens/customize/customizeView.test.ts`, `src/main/services/status/cardStatus.test.ts`

**Interfaces:**

- Consumes: `TodoState.items`, `TodoState.exams`, `SourceIcon`.
- Produces: the Homework row `{ id: 'homework', name: 'Homework', status, action: null }`, where status is `'On this Mac · 3 homework, 1 exam'` (`'… · 2 exams'`; one of the two alone when the other is 0; `'On this Mac · add some with the + on the To-do card'` when both are 0), counting open homework only. The status dot's line for Homework is `'Homework: on this Mac'`.

- [ ] **Step 1: Write the failing tests** for those strings, and that the demo's rows include Homework with `'On this Mac'` and no action.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/screens/customize src/main/services/status`
Expected: FAIL.

- [ ] **Step 3: Implement**; `SourcesSection` shows `<SourceIcon source={row.id} filled />` in place of `.customize__dot` for every source.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: its row in Customize, icons for every source`)

---

### Task 9: "Nearly due" tags in the class list

**Files:**

- Merge: `git merge claude/class-list-215d3f` into `worktree-homework` (again later if it gets new commits; resolve conflicts keeping both sides' intent)
- Create: `src/renderer/widgets/nextClass/dueTags.ts` (pure)
- Modify: `src/renderer/widgets/nextClass/ClassListCard.tsx` (`ClassRow` takes its tags), `src/renderer/widgets/nextClass/ClassListCard.css`, `src/renderer/widgets/nextClass/NextClass.tsx` (reads `useTodos()` and passes the tags)
- Test: `src/renderer/widgets/nextClass/dueTags.test.ts`

**Interfaces:**

- Consumes: `ClassWeekDay`/`ClassWeekRow` (class-list branch), `TodoState`, `courseKey`, `DUE_SOON_DAYS`.
- Produces:

  ```ts
  export interface DueTag {
    id: string
    kind: HomeworkKind
    text: string
    overdue: boolean
  }
  export interface RowTags {
    shown: DueTag[]
    more: number
  }
  /** Tags for each class's next meeting (the first row of that class not over yet), by event id. */
  export function dueTags(
    days: readonly ClassWeekDay[],
    todos: TodoState | null,
    now: Date,
    locale?: string
  ): Map<string, RowTags>
  ```

  Homework text: `'Problem set 7 · due today'`, `'· due tomorrow'`, `'· due Thu'`, with a time only when today (`'· due today 11:59 PM'`); overdue: `'Problem set 7 · overdue'`, `overdue: true`. Exam text: `'Midterm · today 9:00 AM'`, `'Midterm · tomorrow 9:00 AM'`, `'Midterm · Thu 9:00 AM'`, day-only without the time. Soonest first, at most 2 shown, the rest counted in `more`.

- [ ] **Step 1: Write the failing tests** (two days of rows built like `classWeek.test.ts` does)

- A homework for `'bio  181'` due tomorrow lands on the first not-past `BIO 181` row only (a past BIO 181 row today gets nothing).
- Due in 4 days: no tag; due in 3: a tag; ticked (done) homework: none; Canvas items: none; an overdue open homework: `overdue: true`, `'… · overdue'`.
- An exam in 2 days at 9:00: `'Midterm · Thu 9:00 AM'` with `kind 'exam'`.
- Three items for one class: two shown (soonest), `more: 1`.
- A class with no rows this week: no entry; `todos` null: empty map.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/widgets/nextClass/dueTags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** `dueTags`, then a `.class-list__tags` line under the name and room in `ClassRow`: homework tags in the homework colour with the outline pencil, exam tags in the accent, overdue in the card's overdue colour (the same token `.todo-item__meta--overdue` uses), `+1 more` as plain dim text; tags wrap, each clips with an ellipsis.

- [ ] **Step 4: Run the tests, then typecheck, lint and the whole suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all PASS.

- [ ] **Step 5: Commit** (`Homework: nearly due tags in the class list`)

---

### Task 10: CLAUDE.md, the graph, and seeing it run

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md**
  - Layout, `todos/`: `TodoProvider interface + providers: canvas, homework (Focus Screen's own homework and exams), google, apple-reminders, mock`.
  - Design defaults: `Source colors: Canvas #FF7F32, Reminders #00A3E0, Google #78BE20, Homework #A78BFA`.
  - Settings/userData list: `homework.json` (the user's own homework and exams; a ticked one leaves it at once).
  - Security and privacy, a new bullet: homework and exams are saved only in `homework.json` on this Mac, never sent anywhere or logged; the class picked for one is a class-calendar event's title, saved with it (approved by the user on 2026-10-27, on condition that a ticked homework is deleted for good an hour after, class name and all: it leaves the file the moment it's ticked and the screen an hour later; an exam leaves once it's over).
  - Design, a new bullet: the Homework source (purple pencil, the + form with Homework / Exam, class chips from the class calendars plus saved ones and No class, the exam strip's wording and its gold at 3 days, right-click Edit/Delete, the class list's tags).
- [ ] **Step 2: Run `npm run typecheck && npm run lint && npm test && npm run format`**, then `graphify update .`.
- [ ] **Step 3: Commit** (`Homework: CLAUDE.md`)
- [ ] **Step 4: Show the user.** `npm run dev` shares userData and the single-instance lock with the installed app: ask before quitting it. Electron's binary isn't downloaded in this worktree yet (`node_modules/electron/path.txt` missing): ask before running `node node_modules/electron/install.js`. Walk through: add a homework, add an exam, the strip, tick and untick, right-click Edit and Delete, Customize › To-do sources, the class list's tags (with `FOCUS_SCREEN_DEMO_CLASSES=1` if no real classes are on). Send screenshots.
