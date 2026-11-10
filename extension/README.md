# YouTube Music extension

Focus Screen gets YouTube Music through a small browser extension. The extension tells the app:
- what's playing;
- what's next in the queue;
- what's in the lyrics panel, when it's open;

and it lets the app play, pause and skip.

You only need it for YouTube Music. Apple Music and Spotify work without it on a Mac.

The extension isn't in the Chrome Web Store or the Mac App Store, so you build it from this
repository once. First, in the repository's folder:

```bash
npm install
```

## Chrome, Edge, Brave or Arc

**Easiest:** download `focus-screen-extension-chrome-*.zip` from **Releases** on this
repository's GitHub page (right-hand side), unzip it, then do steps 2–5 below and pick the unzipped
`focus-screen-extension` folder instead of `extension/dist`. You don't need Node or to build
anything. You still need Focus Screen itself running.

To build it yourself instead:

1. Build the extension:

   ```bash
   npm run build:extension
   ```

   This makes the `extension/dist` folder.
2. Open the browser's extensions page: `chrome://extensions` (Chrome and Arc), `edge://extensions`
   or `brave://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `extension/dist` folder.
5. Pin it: click the puzzle-piece icon in the toolbar, then the pin next to **Focus Screen**.

It needs version 111 or later of the browser.

## Safari (Mac)

Safari only loads extensions that come inside an app, so this builds a small app called
**Focus Screen Connector** with Xcode. You need Xcode and Safari 18 or later.

1. Open `native/safari-extension/Focus Screen Connector/Focus Screen Connector.xcodeproj` in
   Xcode.
2. Set a signing team on each of the two targets, the app and the extension. For each one, go
   to **Signing & Capabilities** › **Team** and pick your own. A free Apple ID's "Personal Team"
   works.
3. Back in Terminal, build and install it:

   ```bash
   npm run build:safari
   ```

   This puts **Focus Screen Connector** in `~/Applications`.
4. Open **Focus Screen Connector** once.
5. Turn it on in Safari: **Safari** › **Settings** › **Extensions** › tick **Focus Screen
   Connector**.
6. The first time you open music.youtube.com, allow it there (**Always Allow on This Website**).

## Connect it to Focus Screen

1. Open Focus Screen.
2. In the menu bar, choose **Music** › **Connect Browser Extension…**. A box shows a 6-digit
   code, which works for 5 minutes.
3. Click the **Focus Screen** extension in the browser's toolbar, type the code, and click
   **Connect**.
4. Open https://music.youtube.com and play something. If the tab was already open, reload it.

It stays connected until you click **Disconnect** in the extension. After 5 wrong codes, get a
new one from the menu.

## What it can see and send

- It only runs on `music.youtube.com`.
- It only talks to the Focus Screen app on your own computer (`127.0.0.1`). The app accepts it
  only from this extension, and only once it's paired with a code.
- It sends:
  - the song's title, artist, cover and times;
  - the queue;
  - the lyrics panel's words while that panel is on screen.
- It fetches album covers itself, so the app never contacts Google.
