# Rxmindly

Self-hosted prescription tracker and medicine reminder. Three parts: a server in Docker, a web app the server serves, and an Android app. Everything is behind a login. `README.md` has the user-facing setup.

## Layout

- `server/` — Node, zero npm dependencies, SQLite through Node's built-in `node:sqlite`.
  - `src/app.js` HTTP routes, static file serving, auth checks
  - `src/auth.js` scrypt passwords, session tokens (stored hashed), login rate limiter
  - `src/store.js` the data rules: applies client "ops", returns state
  - `src/db.js` schema and migrations (`MIGRATIONS` array, `PRAGMA user_version`)
- `web/` — React + TypeScript + Vite. One codebase is both the web app and the Android app.
  - `src/lib/logic.ts` pure logic: `applyOp`, what is due on a day, supply, history stats
  - `src/lib/store.ts` local state in `localStorage`, outbox, sync
  - `src/lib/journal.ts` the daily journal: built-in questions, which are active, trends for the charts
  - `src/lib/reminders.ts` Android local notifications (no-op in a browser)
  - `src/lib/transfer.ts`, `csv.ts` import and export: CSV per kind of data, and the JSON backup
  - `src/lib/widget.ts` hands the Android home screen widget its data
  - `src/lib/alarms.ts` the pure rules of alarm-style reminders (doses at the same moment become one alarm; snoozes); `alarm-native.ts` is the web side of the plugin; `components/AlarmScreen.tsx` is the full-screen view
  - `src/lib/sounds.ts` the little sounds (Web Audio, no files), switched off in Settings
  - `src/lib/haptics.ts` the vibrations that go with them (Android `HapticsPlugin`: haptic primitives where the phone has them, a waveform otherwise; `navigator.vibrate` in a browser), switched off in Settings
  - `src/lib/updates.ts` Android self-update from GitHub releases (checks when the app opens, comes into view, syncs by itself or is pulled down, at most every 5 minutes unless asked; no timer of its own)
  - `android/app/src/main/java/app/rxmindly/` hand-written native code: `NextDoseWidget` (the widget), `WidgetBridgePlugin` (how the web side reaches it) and `UpdaterPlugin` (downloads and installs an update) and `HapticsPlugin` (plays the vibrations) and `AlarmPlugin` + `AlarmCore` + `AlarmReceiver` + `AlarmService` (full-screen medicine alarms: `setAlarmClock` alarms kept in SharedPreferences so they survive a reboot, a foreground service that plays the alarm sound and vibration, an ongoing notification with a full-screen intent, and `MainActivity` showing over the lock screen while one is unanswered) and `FileSaverPlugin` (Android's "save to" screen for exports; a download link does nothing in the app's web view, so always save through `saveFile()` in `src/lib/save-file.ts`)
  - `src/screens/` Organizer, Cabinet, Journal, History, Settings, Login
  - `android/` Capacitor project. `android/app/src/main/assets/public` is generated; never edit it.
- `Dockerfile`, `docker-compose.yml` — one image: builds `web/`, serves it from the server.
- `build-apk.sh` — builds `rxmindly.apk` (release build, signed) at the project root.
- `release.sh <version>` — bumps the version, tags and pushes; `.github/workflows/release.yml` then builds the APK and publishes a GitHub release.

## Commands

```sh
cd server && npm test        # API tests (node:test)
cd server && npm start       # dev server on :8080, data in server/data/
cd web && npm test           # logic tests (vitest)
cd web && npm run build      # type-check + bundle; run this before calling UI work done
cd web && npm run dev        # live reload, proxies /api to :8080
./build-apk.sh               # Android APK; finds the SDK and JDK under ~/Android
./emu.sh start               # boot the Android emulator headless; ./emu.sh for all commands
node server/demo-data.js     # fill a test server (default localhost:8099) with demo data
podman build -t rxmindly . # docker is not installed on the dev machine; podman is
```

## Rules that are easy to break

- **Ops are implemented twice.** Clients send idempotent ops (`med.put`, `med.delete`, `stock.set`, `dose.put`, `dose.delete`, `refill.add`, `question.put`, `journal.put`) to `POST /api/sync`. `server/src/store.js` applies them in SQL; `web/src/lib/logic.ts` `applyOp` applies the same rules locally so the app works offline. Change both together, and add a test on each side.
- **Every op must be safe to send twice.** A phone that misses the response resends its outbox. Scheduled dose ids are deterministic (`<scheduleId>:<date>`) for this reason.
- **Alarm style is a setting (`reminderStyle`), not a different kind of dose.** In alarm style `reminders.ts` schedules no dose notifications; it hands the native side one alarm per moment (`alarmSlots`), each listing every medicine due then. `AlarmPlugin.schedule` replaces them all each time, like the notifications. What is ringing or waiting is stored natively (`active`), so the screen is found again even if the app wasn't open. The screen can only close once every medicine is taken, skipped or snoozed; "Stop alarm" only silences it. A snooze is saved in the same `rxmindly.snoozes` list the notification snooze uses and becomes another alarm. Android only lets an alarm take over the screen if "full-screen intents" is allowed for the app (Settings shows a button when it isn't), and only when the phone is locked or idle: in use, it shows as a banner (the app in front shows its screen at once).
- **Follow-up doses hang off a schedule.** `schedule.followUps` is a list of `{ afterMinutes, qty }` (a JSON column on the server). Each is due that long after the dose before it was *taken* (`takenAt`), so its time is worked out in `dueOn`, never stored. Dose ids are `<scheduleId>:<date>:<n>`, n from 1. Until the dose before is recorded the time is a guess (`estimated`) and no reminder is scheduled.
- **Changing when a dose was taken is just `dose.put` again** with a new `takenAt` (and `time`, for as-needed doses). No separate op.
- **The journal is one entry per day.** `journal.put` replaces that day's whole entry (`answers` is question id → 1–5, decimals allowed, plus `note`); an entry with no answers and no note is deleted. The built-in questions live only in the app (`DEFAULT_QUESTIONS`); the server stores the user's own questions and, for a switched-off built-in one, a row with the same id and `archived`. Questions are archived, never deleted, so old answers stay.
- **Importing is done with ops, on the client.** `planImport` turns a CSV or backup file into ordinary ops, so there is no import route on the server and importing a file twice changes nothing (rows without an id get a deterministic one). Imported doses and refills are followed by `stock.set` so old history never moves the pill count. The outbox is sent in batches (`firstBatch` in `store.ts`), because one import can queue thousands of ops.
- **Colors are a named color or `#rrggbb`.** Always paint with `cssColor()`, never `var(--med-…)` directly. The named list exists in `types.ts`, `styles.css` (light and dark) and `server/src/store.js`.
- **`med.put` never changes stock on an existing medicine.** Stock moves only through doses, refills and `stock.set`, so a stale edit can't undo a recorded dose.
- **Dates and times are local strings**, `YYYY-MM-DD` and `HH:MM`, never UTC timestamps. Only `takenAt` is an ISO instant. The server does no time-zone maths.
- **Schedules are ended, not rewritten.** Editing a time ends the old schedule (`endDate`) and starts a new one, so past days keep the schedule they had. See `reviseSchedules`.
- **Every `/api` route except `status`, `setup` and `login` must call `authenticate`.** All queries filter by `user_id`.
- **The phone can have two addresses for the same server**: `serverUrl` (main) and `backupUrl` (usually its home-network IP). Every request goes through `withServer()` in `store.ts`, which switches to the other address only when the one in use can't be reached (`ApiError` status 0), never on a 401 or other refusal. Before the token goes to the other address, its `/api/status` must report the same `instanceId` (a random id the server makes once, in the `meta` table), so a stranger's device at the same LAN IP on another network never receives it. Never call `api.*` with an address directly from a screen.
- The Android app reaches the server through Capacitor's native HTTP (`CapacitorHttp` in `capacitor.config.ts`), so the server sends no CORS headers. Keep it that way.
- Layout uses `--safe-area-inset-*` CSS variables that Capacitor injects on Android; keep `--safe-top` / `--safe-bottom` on anything pinned to a screen edge.

## Releases and the signing key

- The app version is `web/package.json` `version`; `build.gradle` derives `versionName` and `versionCode` from it. Never hand-edit those in Gradle.
- A release is a tag `v<version>` with `rxmindly.apk` attached. Phones find it through the GitHub releases API (`UPDATE_REPO` in `updates.ts`) and install it over the top.
- **Claude does the versioning.** The user only gets app changes through a release, so after committing and pushing a change that affects the app (anything under `web/`), also run `./release.sh <next version>` without being asked. Pick the number: patch (1.1.2 → 1.1.3) for fixes and small changes, minor (1.1.x → 1.2.0) for new features, major only if the user says so. Build and test first. Server-only or docs-only changes need no release (the server is deployed by hand, see below). Only ever push or release when the user has asked for the change to be committed and pushed.
- `origin` is `git@github.com:voidxzero/rxmindly.git` over SSH (key `~/.ssh/id_ed25519`, no passphrase); HTTPS has no stored credentials on the dev machine.
- Node 24 is installed per-user in `~/.local/opt/`, linked from `~/.local/bin` (no sudo on the dev machine).
- The Android SDK is in `~/Android/Sdk` and JDK 21 in `~/Android/jdk-21` (installed 2026-11-16), where `build-apk.sh` looks for them, so `./build-apk.sh` runs locally. **The release key is not on the dev machine** (`~/.config/rxmindly/` doesn't exist), so local APKs are debug-signed: fine for the emulator, but they can't be installed over the user's release build. Releases still come only from the workflow. After a build, `cd web/android && ./gradlew --stop` frees about 2 GB held by the Gradle and Kotlin daemons; the machine has 16 GB and is often short.
- **Android emulator: `./emu.sh`** (run it with no arguments for the commands). The virtual phone is `rxphone` (Pixel 7, Android 16), always on port 5580 (`emulator-5580`). Another project's emulator may be running too (`emulator-5554`); never touch it, and always go through `emu.sh` or `adb -s emulator-5580`. Typical loop: `./build-apk.sh && ./emu.sh start && ./emu.sh install && ./emu.sh launch`, then `ui` (on-screen text with tap points), `tapt "Label"`, `type`, `shot <file>` and Read the PNG to see it. From the phone, a test server on this machine is `10.0.2.2:8099`. Lessons learned: text goes in through the emulator's hardware keyboard (`adb emu event text`), because `adb shell input text` goes through Gboard, which garbles it in a web view; the emulator is started without `DISPLAY`, because an inherited X connection crashed it when the xrdp session ended; it can't run under `systemd-run --user`, because the user manager predates the user's `kvm` group. A cold boot takes about 1.5 minutes, and `start` answers the "System UI isn't responding" dialog that follows.
- **Screenshots and demo data:** `node server/demo-data.js http://localhost:8099 demo demo-password` fills a throwaway server with made-up medicines, a month of history and journal entries (idempotent; never point it at a real account). `./emu.sh clean on` sets a tidy status bar (9:41, full battery). README screenshots live in `docs/screenshots/`: Android at 720×1600 (`./emu.sh adb shell wm size 720x1600` and `wm density 280`, which is the Pixel 7's layout at lower resolution), web at 1280×800 through Playwright.
- Headless Chromium for checking the web app: Playwright's `chromium-headless-shell` in `~/.cache/ms-playwright`, with the system libraries and fonts it needs unpacked (no sudo) into `~/.local/opt/chromium-libs`. Run `. ~/.local/opt/chromium-libs/env.sh` first, or the browser can't find its libraries and crashes on the first text it draws. Playwright itself isn't a project dependency; install it in the scratchpad (`npm i playwright@1.56.1`) and point a throwaway server at a temp database (`PORT=8099 RXMINDLY_DB=<tmp>/test.db node src/index.js`, serves `web/dist`).
- **Every APK must be signed with the same key** or Android refuses it as an update. The key is `~/.config/rxmindly/release.jks` with its password in `keystore.properties` beside it; the release workflow reads a copy from the repo's `KEYSTORE_BASE64` / `KEYSTORE_PASSWORD` secrets. Never commit it, never regenerate it, never print the password. Without the key the build falls back to the debug key, which is only good for a fresh install.
- The repository is public (since 2026-11-13), so the phone checks and downloads releases with no token. The Settings field for a GitHub token was removed; `UpdaterPlugin` still accepts an optional `token` should the repo ever go private again.

## Deployment (the user's server)

- Runs with `docker compose up -d --build` from the project folder on the server, kept under `/home/richard/docker/`.
- Published on host port **8060** (container port stays 8080).
- Data is a bind mount, `./data:/data`: the database is `data/rxmindly.db` beside the compose file. The folder must be owned by uid 1000, the container's user.
- `update-docker.sh` does the copy and rebuild. It is the user's own script and lives in the docker folder on the server (`~/docker/rxmindly`, run from there); a working copy sits untracked in the project root. Never commit it (it's listed in `.git/info/exclude`).
- Before that script, the project was copied to the server by hand over SFTP. Only `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `server/` and `web/` (without `node_modules`, `dist`, `android`) are needed there. Never copy over or delete the server's `data/` folder.
- In the Android app the server address is entered at sign-in, e.g. `<server-ip>:8060`, with an optional local address used when the main one can't be reached. Both can be changed later in Settings → Your server (the local one without signing out).

## State of testing

- Server and logic tests pass. The web app was checked in headless Chromium at phone and desktop sizes, light and dark.
- **The home screen widget, haptics, stale-notification clearing, pull-to-sync and swipe between days have never been tried on a real phone.** The emulator works since 2026-11-16 (see `./emu.sh`), so check native changes there before calling them done. Haptics can only be checked to be triggered, not felt.
- The user installed the first Android build on their phone on 2026-11-11 and reported it working. Sign-up, sign-in, the organizer, cabinet, journal and history ran correctly in the emulator on 2026-11-16 (version 1.5.1).
- The web app has no reminders; they come only from the Android app. The daily journal reminder (off by default) is part of the same schedule and is skipped on days already written. Reminders are scheduled 14 days ahead each time the app runs.

## Conventions

- UI text is plain, American spelling, and uses the real-life metaphors: "pill organizer", "medicine cabinet", "bottle", "refill".
- A medicine's picture is `med.icon` (`MED_ICONS`); empty means "follow the form" (`iconOf`). The list exists in `web/src/lib/types.ts` and `server/src/store.js`; keep them the same.
- Animations (`lib/celebrate.ts`, the `.fresh` classes, the overdue-pill wiggle and low-bottle wobble) must stay off under `prefers-reduced-motion`.
- Journal answers are always stored on 1 (low) to 5 (high), up to three decimals. The scale the user picks in Settings (1–5, 1–10, 1–15, 1–20; numbered buttons or a plain slider) only changes how questions are asked and charts are labelled (`toScale` / `fromScale` in `journal.ts`), so changing it never changes past answers. The built-in questions are worded so the top is the good end, which keeps every chart reading the same way.
- `/api/status` lists `features` (e.g. `journal-decimals`). The app checks it before offering anything an older server would refuse, since the server is updated by hand and can lag behind the app.
- Chart status colors (taken / some taken / missed / skipped) always carry an icon or number as well as color.
- The app was called Mediminder until 2026-11-12 and was renamed throughout with no carry-over for old installs (there was no data to keep). The old name should not appear anywhere in the code.
- The git history starts on 2026-11-12 with one commit of the already-working app; there is nothing older to look up.
