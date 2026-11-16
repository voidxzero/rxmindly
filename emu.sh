#!/usr/bin/env bash
# Drives the Android emulator so the app can be run, tested and screenshotted
# from the command line. The virtual phone is "rxphone" (Pixel 7, Android 16),
# always on port 5580 so it never gets mixed up with another emulator.
#
#   ./emu.sh start                 boot the phone headless (no-op if running)
#   ./emu.sh stop                  shut it down
#   ./emu.sh install [apk]         install rxmindly.apk (or the given file)
#   ./emu.sh launch                start (or bring forward) the app
#   ./emu.sh restart               force-stop the app and start it again
#   ./emu.sh shot [file.png]       screenshot (default: shots/<time>.png)
#   ./emu.sh ui                    list the text on screen with tap points
#   ./emu.sh tapt "Label" [n]      tap the nth (default 1st) element whose text
#                                  or description contains Label
#   ./emu.sh tap X Y               tap screen pixels
#   ./emu.sh type "text"           type into the focused field
#   ./emu.sh key NAME              press a key (BACK, ENTER, HOME, DEL...)
#   ./emu.sh swipe X1 Y1 X2 Y2 [ms]
#   ./emu.sh clear [n]             delete n characters (default 40) in the field
#   ./emu.sh dark on|off           system dark mode
#   ./emu.sh clean on|off          tidy status bar for screenshots (9:41, full battery)
#   ./emu.sh logs                  the app's recent web console and crash output
#   ./emu.sh adb ...               any other adb command, aimed at this phone
#
# From the emulator the computer it runs on is 10.0.2.2, so a test server at
# localhost:8099 is entered in the app as 10.0.2.2:8099.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export JAVA_HOME="${JAVA_HOME:-$HOME/Android/jdk-21}"
PORT=5580
SERIAL="emulator-$PORT"
ADB=("$ANDROID_HOME/platform-tools/adb" -s "$SERIAL")
ROOT="$(cd "$(dirname "$0")" && pwd)"
PKG=app.rxmindly

adb() { "${ADB[@]}" "$@"; }
running() { "$ANDROID_HOME/platform-tools/adb" devices | grep -q "^$SERIAL\s*device"; }
need() { running || { echo "The emulator isn't running. Start it with ./emu.sh start" >&2; exit 1; }; }

# Dumps the screen's view tree and prints one line per element with text:
# "x y  text". Works for the web view too, since Chrome exposes its DOM text.
ui_dump() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb exec-out cat /sdcard/ui.xml | node -e '
    const xml = require("fs").readFileSync(0, "utf8");
    const dec = s => s.replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,"\"").replace(/&#39;/g,"\x27");
    for (const m of xml.matchAll(/<node [^>]*>/g)) {
      const a = m[0];
      const text = dec((a.match(/ text="([^"]*)"/) || [])[1] || "");
      const desc = dec((a.match(/ content-desc="([^"]*)"/) || [])[1] || "");
      const b = (a.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) || []).slice(1).map(Number);
      const hint = dec((a.match(/ hint="([^"]*)"/) || [])[1] || "");
      const field = / class="android.widget.EditText"/.test(a);
      const label = text || desc || (field ? `[field] ${hint}` : "");
      if (!label || b.length < 4 || b[2] <= b[0] || b[3] <= b[1]) continue;
      console.log(`${(b[0]+b[2])>>1} ${(b[1]+b[3])>>1}  ${label.replace(/\s+/g, " ")}`);
    }'
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  start)
    if running; then echo "Already running ($SERIAL)"; exit 0; fi
    mkdir -p "$HOME/Android/logs"
    args=(-avd rxphone -port "$PORT" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot-save)
    # Started with no display: even headless, an emulator that inherits
    # DISPLAY keeps a connection to it and crashes when the remote desktop
    # (xrdp) session ends. Not through systemd-run: the user manager predates
    # the kvm group membership, so it has no hardware acceleration.
    env -u DISPLAY -u WAYLAND_DISPLAY QT_QPA_PLATFORM=offscreen \
      nohup setsid "$ANDROID_HOME/emulator/emulator" "${args[@]}" > "$HOME/Android/logs/emulator.log" 2>&1 &
    timeout 180 "${ADB[@]}" wait-for-device || {
      echo "The emulator didn't come up. End of $HOME/Android/logs/emulator.log:" >&2
      tail -n 15 "$HOME/Android/logs/emulator.log" >&2; exit 1; }
    for _ in $(seq 1 120); do
      [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ] && break
      sleep 2
    done
    sleep 3
    adb shell input keyevent KEYCODE_WAKEUP
    adb shell wm dismiss-keyguard
    adb shell svc power stayon true
    # Typing goes through the emulated hardware keyboard (see "type"), so the
    # on-screen one isn't needed; hiding it keeps it out of screenshots.
    adb shell settings put secure show_ime_with_hard_keyboard 0
    # With software graphics the system UI is slow to settle after a cold boot
    # and Android puts up "System UI isn't responding". Answer "Wait".
    for _ in $(seq 1 10); do
      sleep 3
      hit="$(ui_dump | grep -m1 -E '  Wait$' || true)"
      [ -n "$hit" ] && { set -- $hit; adb shell input tap "$1" "$2"; }
    done
    echo "Booted ($SERIAL)"
    ;;
  stop)
    running && adb emu kill >/dev/null || true
    echo "Stopped"
    ;;
  install)
    need; adb install -r "${1:-$ROOT/rxmindly.apk}"
    ;;
  launch)
    need; adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    ;;
  restart)
    need; adb shell am force-stop "$PKG"
    adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    ;;
  shot)
    need
    out="${1:-$ROOT/shots/$(date +%H%M%S).png}"
    mkdir -p "$(dirname "$out")"
    adb exec-out screencap -p > "$out"
    echo "$out"
    ;;
  ui)
    need; ui_dump
    ;;
  tapt)
    need
    want="$1"; nth="${2:-1}"
    # Exact label matches first, then labels that merely contain the text.
    hit="$(ui_dump | awk -v w="$want" '{ l = substr($0, index($0,"  ")+2) }
      l == w { exact[++e] = $0 } l != w && index(l, w) { part[++p] = $0 }
      END { for (i = 1; i <= e; i++) print exact[i]; for (i = 1; i <= p; i++) print part[i] }' | sed -n "${nth}p")"
    [ -n "$hit" ] || { echo "Nothing on screen matches \"$want\"" >&2; exit 1; }
    set -- $hit
    adb shell input tap "$1" "$2"; sleep 0.6
    echo "tapped $hit"
    ;;
  tap)
    need; adb shell input tap "$1" "$2"
    ;;
  type)
    # Sent as hardware key presses through the emulator console. "adb shell
    # input text" goes through Gboard instead, which mangles fast typing in a
    # web view ("10.0.2.2" came out as "10..0.2.2g").
    need; adb emu event text "$1" >/dev/null
    ;;
  key)
    need; k="$1"; [[ "$k" == KEYCODE_* ]] || k="KEYCODE_$k"; adb shell input keyevent "$k"
    ;;
  swipe)
    need; adb shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"
    ;;
  clear)
    need
    adb shell input keyevent KEYCODE_MOVE_END
    adb shell input keyevent $(printf 'KEYCODE_DEL %.0s' $(seq "${1:-40}"))
    ;;
  dark)
    need; [ "${1:-on}" = on ] && adb shell cmd uimode night yes || adb shell cmd uimode night no
    ;;
  clean)
    need
    if [ "${1:-on}" = on ]; then
      adb shell settings put global sysui_demo_allowed 1
      d() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
      # Exit first: demo mode keeps icons from earlier rounds (a second wifi
      # icon, "3G"). Mobile has to be hidden before wifi is shown.
      d exit; sleep 1
      d enter
      d clock -e hhmm 0941
      d battery -e level 100 -e plugged false
      d network -e mobile hide
      d network -e nosim hide
      d network -e wifi show -e level 4 -e fully true
      d notifications -e visible false
      echo "Status bar tidied"
    else
      adb shell am broadcast -a com.android.systemui.demo -e command exit >/dev/null
      echo "Status bar back to normal"
    fi
    ;;
  logs)
    need
    pid="$(adb shell pidof "$PKG" | tr -d '\r' || true)"
    if [ -n "$pid" ]; then adb logcat -d --pid="$pid" | grep -E "Capacitor|Console|chromium|AndroidRuntime|Exception" | tail -n "${1:-40}"
    else adb logcat -d | grep -E "AndroidRuntime|$PKG" | tail -n "${1:-40}"; fi
    ;;
  adb)
    adb "$@"
    ;;
  *)
    sed -n '2,/^set -e/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
    ;;
esac
