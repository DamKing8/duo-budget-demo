# Duo Budget for iPhone and iPad

This folder is a native shell around the planning app in the repo root. It is not a banking app. A `WKWebView` loads `index.html` from the app bundle at `duobudget://localhost/index.html` (a custom scheme, so the page is not `file://`). Safe-area padding stays in CSS: the web view is pinned to the screen edges and `contentInsetAdjustmentBehavior` is `.never`.

The home-screen and lock-screen widgets live in the `DuoWidget` extension. Both targets share the App Group `group.au.com.duobudget.shared`. The web app posts a snapshot (`left`, `over`, `currency`, `nextPay`, `days`, `cycle`, `label`, `names`) through `webkit.messageHandlers.duoWidget`. The shell writes that JSON into the group’s `UserDefaults` (`duo.widget.snapshot`) and reloads WidgetKit timelines.

## What is in the project

| Piece | Where |
| --- | --- |
| App target | `DuoBudget` — bundle id placeholder `au.com.duobudget.app` |
| Widget extension | `DuoWidget` — `au.com.duobudget.app.widget` |
| Shared snapshot | `Shared/WidgetSnapshot.swift` (compiled into both targets) |
| Widget families | small, medium, lock-screen inline, circular, rectangular |
| App icon | `DuoBudget/Assets.xcassets/AppIcon.appiconset/AppIcon.png` (1024, from `icons/icon-512.png`) |
| Launch screen | `DuoBudget/Base.lproj/LaunchScreen.storyboard` |
| Entitlements | App Group on both targets |
| Deployment | iOS 16, iPhone and iPad |
| Team | empty on purpose |

`capacitor.config.json` at the repo root records the same app id. Do not run `npx cap add ios` in this repo. Capacitor would try to create `ios/App` beside this project and would not include the widget target. `npm run sync:www` only copies the web files into `www/` if you later choose a separate Capacitor shell.

## Preview without a Mac

`widget-preview.html` draws the same widget families with the sample snapshot (Chloe & Jack, made-up $842 left, next pay 28 Oct 2026). It is a layout stand-in. Live numbers appear only after a signed build writes the App Group.

## What is blocked

This project cannot be compiled, installed, or shipped from the current environment:

- The machine that prepared this branch is Linux. There is no Xcode and no iOS Simulator.
- Damon does not have an Apple Developer Program membership yet (about A$149 per year).
- A free Apple ID can sign a simple app onto your own phone for a few days. It cannot create an App Group, so the widget cannot read the app’s snapshot, and it cannot upload to TestFlight or the App Store.
- WidgetKit extensions must be embedded in a signed app. An unsigned `appex` will not appear on a home screen or lock screen.

Nothing here was submitted to Apple, and no paid account was created.

## Steps once a Mac and a paid membership exist

1. Enrol in the Apple Developer Program at [developer.apple.com/programs](https://developer.apple.com/programs/) (about A$149/year). Wait until the membership is active.
2. On a Mac with Xcode 15 or newer, open `ios/DuoBudget.xcodeproj`.
3. In Xcode, select the DuoBudget target, Signing & Capabilities, and choose the team. Repeat for DuoWidget. Both targets use automatic signing. The bundle ids are placeholders (`au.com.duobudget.app` and `au.com.duobudget.app.widget`); change them before they collide with another account, and keep the widget id as a suffix of the app id.
4. In the developer portal, register an App ID for the app and an App ID for the widget extension. Enable App Groups on both.
5. Register the group `group.au.com.duobudget.shared` and add it to both App IDs. The string must match `DuoBudget.entitlements`, `DuoWidget.entitlements`, and `WidgetStore.suite`.
6. In Xcode, confirm App Groups is enabled on both targets and the group is ticked. Xcode can refresh the entitlements from the portal.
7. Pick an iPhone simulator and press Run. The planning app should fill the window, including the notch and home-indicator insets.
8. Add the widget: on the simulator home screen, long-press, tap +, search Duo Budget, and add “Left to spend”. Lock the simulator (Device > Lock) and add the lock-screen accessories (inline, circular, rectangular).
9. For a device: connect the iPhone, select it, and Run. The first launch asks for the microphone and speech recognition only after you tap Listen.
10. For TestFlight: Product > Archive, then Distribute App. TestFlight requires the paid membership. It is not available on a free Apple ID.

Voice on device uses `SFSpeechRecognizer` (en-AU) when the page has no Web Speech API. Safari and the in-app web view often do have `webkitSpeechRecognition`; the native bridge is the fallback the page calls through `webkit.messageHandlers.duoSpeech`.
