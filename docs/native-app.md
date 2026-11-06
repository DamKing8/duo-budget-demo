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

## Run on your iPhone with a free Apple ID

This installs Duo Budget on your own iPhone from Xcode. It uses the free Apple ID you already have (a Personal Team). You do not need a paid Apple Developer Program membership, TestFlight, App Store Connect, a push certificate, or an upload to Apple.

The project Xcode opens is `capacitor-ios/`. It was created with `npx cap add ios` and uses Swift Package Manager (`capacitor-ios/App/CapApp-SPM`). There is no Podfile. CocoaPods is not used, and you should not install it. The home-screen widget project in `ios/` is a different app. Leave that folder as it is, and do not open it for this run.

The app target has no Push Notifications, Sign in with Apple, App Groups, Associated Domains, or iCloud capability. `DEVELOPMENT_TEAM` is empty on purpose. Automatic signing is on. You pick your own Personal Team in Xcode. Do not commit a team id if Xcode writes one into the project.

### What to install

1. **Xcode 26**, from the Mac App Store. Capacitor 8 needs Xcode 26 or newer. Open Xcode once and let it finish installing the extra components. If the App Store says the Mac needs a newer macOS, install that update first.
2. **Node.js LTS, version 22 or newer.** Capacitor 8 does not run on Node 20. The installer from [nodejs.org](https://nodejs.org/) is enough.
3. **Git.** If Terminal says `git` is missing, install Xcode’s command-line tools with `xcode-select --install`. Xcode 26 already includes them once that prompt is finished.
4. **CocoaPods: do not install it.** Dependencies come from Swift Package Manager when Xcode opens the project.

### Clone and prepare

In Terminal:

```bash
git clone -b app-private https://github.com/DamKing8/duo-budget-demo.git
cd duo-budget-demo
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
3. Tick **Automatically manage signing**.
4. Open the **Team** menu and choose **Add an Account…**. Sign in with your Apple ID.
5. Open **Team** again and choose the row that ends in **(Personal Team)**. That is the free account.
6. The bundle identifier should stay `au.duobudget.app`. The name under the icon is Duo Budget. The version is 0.1.0, build 1. The iOS deployment target is 15.0, which is the oldest iOS Capacitor 8 supports, so the iPhone needs iOS 15 or later.
7. The capabilities list should be empty. If Push Notifications, Sign in with Apple, App Groups, Associated Domains, or iCloud is listed, select it and delete it. A free account cannot sign those, and the build will fail until they are gone.

If Xcode says the bundle identifier is not available, or that `au.duobudget.app` cannot be registered to your team, someone else already owns that id. In Signing & Capabilities, change the bundle identifier to a unique one, for example `au.duobudget.app.damon`. Leave the URL scheme in `capacitor-ios/App/App/Info.plist` as `au.duobudget.app`. Sign-in still returns to `au.duobudget.app://auth-callback`. The scheme and the bundle id are separate. Leave everything under `ios/` as it is.

Do that change in Xcode after `npm run ios:prepare` has succeeded. A later `ios:prepare` or `cap:sync` checks that the project file still says `au.duobudget.app`, and it will stop if the id was edited. To refresh the web files without that check, run `npm run sync:www && npx cap sync ios`. Capacitor does not put the bundle id back.

### Run it on the phone

1. Plug the iPhone in with a cable. If the phone asks you to Trust This Computer, tap Trust and enter the passcode.
2. On the iPhone, turn on Developer Mode: **Settings → Privacy & Security → Developer Mode**. Turn it on, and let the phone restart. After the restart, confirm that you want Developer Mode.
3. In Xcode’s toolbar, next to the Run button, choose your iPhone. Do not choose a simulator if you want it on the phone.
4. Press Run. The first build can take a few minutes.
5. If the icon does nothing, or the phone says the developer is not trusted: on the iPhone open **Settings → General → VPN & Device Management**, tap the developer under Developer App, and tap Trust.

### Seven days, and the free-account limits

A free provisioning profile lasts 7 days. After that, Duo Budget stops opening. Plug the phone in, open this same project, and press Run again. That refreshes the signature. You do not need a new Apple ID, and you do not need to delete the app first (deleting it removes the budget stored on the phone).

Apple’s free account can have **3 apps installed on one device**, and **10 App IDs registered at a time**. Those App IDs expire after 7 days, so the practical limit is about 10 new App IDs a week. Pressing Run again for Duo Budget reuses the same App ID. Changing the bundle identifier spends a new one.

### What a free account cannot do

Push notifications, Sign in with Apple, TestFlight, the App Store, and iCloud do not work on a Personal Team. There is nothing to upload.

App Groups do not work either, so the home-screen widget in `ios/` cannot share numbers with this app. That widget project stays as it is. It still needs a paid Apple Developer Program membership, which this setup does not use. See `ios/README.md` if that membership exists later.

If you ever have to recreate the Capacitor iOS project: delete `capacitor-ios` and run `npx cap add ios`. Do not delete `ios/`. Then put back the bundle id `au.duobudget.app`, the display name Duo Budget, version 0.1.0 build 1, the URL scheme below, an empty development team, and automatic signing. `npm run ios:prepare` checks those.

## App lock and Sign in with Apple

Milestone 1 adds Face ID / fingerprint, a passcode, and native Apple and Google sheets behind config flags. `NSFaceIDUsageDescription` is in `capacitor-ios/App/App/Info.plist`: "Duo Budget uses Face ID to unlock your budget." Android asks for `USE_BIOMETRIC` and `USE_FINGERPRINT`.

The Sign in with Apple capability is **not** on the Xcode target. A free Personal Team cannot sign it, and the unmerged PR #47 check rejects that entitlement. Add the capability only after the paid Apple Developer Program and the credentials in `docs/auth-setup.md`. The cold-start landing still shows Continue with Apple and Continue with Google. Those taps use browser sign-in until `window.DUO_AUTH_CONFIG.apple` is true and the client ids are set. Native sheets stay off.

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
