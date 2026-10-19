import Foundation
import WebKit

/// Serves the bundled web app at duobudget://localhost/ so the page is not a file:// URL.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let raw = (url.path.isEmpty || url.path == "/") ? "index.html" : String(url.path.dropFirst())
        let relative = raw.removingPercentEncoding ?? raw
        guard let file = Bundle.main.resourceURL?.appendingPathComponent(relative),
              FileManager.default.fileExists(atPath: file.path),
              let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let headers = [
            "Content-Type": Self.mime(file),
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache"
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            urlSchemeTask.didFailWithError(URLError(.badServerResponse))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private static func mime(_ url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "html": return "text/html; charset=utf-8"
        case "js": return "text/javascript; charset=utf-8"
        case "json", "webmanifest": return "application/manifest+json"
        case "css": return "text/css; charset=utf-8"
        case "png": return "image/png"
        case "webp": return "image/webp"
        case "ico": return "image/x-icon"
        case "svg": return "image/svg+xml"
        default: return "application/octet-stream"
        }
    }
}
