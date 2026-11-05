# Apple setup after the paid membership is approved

Team ID: `P2N4988G3H`. Bundle ID: `au.duobudget.app`.

The Xcode app target already has `DEVELOPMENT_TEAM = P2N4988G3H`. Sign in with Apple is written in `capacitor-ios/App/App/App.entitlements` and is **not** attached to the Debug or Release build. A free or still-pending Apple ID cannot sign that capability, so the default build leaves it off. The in-app Apple button stays hidden.

Do these steps yourself after Apple approves the paid Developer Program membership. This file does not call Apple.

## 1. Turn the entitlement on in Xcode

1. Open `capacitor-ios/App/App.xcodeproj`.
2. Select the **App** target.
3. Open **Build Settings**, search for **Code Signing Entitlements**.
4. For Debug and Release, set the value to `App/App.entitlements`.
5. Open **Signing & Capabilities**. Confirm the team is `P2N4988G3H` and **Sign in with Apple** is listed. Do not add Push, iCloud, or App Groups.

## 2. Register the App ID

1. Open [Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources/identifiers/list).
2. Click **Identifiers**, then the **+** button.
3. Choose **App IDs**, then **Continue**.
4. Choose **App**, then **Continue**.
5. Description: `Duo Budget`.
6. Bundle ID: **Explicit**, `au.duobudget.app`.
7. Enable **Sign in with Apple**. Leave every other capability off.
8. Click **Continue**, then **Register**.

## 3. Create the Services ID

1. On Identifiers, click **+**.
2. Choose **Services IDs**, then **Continue**.
3. Description: `Duo Budget web`.
4. Identifier: `au.duobudget.web`.
5. Click **Continue**, then **Register**.
6. Open the new Services ID.
7. Enable **Sign in with Apple**, then click **Configure**.
8. Primary App ID: `au.duobudget.app`.
9. Domains: `ksrffninlyioqobvdvhu.supabase.co`.
10. Return URL: `https://ksrffninlyioqobvdvhu.supabase.co/auth/v1/callback`.
11. Click **Next**, then **Done**, then **Continue**, then **Save**.

## 4. Create the Sign in with Apple key

1. Open [Keys](https://developer.apple.com/account/resources/authkeys/list).
2. Click **+**.
3. Key name: `Duo Budget Sign in with Apple`.
4. Enable **Sign in with Apple**, then click **Configure** and choose Primary App ID `au.duobudget.app`.
5. Click **Continue**, then **Register**.
6. Download the `.p8` file. Apple shows it once.
7. Note the Key ID on that page.
8. In the Supabase dashboard, open Authentication, then Apple, and upload the `.p8` yourself. Also enter the Services ID `au.duobudget.web`, the Key ID, and Team ID `P2N4988G3H`.

## 5. Create the App Store Connect app

1. Open [App Store Connect](https://appstoreconnect.apple.com/apps) and click **+**, then **New App**.
2. Platforms: iOS.
3. Name: `Duo Budget`.
4. Primary language: English (Australia) or your choice.
5. Bundle ID: `au.duobudget.app`.
6. SKU: `duobudget`.
7. User access: Full Access.
8. Click **Create**. Do not submit a build from this step.
