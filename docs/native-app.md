# Duo Budget native app

Capacitor 8 wraps the planning app that already lives at the repo root. The web app (`index.html`, GitHub Pages on `main`, and the local `build/personal` and `build/demo-data` outputs) is unchanged. Native builds copy those same files into `build/capacitor` (gitignored, because `build/` is gitignored) and Capacitor syncs that folder into the Android and iOS projects.

| | |
| --- | --- |
| App id | `au.duobudget.app` |
| App name | Duo Budget |
| Web assets | `build/capacitor` (`webDir` in `capacitor.config.json`) |
| Android | `android/` — compileSdk 36, targetSdk 36, minSdk 24 (Capacitor 8 default), versionCode 1, versionName 0.1.0 |
| Capacitor iOS | `capacitor-ios/` — Swift Package Manager, iOS 15, same app id. Not built here (no Xcode on Linux). |
| Widget shell | `ios/` — the existing Xcode project with the home-screen widget. Different bundle id (`au.com.duobudget.app`). Leave it alone. Capacitor does not overwrite it because `ios.path` is `capacitor-ios`. |

`npm run sync:www` only copies the site into `build/capacitor`. `npm run cap:sync` does that and then `npx cap sync`. `npm run android:debug` syncs and runs `./gradlew assembleDebug`.

## Build the debug APK

You need Node.js, JDK 21, and Android SDK 36 (Android Studio, or the command-line tools). Point `ANDROID_HOME` at the SDK. The first Gradle run writes `android/local.properties` from that path. That file is gitignored.

```bash
npm install
npm run android:debug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. It is signed with the debug keystore Gradle creates at `~/.android/debug.keystore` (alias `androiddebugkey`, store password `android`). There is no release keystore in this repo, and the APK is not committed.

Sideload it onto your own phone: copy the file over, allow installs from that app, and open it. If a previous build was signed by a different debug keystore, uninstall Duo Budget first or Android will refuse the update.

Icons and the splash come from `icons/icon-512.png` (navy app icon) and `icons/logo-mark.webp` (adaptive foreground and splash mark on the cream `#FBF7EF` background). Regenerate them with:

```bash
python3 -m pip install pillow
python3 tools/make-native-branding.py
```

## Open the Android project in Android Studio

1. `npm install` and `npm run cap:sync` so plugin paths and the web assets exist. `android/app/src/main/assets/public` is gitignored and is filled in by sync.
2. In Android Studio, open the `android` directory (File → Open). Do not open the repo root.
3. Let Gradle sync. If it asks for Android SDK 36, install it.
4. Pick a device or emulator and press Run. The debug build type uses the debug keystore. Do not create a release signing config for this sideload build.

The return link for Google sign-in is an intent filter on `MainActivity`: scheme `au.duobudget.app`, host `auth-callback`.

## iOS, on a Mac with Xcode

`npx cap add ios` already ran on Linux. It wrote `capacitor-ios/` and did not need CocoaPods or Xcode. The project uses Swift Package Manager (`capacitor-ios/App/CapApp-SPM`). The copied web files under `capacitor-ios/App/App/public` are gitignored; sync recreates them.

1. Install Xcode 16 or newer and open it once so the command-line tools are in place.
2. In this repo: `npm install` then `npm run cap:sync`.
3. Open `capacitor-ios/App/App.xcodeproj` (the SPM project, not `ios/DuoBudget.xcodeproj`).
4. Select the App target, Signing & Capabilities, and choose your team. The bundle id is `au.duobudget.app`. A free Apple ID can install onto your own phone for a few days. It will not ship the widget in `ios/`; that target still needs the paid program and the App Group, as described in `ios/README.md`.
5. The URL scheme `au.duobudget.app` is already in `capacitor-ios/App/App/Info.plist` (`CFBundleURLTypes`), so the same auth return link works on iPhone once the Supabase redirect below is allowed.
6. Pick your iPhone and press Run.

If you ever need to recreate the Capacitor iOS project: delete `capacitor-ios` and run `npx cap add ios`. Do not delete `ios/`.

## Google sign-in

The website path is the same as before. In a normal browser, Sign in with Google still calls `signInWithOAuth` without `skipBrowserRedirect`, and `redirectTo` is still the current page (or the `redirectTo` the caller passes). Nothing in that branch depends on Capacitor.

Inside the native shell (`Capacitor.isNativePlatform()`), the same button does this instead:

1. `signInWithOAuth` with `skipBrowserRedirect: true`, PKCE (already the app's `flowType`), and `redirectTo` set to `au.duobudget.app://auth-callback`.
2. Opens the returned Supabase URL in the system browser via `@capacitor/browser` (Chrome Custom Tab on Android).
3. The app receives `au.duobudget.app://auth-callback?code=...` through `@capacitor/app` (`appUrlOpen`, and `getLaunchUrl` if the app was opened cold).
4. `exchangeCodeForSession` turns that code into a session. The code verifier stays in the WebView, which is where sign-in started.

That path is in `backend/client/duo-sync.js` (inlined into `index.html`). It was checked with a fake Capacitor bridge in `backend/test/test-sync.js`. It has not been confirmed against the live Supabase project, because the redirect URL below is not on the allow list yet and this environment did not complete a Google login.

### Add this in Supabase

Authentication → URL Configuration → Redirect URLs. Add the URL. Do not remove the website URLs that are already there, and do not change Site URL to the custom scheme or the website sign-in will start returning to the app.

```
au.duobudget.app://auth-callback
```

That is the exact `redirectTo` the native shell sends. Supabase matches it against the allow list.

### Google Cloud

No Google Cloud change is required for this flow.

Google still redirects to Supabase, not to the phone. The Web OAuth client's authorized redirect URI stays:

```
https://ksrffninlyioqobvdvhu.supabase.co/auth/v1/callback
```

Do not add `au.duobudget.app://auth-callback` on the Google client. Google never sees that URL.

An Android OAuth client (package name plus the debug SHA-1) is not used. This build does not use the native Google Sign-In SDK. Add an Android client only if you later replace the browser flow. If you do, print the fingerprint of the keystore that actually signed the APK you installed:

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android
```

The debug keystore created on one computer is not the debug keystore on another, so a SHA-1 from a CI or agent machine will not match an APK you build yourself.

If the Google consent screen is still in Testing, the Google account has to be on the test-user list. That is the same rule as the website.

### How to tell that it worked

Install the APK, open Partner, and tap Sign in with Google. After the redirect URL is allowed, the browser should close back into Duo Budget and the sync card should show the signed-in email. Until then, Supabase rejects the redirect and sign-in does not finish. The button and the code path are already in place.
