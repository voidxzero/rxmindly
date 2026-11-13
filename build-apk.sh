#!/usr/bin/env bash
# Builds the Android app and leaves it at ./rxmindly.apk
set -euo pipefail
cd "$(dirname "$0")/web"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if ! command -v javac >/dev/null && [ -x "$HOME/Android/jdk-21/bin/javac" ]; then
  export JAVA_HOME="$HOME/Android/jdk-21"
fi
echo "sdk.dir=$ANDROID_HOME" > android/local.properties

[ -d node_modules ] || npm ci
npm run build
npx cap sync android
(cd android && ./gradlew assembleRelease --console=plain -q)
cp android/app/build/outputs/apk/release/app-release.apk ../rxmindly.apk
echo "Built $(cd .. && pwd)/rxmindly.apk"
