# Auth setup for milestone 1

No accounts are created by the app change, and none of this is applied to the live Supabase project. Client secrets and the Apple `.p8` stay in the dashboards. The app only ever sees public client ids, and those ids are left blank in git.

The running app reads `window.DUO_AUTH_CONFIG` in `index.html`:

| Flag | Default | Button |
| --- | --- | --- |
| `apple` | `true` | iPhone tries the native Sign in with Apple sheet, then browser sign-in. Web and Android stay on browser sign-in while `appleClientId` is empty. |
| `google` | `true` | Continue with Google uses the existing browser sign-in. |
| `allowGoogleWithoutApple` | `false` | On iPhone, Google is hidden while Apple is off. Set true only on your own phone before Apple exists. |
| `appleClientId` | empty | Services ID. Required before Apple shows on web or Android. iOS native can try from the bundle id once `apple` is true, and still needs the paid capability. |
| `googleWebClientId` | empty | Required before Android uses the native Google sheet. |
| `googleIosClientId` | empty | Required before iPhone uses the native Google sheet. |
| `googleAndroidClientId` | empty | The Android OAuth client (package + SHA-1). Recorded for Cloud Console and Supabase. The plugin sends the **web** client id on Android. |

Empty client ids do not hide the Google button. They skip the native sheet and keep today's browser sign-in. Filling an id without the matching dashboard setup makes the native sheet fail, and the app falls back to the browser.

## Supabase dashboard (do this yourself, later)

Project `ksrffninlyioqobvdvhu`. Notes for the same choices are in `backend/auth/config.toml`. Do not paste secrets into the repo.

1. Authentication → Providers → Email. Leave it on. Minimum password length 8. Confirmation stays on. The confirmation template and the recovery template must include `{{ .Token }}` so reset and sign-in are 6-digit codes, not links.
2. Authentication → Providers → Google. It is the provider the app already calls. Add the iOS client id, and the Android client id if the token audience is not the web client, under additional client ids. Leave skip nonce check off.
3. Authentication → Providers → Apple. Turn it on when you have the Services ID, the Key ID, and the `.p8`. Add the bundle id `au.duobudget.app` as a client id so the iPhone id token is accepted. The exact clicks are in `docs/apple-setup.md`. Until this is saved, the native token is rejected and the button opens browser Apple sign-in, which needs the same provider.
4. Authentication → URL configuration. Keep the site URL as the website. Redirect URLs must include `au.duobudget.app://auth-callback` (already used by the native browser sign-in). Do not change the site URL to the custom scheme.
5. Authentication → Providers, manual linking. Turn on so Partners → Link Google / Link Apple can attach a second method to the same account. The app will not unlink the last method.
6. Do not run `backend/migrations/20261105_delete_my_account.sql` until you have read it. Do not deploy `backend/functions/delete-account/`.

## Apple Developer (paid membership, team P2N4988G3H)

The iPhone project already sets the team and attaches Sign in with Apple. Follow `docs/apple-setup.md` for the App ID, Services ID `au.duobudget.web`, the `.p8`, and the Supabase provider. Do not commit the `.p8`, the Key ID, or a Services ID. `appleClientId` stays empty; the iPhone sheet uses the bundle id.

## Google Cloud

The website OAuth client already points at `https://ksrffninlyioqobvdvhu.supabase.co/auth/v1/callback`. Do not put `au.duobudget.app://auth-callback` on the Google client. Google never sees that URL.

Create, when you want the native sheets:

| Client | Used for |
| --- | --- |
| Web | `googleWebClientId`. Android native sign-in, and Supabase's Google provider. |
| iOS | Bundle id `au.duobudget.app`. `googleIosClientId`. |
| Android | Package `au.duobudget.app` plus the SHA-1 of the keystore that signed the APK you installed. `googleAndroidClientId`. |

Debug SHA-1, from the machine that built the APK:

```bash
keytool -list -v -alias androiddebugkey -keystore ~/.android/debug.keystore -storepass android -keypass android
```

A SHA-1 from another computer will not match. The consent screen is still in Testing, so the Google account has to be on the test-user list.

## What the app does with those ids

Native sign-in uses `@capgo/capacitor-social-login` 8.7.6. It returns an id token. The app calls `supabase.auth.signInWithIdToken`. Apple gets a SHA-256 nonce in the Apple request and the raw nonce in Supabase. If the native call is cancelled, nothing else happens. Any other native failure falls back to the browser OAuth the app already had.

Passwords use `signInWithPassword` and `updateUser({ password })`. Reset emails a code (`resetPasswordForEmail`) and checks it with `verifyOtp({ type: 'recovery' })`, which needs `{{ .Token }}` in the recovery template. Someone who has never set a password keeps using the code.
