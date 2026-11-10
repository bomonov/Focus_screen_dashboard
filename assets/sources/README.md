# To-do source icons

The to-do checkbox is the source's icon: `*-outline.svg` while a to-do is open, `*-filled.svg`
once it's done. Swap these files to change the icons (keep the names).

- Draw on a 24×24 `viewBox` and use `currentColor`; the app colors each icon with its source
  color (`--source-canvas`, `--source-homework`, `--source-reminders`, `--source-google` in
  `src/renderer/theme/tokens.css`).
- These are generic shapes (graduation cap, pencil, bell, check circle). Don't put real brand logos here
  in a build that's shared publicly.
