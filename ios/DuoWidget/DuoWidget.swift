import SwiftUI
import WidgetKit

struct SpendEntry: TimelineEntry {
    let date: Date
    let snap: WidgetSnapshot
    var isPlaceholder: Bool = false
}

struct SpendProvider: TimelineProvider {
    func placeholder(in context: Context) -> SpendEntry {
        SpendEntry(date: Date(), snap: .sample, isPlaceholder: true)
    }

    func getSnapshot(in context: Context, completion: @escaping (SpendEntry) -> Void) {
        completion(SpendEntry(date: Date(), snap: WidgetStore.load() ?? .sample, isPlaceholder: context.isPreview && WidgetStore.load() == nil))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SpendEntry>) -> Void) {
        let entry = SpendEntry(date: Date(), snap: WidgetStore.load() ?? .sample)
        let next = Calendar.current.date(byAdding: .minute, value: 30, to: Date()) ?? Date().addingTimeInterval(1800)
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

struct DuoWidgetView: View {
    @Environment(\.widgetFamily) private var family
    var entry: SpendEntry

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(inlineText)
        case .accessoryCircular:
            VStack(spacing: 0) {
                Text(entry.snap.days == 0 ? "Pay" : "\(max(entry.snap.days, 0))")
                    .font(.headline)
                Text(entry.snap.days == 0 ? "day" : "days")
                    .font(.caption2)
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.snap.label)
                    .font(.caption2)
                Text(money)
                    .font(.headline)
                Text(payLine)
                    .font(.caption2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        case .systemMedium:
            HStack(alignment: .center, spacing: 16) {
                figure
                VStack(alignment: .leading, spacing: 4) {
                    Text("Next pay")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(payLine)
                        .font(.headline)
                    Text(entry.snap.names)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        default:
            figure
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        }
    }

    private var figure: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.snap.label.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color(red: 0.06, green: 0.37, blue: 0.34))
            Text(money)
                .font(.system(size: family == .systemMedium ? 32 : 28, weight: .bold, design: .serif))
                .foregroundStyle(entry.snap.over ? Color(red: 0.75, green: 0.07, blue: 0.24) : Color(red: 0.12, green: 0.14, blue: 0.19))
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(payLine)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var money: String {
        let fmt = NumberFormatter()
        fmt.numberStyle = .currency
        fmt.currencyCode = entry.snap.currency
        fmt.locale = Locale(identifier: "en_AU")
        return fmt.string(from: NSNumber(value: entry.snap.over ? abs(entry.snap.left) : entry.snap.left)) ?? entry.snap.currency
    }

    private var payLine: String {
        if entry.snap.days == 0 { return "Payday today" }
        let when = Self.pretty(entry.snap.nextPay)
        let unit = entry.snap.days == 1 ? "day" : "days"
        return entry.snap.days > 0 ? "\(when) · \(entry.snap.days) \(unit)" : when
    }

    private var inlineText: String {
        let short = entry.snap.over ? "Over \(money)" : "Left \(money)"
        return "\(short) · \(payLine)"
    }

    private static func pretty(_ iso: String) -> String {
        let parts = iso.split(separator: "-")
        guard parts.count == 3, let y = Int(parts[0]), let m = Int(parts[1]), let d = Int(parts[2]) else { return "Next pay" }
        var comps = DateComponents()
        comps.year = y
        comps.month = m
        comps.day = d
        let date = Calendar.current.date(from: comps) ?? Date()
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_AU")
        fmt.setLocalizedDateFormatFromTemplate("EEEdMMM")
        return fmt.string(from: date)
    }
}

struct DuoLeftToSpendWidget: Widget {
    let kind = "DuoLeftToSpend"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: SpendProvider()) { entry in
            DuoWidgetView(entry: entry)
                .containerBackground(Color(red: 0.984, green: 0.969, blue: 0.937), for: .widget)
        }
        .configurationDisplayName("Left to spend")
        .description("What’s left this pay, and when you’re paid next.")
        .supportedFamilies([
            .systemSmall,
            .systemMedium,
            .accessoryInline,
            .accessoryCircular,
            .accessoryRectangular
        ])
    }
}

@main
struct DuoWidgetBundle: WidgetBundle {
    var body: some Widget {
        DuoLeftToSpendWidget()
    }
}
