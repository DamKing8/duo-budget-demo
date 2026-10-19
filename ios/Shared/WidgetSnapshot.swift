import Foundation

/// Numbers the web app already converted into the display currency.
/// Stored in the App Group so the widget can read them without opening the app.
struct WidgetSnapshot: Codable {
    var left: Double
    var over: Bool
    var currency: String
    var nextPay: String
    var days: Int
    var cycle: String
    var label: String
    var names: String
    var updated: String

    static let sample = WidgetSnapshot(
        left: 842,
        over: false,
        currency: "AUD",
        nextPay: "2026-10-28",
        days: 9,
        cycle: "fortnight",
        label: "Left this fortnight",
        names: "Chloe & Jack",
        updated: ""
    )

    static func parse(_ body: Any) -> WidgetSnapshot? {
        guard let d = body as? [String: Any] else { return nil }
        let left = (d["left"] as? NSNumber)?.doubleValue ?? 0
        let over = (d["over"] as? NSNumber)?.boolValue ?? false
        let currency = (d["currency"] as? String) ?? "AUD"
        let nextPay = (d["nextPay"] as? String) ?? ""
        let days = (d["days"] as? NSNumber)?.intValue ?? 0
        let cycle = (d["cycle"] as? String) ?? "fortnight"
        let label = (d["label"] as? String) ?? "Left this pay"
        let names = (d["names"] as? String) ?? ""
        let updated = (d["updated"] as? String) ?? ""
        return WidgetSnapshot(left: left, over: over, currency: currency, nextPay: nextPay, days: days, cycle: cycle, label: label, names: names, updated: updated)
    }
}

enum WidgetStore {
    /// Placeholder. The real group id is created in the Apple Developer portal
    /// and must match the entitlements on both targets.
    static let suite = "group.au.com.duobudget.shared"
    static let key = "duo.widget.snapshot"

    static func save(_ snap: WidgetSnapshot) {
        guard let defaults = UserDefaults(suiteName: suite),
              let data = try? JSONEncoder().encode(snap) else { return }
        defaults.set(data, forKey: key)
    }

    static func load() -> WidgetSnapshot? {
        guard let defaults = UserDefaults(suiteName: suite),
              let data = defaults.data(forKey: key),
              let snap = try? JSONDecoder().decode(WidgetSnapshot.self, from: data) else { return nil }
        return snap
    }
}
