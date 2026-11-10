# Homework and exams of your own: design

2026-10-27. The user's request: "add a custom homework tab on the to-do allow you to add your own stuff, an in app task add-on, with the selection of what hw for that class so and so; I can add those manually. maybe add something to let me add the final or exams date as well, and when the exam or task date are nearly due, we can see that in the class list pill". The moment behind it: "in class, prof said the midterm date, wanted a countdown", shown "the whole time". Mockups (git-ignored, in the brainstorm session's scratch folder): `countdown-place.html` (picked B), `add-homework.html` (picked A), `homework-icon.html` (picked A), `class-list-due.html` (picked A).

## Why

Focus Screen's To-do card only shows what Canvas, Google Tasks and Apple Reminders hold. Homework a professor gives out in class, and exam dates said out loud, have nowhere to go unless the user puts them in one of those apps. ASU turns Canvas access tokens off, so Canvas only comes through its read-only calendar feed, and the user has said to leave Canvas out of this work. They want to type their own homework and exam dates straight into Focus Screen, pick the class from the classes it already knows, see a countdown to the next exam all the time, and see in the week's class list what's due soon for each class.

## Goals

- A new to-do source that lives only in Focus Screen: **Homework**. The user adds homework (name, class, due date, optional time) and ticks it off in the To-do card like any other to-do.
- **Exams** (midterms, finals, quizzes) added the same way, shown as a countdown at the top of the To-do card from the day they're added until they're over.
- The class for either is picked from the classes in the user's class calendars.
- In the week's class list (dropped from the Next class pill, built in another session), each class's next meeting shows what of the user's own is due within 3 days.
- Works with nothing else connected, on any platform (no native helper).

## Non-goals

- Canvas items in the class list's tags, or matching Canvas assignments to classes ("i will just ignore canvas for now").
- Syncing homework anywhere: no iCloud, no Google, no export.
- Notes, links, page numbers, priorities or repeating homework. The user knows "usually just the name, class and due date".
- Reminders or notifications before a due date.
- A countdown or badge on the Next class pill itself (option C of the last mockup, not picked).

## Anti-goals (a failure even if it works)

- Homework or class names ever leaving the Mac (network, logs, console, crash output).
- A ticked homework, with its class name, kept on disk after the hour is up.
- The countdown strip crowding the To-do list off a short card.
- Adding taking more than a few clicks: the form must be quicker than opening Reminders.
- Small, low-contrast text or targets under 44 px (CLAUDE.md: readable from about 1 m).
- Finite CSS keyframe animations inside the card (CLAUDE.md; use the Web Animations API or `usePlayOnMount`).

## Decided with the user

**Privacy, approved 2026-10-27 on a condition.** The user agreed that a class name picked from a class-calendar event's title ("BIO 181") is saved next to the homework or exam in a file on this Mac, on the condition that a ticked homework is deleted for good an hour after it's ticked, class name and all. Asked in review whether that must hold while Focus Screen isn't running (quit, crash, shut down within the hour), the user took the strict way ("ok" to the recommendation): a tick wipes the homework from the file at once; it only stays on screen, done, for the hour, in memory; unticking within the hour saves it again; a quit within the hour means it's simply gone. Exams are deleted once they're over (below). Nothing is ever sent anywhere. This is a new place calendar titles live, so CLAUDE.md's Security and privacy section gets a bullet saying so, with the date and the condition, and the Next class bullet ("Never log their titles") stays true for homework too: never log homework titles or class names.

**The exam countdown (option B).** A strip pinned at the top of the To-do card, above the to-dos: the days left as a big number with "days" under it, and the exam's name with its class and date beside it ("BIO 181 Midterm", "Thu, Nov 12 · 9:00 AM"). The user wants it "the whole time", from the day it's added until the exam is over. Played back and confirmed:

- Only the soonest exam gets the strip; when more are coming, a small "+2 more" opens the rest.
- Far off it counts in days ("16 days"). The day before it reads "Tomorrow · 9:00 AM", on the day "Today · 9:00 AM · in 3 h".
- At 3 days or less it turns gold (the accent), as the Next class pill does before class.
- Once its start time has passed (or its day has ended, when it has no time) it leaves on its own and is deleted. Exams aren't ticked off.
- On a short card the strip shrinks to one line, so the to-dos keep their room.
- Exams don't count toward "N left".

**Adding (option A).** A **+** in the To-do card's title row turns the card into a small form, the way the Canvas connect form takes the card today (the card's title becomes "Add homework"). A Homework / Exam switch at the top. Fields:

- **Name**: a text field. With the switch on Exam, quick picks Midterm, Final and Quiz fill it.
- **Class**: one chip per class (below), plus "No class" for the user's own things.
- **Due**: chips Today, Tomorrow, the next few weekdays, and "Pick a date…". A due date is required (an exam's date too).
- **Time (optional)**: No time, 11:59 PM, "Pick…".
- Cancel and Add. The card goes back to the list.
  The + works even when no other source is connected.

**Classes come from the calendar.** The user's class events are named with just the course code ("BIO 181"). The chips are the distinct titles of the events in the picked class calendars (Apple Calendar or Google Calendar, the next 8 days Next class already reads), plus any class already used by a saved homework or exam, so chips don't vanish over a break with no classes.

_Builder's call, made in review:_ there's no typing a class. Where the calendar gives none (the Next class pill off, no class calendars picked, or Windows, where Next class doesn't run yet), the chips are only the classes already used, plus "No class". The form never starts reading calendars on its own: it uses what Next class already reads.

**On the card.** A homework sits in the list among the rest, sorted the same way, with its meta line "MAT 265 · Due Fri" (no source name in front, since the icon says it). Its icon is its checkbox: a **purple pencil** (option A), outline while open, filled once ticked. The filter chips get **Homework**. Ticking works as for every source (bounce, 0.7 s hold, FLIP glide). Ticked, it's deleted from the file at once and shows as done for an hour, then it's gone from the screen too; unticked within the hour, it's saved again and stays. Right-clicking a homework row, or the exam strip, gives **Edit…** and **Delete**; Edit opens the same form, filled in.

**Customize › To-do sources.** Homework gets its own row with the purple pencil, saying something like "On this Mac · 3 homework, 1 exam", with no connect button. The other sources' rows switch from coloured dots to their own icons too.

**The class list (option A).** In the week list that a double-click drops from the Next class pill, each class's **next meeting** (the first row for that class that isn't over) gets small tags under its name and room: one per homework or exam of that class due within 3 days, "Problem set 7 · due tomorrow" (purple, with the pencil) or "Midterm · Thu 9:00 AM" (gold). Ticked-off homework doesn't count; overdue homework that isn't ticked does, in the card's overdue red. At most 2 tags on a row, then "+1 more". The pill itself doesn't change. Only the user's own homework and exams count, not Canvas.

**Demo.** With nothing connected in a dev build, the demo shows a couple of made-up homeworks and exams too, so `npm run dev` still looks full (CLAUDE.md's rule for every source).

## The data

One file, `homework.json` in userData, written atomically with `services/jsonFile.ts` and parsed as untrusted on every read (a broken or odd file only loses what can't be read; caps on the number of items and on each text's length, like `feedMarks.ts`). Each entry:

- `id`: made on this Mac.
- `kind`: `'homework' | 'exam'`.
- `title`: the name.
- `course`: the class chip's text, or null for "No class".
- `due`: the existing `TodoDue` (`{ kind: 'day', day: 'YYYY-MM-DD' }` without a time, `{ kind: 'time', at }` with one).

No done flag or time is ever written: a ticked homework isn't in the file at all. The ticked ones of the last hour are kept in memory only (with when they were ticked), so unticking can save one back.

What goes, and when (pure functions, tested): a ticked homework leaves the file the moment it's ticked, and leaves the screen an hour later; an exam whose time has passed, or whose day has ended when it has no time, is dropped on load and as it ends while the app runs, and the file is rewritten without it (give or take the check's interval; a minute is fine). An exam that ends while the app isn't running stays in the file until the next launch; the user's condition was about ticked homework. When nothing is left the file is removed, as `canvas-feed-done.json` is.

Overdue homework that isn't ticked is never deleted: it stays in the list, overdue, like any source's.

## How it fits the app

- **A to-do source like the others.** `TodoSourceId` gains `'homework'` with its own provider folder, `src/main/services/todos/homework/`, behind `TodoProvider`: always connected, `list()` returns the homework (not the exams), `setDone(true)` removes the homework from the file and keeps it in memory as done for the hour; `setDone(false)` within the hour writes it back. Merging, sorting, overlays and the tick animation stay as they are. A mock version joins `createMockTodoProviders`.
- **Exams and classes ride in `TodoState`.** It gains the exams (soonest first, the fields above) and the class chips, so the card, Customize and the class list read one state. `TodoItem` gains `course: string | null` so the class list can match a homework to a class without parsing `context`. IPC channels and payload types go in `src/main/ipc.ts` as always; adding, editing and deleting are new requests (a command, or an invoke with a result like `todosCanvasForm`, so the form can show what's wrong). Main checks every request as untrusted (title length, a real day, a known kind).
- **The class chips** are worked out in main from the calendar service's events (titles of events in the picked class calendars, trimmed, deduplicated) plus the saved courses. Calendar titles still only go from the helper or Google to the screen; the only new thing is that a picked one is saved with the homework (approved above).
- **The demo** must keep working: today it shows while every real source is disconnected, and Homework is always "connected". The demo should still show while the user has no homework or exams of their own and nothing else is connected, and step aside once they add one, so a real entry is never hidden behind made-up ones.
- **Menus.** The right-click menu on a homework row or the exam strip is the usual glass right-click menu (`quickMenuItems`) with that item's Edit… and Delete on top; main has to know which item was right-clicked.
- **Platforms.** Nothing native, so homework and exams work on Windows too, but without class chips until Next class runs there (M9): the calendar service only runs on macOS today.

## What the other session owns

The class list is being built in the "Class list on the Next class pill" session (branch `claude/class-list-215d3f`: `ClassListCard.tsx`, `classWeek.ts`). It was told the plan and the data shape on 2026-10-27. The plan: build everything else on this branch first, then merge `claude/class-list-215d3f` into this branch (and again whenever it gets new commits) and add the tags inside its `ClassRow` (a line under `.class-list__what`), using `classWeek`'s rows to find each class's next meeting. Matching a homework's `course` to an event's title ignores case and runs of spaces. The coordinating session (2026-10-27) merges all four parallel branches into main at the end, class list before this one, and installs once: "wait until all 4 done and merge and install at once", the user said there. So this branch never merges into main or installs.

## CLAUDE.md updates (part of done)

- Layout: `todos/` lists the new `homework` provider.
- Design: a bullet for the Homework source (purple pencil, the + form, the exam strip and its wording, an hour until a ticked one goes) and, once added, the class list's tags.
- Settings and userData: `homework.json`.
- Security and privacy: the bullet above, dated 2026-10-27.
- Design defaults: the Homework source colour beside Canvas, Reminders and Google.

## Left to the builder

- The exact purple. `#A78BFA` was in the mockup; it sits with the other sources at about 6.5:1 on the dark card, 3.3:1 on Maroon and 2.7:1 on Daylight, where the other three sources are 2.3–2.9:1. Keep it a token beside `--source-canvas` and friends.
- The pencil's outline and filled SVGs in `assets/sources/`, in the same stroke and size as the others.
- Where the Homework chip sits among the filter chips, and how the + looks in the title row on a narrow card (the chips already wrap under the title there).
- How "+2 more" shows the other exams (unfolding the strip in place is fine), and how "Pick a date…" and "Pick…" take a date and time (Chromium's own date and time fields are fine if they read at 1 m and fit the theme).
- How many weekday chips fit, and what the Due chips say past a week.
- Whether Delete asks first or offers a short Undo; it must not be a single slip with no way back.
- Whether "Add Homework…" and "Add Exam…" also go in the To-do menus (app menu, the card's dot, right-click), opening the card's form.
- Keyboard: Tab through the form, Enter adds, Esc cancels, focus back on the + afterwards.
