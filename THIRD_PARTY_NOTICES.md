# Third-party notices

Focus Screen's own code is under the MIT License (see `LICENSE`). This repository also contains,
or the app uses, the following works by others.

## Included in this repository

### University domains list (`src/main/services/calendar/schools.json`)

Data from Hipo's university-domains-list, https://github.com/Hipo/university-domains-list

```
The MIT License (MIT)

Copyright (c) 2014-2025 Hipo

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### React (`design/*/vendor/react.js`, `react-dom.js`)

Copies of React's production builds are used only by the HTML mockups in `design/`.
Copyright (c) Facebook, Inc. and its affiliates. MIT License (the notice is kept at the top of
each file).

### ASU shuttle timetables (`src/main/services/transit/asuShuttle.ts`)

Service times and the academic calendar are transcribed from Arizona State University's public
shuttle timetables and registrar calendar. They are facts published by ASU. This project is not
affiliated with ASU.

## Installed by `npm install` (not in this repository)

The app's dependencies keep their own licenses in `node_modules`. The two that ship inside the
built app:

- **kuromoji** 0.1.2: Apache License 2.0. Its bundled dictionary is the IPADIC, under the
  license in kuromoji's `dict` folder.
- **ws**: MIT License.

The build tools (Electron, electron-vite, Vite, React, TypeScript, Vitest, ESLint, Prettier) are
under the MIT or Apache 2.0 licenses.

## Data the app downloads at runtime (not in this repository)

- **Valley Metro schedule and live times**, as the City of Phoenix publishes them on its Open
  Data portal: credited in the app as "Data: Valley Metro via City of Phoenix Open Data".
- **Weather from Open-Meteo** (https://open-meteo.com), CC BY 4.0: credited in the app as
  "Weather: Open-Meteo".
- **ASU's public building list**, from ASU's facilities map service.
- **School building maps from OpenStreetMap** (© OpenStreetMap contributors, ODbL), fetched
  only when the user asks for one.
- **Lyrics from LRCLIB and VocaDB**: lyrics belong to their rights holders. The app only shows
  them on the user's screen and never ships or republishes them.

## Trademarks

Project SEKAI is a trademark of SEGA and Colorful Palette. The app ships no character art: a
singer's badge is their initials on their color. Apple Music, Apple Reminders, Google Tasks,
Google Calendar, Canvas, Spotify, YouTube Music, Safari and Chrome are trademarks of their
owners. The to-do source icons in `assets/sources/` are generic shapes, not their logos. This
project isn't affiliated with or endorsed by any of them.
