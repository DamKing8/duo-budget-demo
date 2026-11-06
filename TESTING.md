# Testing Duo Budget

## Milestone 1: welcome, sign-in and app lock

Nothing in this change is deployed. The live Supabase project is not modified, no store listing is submitted, and no Apple or Google account is created.

The web app is `index.html` on the `app-private` branch. `npm test` covers the budget maths, the sync client, the welcome routing rules and the passcode rules. It does not sign anyone in.

### Web

```bash
npm install
npx serve .
```

Open the URL in a normal browser window, at a phone width (about 390px). Use a private window if this browser already has a Duo Budget budget saved.

| What you should see | How |
| --- | --- |
| Welcome landing | First visit with no session and no saved lines. Logo, Duo Budget, "Plan around both paydays.", Continue with Apple, Continue with Google, Continue with email, and Try demo. |
| Email code | Continue with email, then Send code. This sends a real code through the existing Resend setup. Don't do it unless you mean to use that inbox. |
| Password | Use a password instead. It works only after that account has set one under Partners. |
| Try demo | Opens an empty household. Load sample data is on Home and in Partners. Welcome does not come back. |
| Keep this budget? | Sign in after you have used the app as a guest. A cloud budget is never folded in without a choice. |
| Set a password | Partners, once signed in. |
| App lock | Partners. Off until you turn it on. Web has the passcode only. |
| Sign out | The confirm says the account copy stays. This browser's copy is removed and you land on welcome. |
| Delete my account and data | Partners. Two taps from Home (Partner, then the button). |

An existing signed-in browser, or one that already has a saved budget, skips the welcome. Home shows a one-time "Back up this budget" card for a guest budget.

On the web the passcode is a curtain for that browser. The help text says so. Biometrics on the web are not in this milestone.

### iPhone (Xcode, free Apple ID)

Use the Capacitor project, not the widget project in `ios/`. PR #47 (unmerged) is the free Apple ID prep. This change adds `NSFaceIDUsageDescription` to `capacitor-ios/App/App/Info.plist` and does **not** add the Sign in with Apple capability. A free Personal Team cannot sign that capability, and PR #47's check rejects it. Leave the capability off until the paid Apple Developer Program exists.

```bash
git clone -b app-private https://github.com/DamKing8/duo-budget-demo.git
cd duo-budget-demo
npm install
npm run cap:sync
open capacitor-ios/App/App.xcodeproj
```

Signing & Capabilities: your Personal Team, bundle id `au.duobudget.app`. Do not add Sign in with Apple. Run on your iPhone (iOS 15 or later).

You can test welcome, email code, guest mode, the passcode lock, the auto-lock timers (leave the app and come back), and sign-out. Face ID prompts only after the lock is on and the phone has Face ID. The usage text is "Duo Budget uses Face ID to unlock your budget."

The landing always shows Apple, Google, and email. Those buttons use the existing browser sign-in. Native Apple and native Google on iPhone still wait for client ids and the paid Sign in with Apple capability. The in-app provider list still hides Google on iPhone while `apple` is false (App Store guideline 4.8).

`npm run cap:sync` rewrites `capacitor-ios/App/CapApp-SPM/Package.swift` for the new plugins. That file will conflict with PR #47, which still lists only App, Browser and Splash Screen. The plist Face ID line can conflict with PR #47's whitespace-only plist edit. The widget project in `ios/` is untouched.

### Android (sideload a debug APK)

```bash
npm install
npm run android:debug
```

The APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on your phone. If Android refuses the update, uninstall the old Duo Budget first. The debug keystore is the one Gradle creates on the machine that built the APK (`~/.android/debug.keystore`, alias `androiddebugkey`, password `android`).

`USE_BIOMETRIC` and `USE_FINGERPRINT` are on the manifest. Fingerprint or face unlock appears after you turn the lock on, if the phone has biometrics enrolled. The passcode still works. "Hide in the app switcher" also blocks screenshots on Android while the lock is on, because the privacy plugin always sets `FLAG_SECURE`.

Native Google and Apple sheets do nothing until the client ids below are filled in. The Google button on Android still uses the existing browser sign-in.

### What cannot be tested until credentials exist

- The Apple button, native Sign in with Apple, and Apple token revocation on account deletion.
- The native Google sheet (Credential Manager on Android, the Google SDK on iPhone). Browser Google on Android and on the website can be tested now.
- Google on iPhone, unless you temporarily set `allowGoogleWithoutApple` for your own install.
- Applying `backend/migrations/20261105_delete_my_account.sql`. Until then, Delete account removes the household data through the existing `delete_my_data()` function and tells you the sign-in user is still there. The Edge Function in `backend/functions/delete-account/` is not deployed.
- The auth settings in `backend/auth/config.toml`. They are notes for the dashboard, not a push.

Full credential list: `docs/auth-setup.md`.

## Premium

Premium is previewed on the device until a RevenueCat key is set. The preview does not call Apple, Google, or Supabase. Partners → Premium has six states: free, trial, active, lapsed, partner, courtesy. "This store account has a purchase" controls Restore purchases.

The free plan includes partner sync, unlimited expenses, CSV export, and light, dark, and system themes. It includes 2 goals, 3 months of spending and trends, 5 custom categories, 1 bill reminder, and the current payday. Premium is unlimited goals, the older history (still saved), the further paydays, unlimited categories and reminders, and the extra colours.

### Web

```bash
npx serve .
```

Open a private window so an old budget does not skip the new cards. Sign in, or use the preview without a store.

| Screen | How |
| --- | --- |
| Paywall | Goals → Add a goal once two goals exist. Prices are A$4.99 a month and A$39.99 a year. |
| Third goal | With three goals on the free preview, the third card says it is read-only. |
| History | Spending → previous payday until the page says older spending stays saved. |
| Lapsed | Partners → Premium → lapsed, then open that third goal. |
| Partner covers you | Partners → Premium → partner. |
| Restore | Tick "This store account has a purchase", then Restore purchases. |

### iPhone and Android

Same preview. Build with the milestone 1 steps (`npm run cap:sync`, then Xcode or `npm run android:debug`). The preview chips are on the Partner tab. Face ID and the store sheet do not appear, because there is no RevenueCat key and no store product.

A free Apple ID can install this. It cannot complete a real subscription. Sandbox testing needs the products in `docs/premium-products.md`, a RevenueCat project, an App Store sandbox tester, and a Play licence tester. Put the public SDK key in `DUO_PREMIUM_CONFIG` and set `mock` to false. Then Restore purchases calls the store.

The entitlement table and the webhook are files only. They are not on the live database, so a real purchase would not light up Premium until those are applied and the webhook secret is set.
