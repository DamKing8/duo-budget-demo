# Duo Budget native app

Capacitor 8 wraps the planning app that already lives at the repo root. The web app (`index.html`, GitHub Pages on `main`, and the local `build/personal` and `build/demo-data` outputs) is unchanged. Native builds copy those same files into `build/capacitor` (gitignored, because `build/` is gitignored) and Capacitor syncs that folder into the Android and iOS projects.

| | |
| --- | --- |
| App id | `au.duobudget.app` |
| App name | Duo Budget |
| Web assets | `build/capacitor` (`webDir` in `capacitor.config.json`) |
| Android | `android/` — compileSdk 36, targetSdk 36, minSdk 24 (Capacitor 8 default), versionCode 1, versionName 0.1.0 |
| Capacitor iOS | `capacitor-ios/` — Swift Package Manager, iOS 15, version 0.1.0 (build 1), same app id. Open this one on a Mac. |
| Widget shell | `ios/` — the existing Xcode project with the home-screen widget. Different bundle id (`au.com.duobudget.app`). Leave it alone. Capacitor does not overwrite it because `ios.path` is `capacitor-ios`. |

`npm run sync:www` only copies the site into `build/capacitor`. `npm run cap:sync` does that, runs `npx cap sync`, and checks the iOS project. `npm run ios:prepare` does the same for iOS only (no Android SDK). `npm run android:debug` syncs and runs `./gradlew assembleDebug`.

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

## Run on your iPhone

This installs Duo Budget on your own iPhone from Xcode. The App target already uses paid team `P2N4988G3H`, automatic signing, and Sign in with Apple. The portal clicks that are still yours are in `docs/apple-setup.md`. Do not submit a build from this page.

The project Xcode opens is `capacitor-ios/`. It was created with `npx cap add ios` and uses Swift Package Manager (`capacitor-ios/App/CapApp-SPM`). There is no Podfile. CocoaPods is not used, and you should not install it. The home-screen widget project in `ios/` is a different app. Leave that folder as it is, and do not open it for this run.

Debug and Release set `DEVELOPMENT_TEAM` to `P2N4988G3H` and `CODE_SIGN_ENTITLEMENTS` to `App/App.entitlements`. Do not clear the team. Do not add Push, iCloud, or App Groups.

### What to install

1. **Xcode 26**, from the Mac App Store. Capacitor 8 needs Xcode 26 or newer. Open Xcode once and let it finish installing the extra components. If the App Store says the Mac needs a newer macOS, install that update first.
2. **Node.js LTS, version 22 or newer.** Capacitor 8 does not run on Node 20. The installer from [nodejs.org](https://nodejs.org/) is enough.
3. **Git.** If Terminal says `git` is missing, install Xcode’s command-line tools with `xcode-select --install`. Xcode 26 already includes them once that prompt is finished.
4. **CocoaPods: do not install it.** Dependencies come from Swift Package Manager when Xcode opens the project.

### Clone and prepare

In Terminal:

```bash
git fetch origin cursor/ios-test-47-48
git checkout cursor/ios-test-47-48
git pull origin cursor/ios-test-47-48
npm install
npm run ios:prepare
```

`npm run ios:prepare` copies the website into the iOS app, refreshes the Swift package list, and checks the bundle id, version, URL scheme, signing, and that the web files landed in `capacitor-ios/App/App/public`. Those copied files are gitignored. Run this again after you pull new commits, before you press Run.

`npm install && npm run cap:sync` does the same copy for Android and iOS together. Use that if you are already building the Android app. On a Mac that only has Xcode, `ios:prepare` is the one you want.

### Open the project

```bash
open capacitor-ios/App/App.xcodeproj
```

You can also use File → Open in Xcode and choose that file, or run `npx cap open ios`.

Open `capacitor-ios/App/App.xcodeproj`. That is the Swift package project. There is no CocoaPods workspace to open. Do not open `ios/DuoBudget.xcodeproj`.

The first open downloads the Capacitor Swift package. Leave the Mac online until the package spinner finishes.

### Signing

1. In the left sidebar, click the blue App project, then the **App** target under TARGETS.
2. Open **Signing & Capabilities**.
3. **Automatically manage signing** stays on. Team is already `P2N4988G3H`. If the menu is empty, sign in to Xcode with the Apple ID that belongs to that team, then choose `P2N4988G3H` again. Do not choose a Personal Team.
4. The bundle identifier stays `au.duobudget.app`. The name under the icon is Duo Budget. The version is 0.1.0, build 1. The iOS deployment target is 15.0.
5. Sign in with Apple should be listed, from `App/App.entitlements`. Leave it. Do not add Push Notifications, App Groups, Associated Domains, or iCloud.

`npm run ios:prepare` checks the bundle id, the team, and the entitlement. Do not change the bundle id.

### Run it on the phone

1. Plug the iPhone in with a cable. If the phone asks you to Trust This Computer, tap Trust and enter the passcode.
2. On the iPhone, turn on Developer Mode: **Settings → Privacy & Security → Developer Mode**. Turn it on, and let the phone restart. After the restart, confirm that you want Developer Mode.
3. In Xcode’s toolbar, next to the Run button, choose your iPhone. Do not choose a simulator if you want it on the phone.
4. Press Run. The first build can take a few minutes.
5. If the icon does nothing, or the phone says the developer is not trusted: on the iPhone open **Settings → General → VPN & Device Management**, tap the developer under Developer App, and tap Trust.

### What this signing setup does not include

Push notifications, iCloud, and App Groups stay off. The widget project in `ios/` is separate. See `ios/README.md`. TestFlight waits on the App Store Connect app in `docs/apple-setup.md`. Do not upload a build from this page.

If you ever have to recreate the Capacitor iOS project: delete `capacitor-ios` and run `npx cap add ios`. Do not delete `ios/`. Then put back the bundle id `au.duobudget.app`, the display name Duo Budget, version 0.1.0 build 1, the URL scheme below, team `P2N4988G3H`, automatic signing, and `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`. `npm run ios:prepare` checks those.

## App lock and Sign in with Apple

Milestone 1 adds Face ID / fingerprint, a passcode, and native Apple and Google sheets behind config flags. `NSFaceIDUsageDescription` is in `capacitor-ios/App/App/Info.plist`: "Duo Budget uses Face ID to unlock your budget." Android asks for `USE_BIOMETRIC` and `USE_FINGERPRINT`.

The App target already signs with team `P2N4988G3H` and `App/App.entitlements` (Sign in with Apple, Default). Do not add Push, iCloud, or App Groups. On iPhone, Sign in with Apple tries the native sheet, then browser sign-in if that token cannot be finished. Google stays on browser sign-in. The portal and Supabase steps that are still missing are in `docs/apple-setup.md`.

`npm run cap:sync` adds `@capgo/capacitor-social-login`, `@aparajita/capacitor-biometric-auth`, `@aparajita/capacitor-secure-storage` and `@capacitor/privacy-screen` to `capacitor-ios/App/CapApp-SPM/Package.swift` and to the Android Gradle projects. PR #47's Package.swift still lists only App, Browser and Splash Screen, so the two branches will both touch that generated file. The widget project in `ios/` is not part of this.

## Google sign-in

The website path is the same as before. In a normal browser, Sign in with Google still calls `signInWithOAuth` without `skipBrowserRedirect`, and `redirectTo` is still the current page (or the `redirectTo` the caller passes). Nothing in that branch depends on Capacitor.

Inside the native shell (`Capacitor.isNativePlatform()`), Android and iOS take the same path. Nothing in it checks the platform name.

1. `signInWithOAuth` with `skipBrowserRedirect: true`, PKCE (already the app's `flowType`), and `redirectTo` set to `au.duobudget.app://auth-callback`.
2. Opens the returned Supabase URL in `@capacitor/browser`. On Android that is a Chrome Custom Tab. On iOS it is an in-app Safari view (`SFSafariViewController`).
3. The app receives `au.duobudget.app://auth-callback?code=...` through `@capacitor/app` (`appUrlOpen`, and `getLaunchUrl` if the app was opened cold). On iOS the scheme is registered in `capacitor-ios/App/App/Info.plist` under `CFBundleURLTypes`, and `SceneDelegate` forwards the open to Capacitor, which emits `appUrlOpen`.
4. `Browser.close()` dismisses that in-app browser. If it is already gone, the close error is ignored.
5. `exchangeCodeForSession` turns that code into a session. The code verifier stays in the WebView, which is where sign-in started.

That path is in `backend/client/duo-sync.js` (inlined into `index.html`). It was checked with a fake Capacitor bridge in `backend/test/test-sync.js`, including the case where `Browser.close()` rejects. It has not been confirmed with a live Google login on a phone. This environment has no Xcode and no iPhone. The redirect URL below is already allowed in Supabase.

### Redirect URL in Supabase

Authentication → URL Configuration → Redirect URLs. This URL is already on the list. Do not remove the website URLs that are already there, and do not change Site URL to the custom scheme or the website sign-in will start returning to the app.

```
au.duobudget.app://auth-callback
```

That is the exact `redirectTo` the native shell sends. Supabase matches it against the allow list. If a future project does not have it, add that exact string and leave Site URL alone.

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

Install the Android APK, or run the iOS app from Xcode with the steps above. Open Partner and tap Sign in with Google. The browser should close back into Duo Budget and the sync card should show the signed-in email. The button and the code path are already in place.
