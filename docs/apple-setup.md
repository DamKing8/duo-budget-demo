# Apple setup

Paid Apple Developer Program membership is approved. Team ID `P2N4988G3H` is already on the App target.

The iPhone preview tip is `cursor/ios-test-47-48`. Build from that branch. Do not merge it into `main` or `app-private`, and do not submit a build to the App Store from these steps.

## Already in the Xcode project

App target, Debug and Release, in `capacitor-ios/App/App.xcodeproj`:

| Setting | Value |
| --- | --- |
| `DEVELOPMENT_TEAM` | `P2N4988G3H` |
| `CODE_SIGN_STYLE` | `Automatic` |
| `ProvisioningStyle` | `Automatic` |
| `PRODUCT_BUNDLE_IDENTIFIER` | `au.duobudget.app` |
| `CODE_SIGN_ENTITLEMENTS` | `App/App.entitlements` |

`capacitor-ios/App/App/App.entitlements` contains `com.apple.developer.applesignin` = `Default`. Do not add Push, iCloud, or App Groups.

`window.DUO_AUTH_CONFIG.apple` is `true`. On iPhone, Sign in with Apple tries the native sheet through `@capgo/capacitor-social-login` and `signInWithIdToken`. The sheet uses the bundle id. `appleClientId` stays empty in git. If the native token cannot be finished, the same button opens the existing browser Apple sign-in. Google stays on browser sign-in.

## Rebuild on your Mac

```bash
git fetch origin cursor/ios-test-47-48
git checkout cursor/ios-test-47-48
git pull origin cursor/ios-test-47-48
npm install
npm run ios:prepare
```

Open `capacitor-ios/App/App.xcodeproj` (not the widget project in `ios/`). In Xcode: Product → Clean Build Folder, then Run on your iPhone. Team `P2N4988G3H` is already in the project. Do not clear Development Team. Signing & Capabilities should list Sign in with Apple. The Partner footer should show `Build` plus the short commit from `git rev-parse --short HEAD`.

Delete the app from the iPhone once before this Run if it still shows `Mock Sign in with Apple (nothing contacted)`. The old page can stay in WKWebView until the app is removed. A new Run after that delete loads this tip.

## Still yours to click

None of these values are in the repo. Do not paste the `.p8` or a client secret into git.

### 1. App ID

1. Open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).
2. Identifiers → **+** → App IDs → App.
3. Description: `Duo Budget`. Bundle ID: Explicit, `au.duobudget.app`.
4. Enable **Sign in with Apple** only. Leave every other capability off.
5. Register.

If this App ID already exists, open it and enable Sign in with Apple. Xcode automatic signing needs that capability or the attached entitlement will not provision.

### 2. Services ID

1. Identifiers → **+** → Services IDs.
2. Description: `Duo Budget web`. Identifier: `au.duobudget.web`.
3. Enable Sign in with Apple → Configure.
4. Primary App ID: `au.duobudget.app`.
5. Domains: `ksrffninlyioqobvdvhu.supabase.co`.
6. Return URL: `https://ksrffninlyioqobvdvhu.supabase.co/auth/v1/callback`.
7. Save.

This identifier is the web and Android Services ID. It is not stored in the app. The iPhone native sheet does not use it.

### 3. Sign in with Apple key

1. Open [Keys](https://developer.apple.com/account/resources/authkeys/list) → **+**.
2. Key name: `Duo Budget Sign in with Apple`. Enable Sign in with Apple. Primary App ID: `au.duobudget.app`.
3. Register and download the `.p8`. Apple shows it once.
4. Write down the Key ID from that page. There is no Key ID in this repo.

### 4. Supabase Apple provider

Project `https://ksrffninlyioqobvdvhu.supabase.co`. Authentication → Providers → Apple. Turn it on and enter:

- Services ID: `au.duobudget.web`
- Team ID: `P2N4988G3H`
- Key ID: the id from the key page (not in this repo)
- Secret: the `.p8` you downloaded, or the secret Supabase generates from it
- Client IDs: include the bundle id `au.duobudget.app` so the native id token is accepted

Also keep redirect URL `au.duobudget.app://auth-callback` on the allow list. That is the browser return used when the native token cannot be finished.

### 5. App Store Connect, for TestFlight later

1. [App Store Connect](https://appstoreconnect.apple.com/apps) → **+** → New App.
2. Platform iOS. Name `Duo Budget`. Bundle ID `au.duobudget.app`. SKU `duobudget`.
3. Create. Do not submit a build from this step.

## What still blocks a finished Apple sign-in

- The App ID must have Sign in with Apple, or Xcode cannot sign the attached entitlement.
- Supabase must have the Apple provider on, with the `.p8` secret, Team ID `P2N4988G3H`, the Key ID from the key page, Services ID `au.duobudget.web`, and client id `au.duobudget.app`. Until that is saved, the native sheet can appear but the id token is rejected, and the button then opens browser Apple sign-in.
- Browser Apple sign-in uses that same Supabase provider. Until the provider is on, neither path can create a session.
- TestFlight needs the App Store Connect app and a build you upload yourself. This repo does not upload one.
