import UIKit
import WebKit
import WidgetKit

/// Full-screen web app. Pins to the screen edges (not the safe area) so CSS
/// `env(safe-area-inset-*)` can pad the header and tab bar.
final class WebViewController: UIViewController, WKScriptMessageHandler {
    private var webView: WKWebView!
    private let speech = SpeechBridge()
    private let bridge = ScriptBridge()

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.984, green: 0.969, blue: 0.937, alpha: 1)
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: "duobudget")
        bridge.owner = self
        config.userContentController.add(bridge, name: "duoWidget")
        config.userContentController.add(bridge, name: "duoSpeech")
        let web = WKWebView(frame: .zero, configuration: config)
        web.translatesAutoresizingMaskIntoConstraints = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        web.isOpaque = false
        web.backgroundColor = .clear
        view.addSubview(web)
        NSLayoutConstraint.activate([
            web.topAnchor.constraint(equalTo: view.topAnchor),
            web.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            web.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            web.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        webView = web
        speech.onText = { [weak self] text in
            self?.eval("window.__duoVoiceResult && window.__duoVoiceResult(\(Self.js(text)))")
        }
        speech.onError = { [weak self] message in
            self?.eval("window.__duoVoiceError && window.__duoVoiceError(\(Self.js(message)))")
        }
        if let url = URL(string: "duobudget://localhost/index.html") {
            web.load(URLRequest(url: url))
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "duoWidget" {
            guard let snap = WidgetSnapshot.parse(message.body) else { return }
            WidgetStore.save(snap)
            WidgetCenter.shared.reloadAllTimelines()
            return
        }
        if message.name == "duoSpeech" {
            let action = (message.body as? [String: Any])?["action"] as? String
            if action == "stop" { speech.stop() } else { speech.start() }
        }
    }

    private func eval(_ source: String) {
        webView?.evaluateJavaScript(source, completionHandler: nil)
    }

    private static func js(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let encoded = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(encoded.dropFirst().dropLast())
    }
}

/// Breaks the retain cycle between WKUserContentController and the view controller.
final class ScriptBridge: NSObject, WKScriptMessageHandler {
    weak var owner: WebViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.userContentController(userContentController, didReceive: message)
    }
}
