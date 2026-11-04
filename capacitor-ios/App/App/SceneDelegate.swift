import UIKit
import Capacitor
import WebKit
import AVFoundation
import Speech

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = DuoBridgeViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

/// WKWebView does not implement webkitSpeechRecognition. The page posts to
/// `duoSpeech`, which is registered before the first load so the first Listen
/// tap can show the system prompts.
final class DuoBridgeViewController: CAPBridgeViewController {
    private let speech = SpeechBridge()
    private let router = SpeechRouter()

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        router.owner = self
        webView?.configuration.userContentController.add(router, name: "duoSpeech")
        speech.onText = { [weak self] text in
            self?.deliver("window.__duoVoiceResult && window.__duoVoiceResult(\(Self.jsString(text)))")
        }
        speech.onError = { [weak self] message in
            self?.deliver("window.__duoVoiceError && window.__duoVoiceError(\(Self.jsString(message)))")
        }
    }

    fileprivate func handleSpeech(_ message: WKScriptMessage) {
        guard message.name == "duoSpeech" else { return }
        let action = (message.body as? [String: Any])?["action"] as? String
        if action == "stop" {
            speech.stop()
        } else {
            speech.start()
        }
    }

    private func deliver(_ source: String) {
        webView?.evaluateJavaScript(source, completionHandler: nil)
    }

    private static func jsString(_ value: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: [value])
        let encoded = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
        return String(encoded.dropFirst().dropLast())
    }
}

/// The user content controller retains its script handler. Keep that retain
/// off the view controller.
final class SpeechRouter: NSObject, WKScriptMessageHandler {
    weak var owner: DuoBridgeViewController?
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        owner?.handleSpeech(message)
    }
}

/// en-AU recogniser for spoken expenses.
/// `requiresOnDeviceRecognition` stays false, which is the system default, so
/// recognition can send audio to Apple's servers. This process does not write
/// an audio file of its own.
final class SpeechBridge: NSObject {
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-AU"))
    private let audioEngine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    var onText: ((String) -> Void)?
    var onError: ((String) -> Void)?

    func start() {
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            DispatchQueue.main.async {
                guard let self = self else { return }
                switch status {
                case .authorized:
                    self.begin()
                case .denied, .restricted:
                    self.onError?("Speech recognition is turned off. Type the phrase instead. You can turn it on in Settings.")
                default:
                    self.onError?("Speech recognition isn't available on this iPhone yet. Type the phrase instead.")
                }
            }
        }
    }

    func stop() {
        if audioEngine.isRunning { audioEngine.stop() }
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        request?.endAudio()
        task?.cancel()
        task = nil
        request = nil
    }

    private func begin() {
        stop()
        guard let recognizer = recognizer, recognizer.isAvailable else {
            onError?("Speech recognition isn't available right now. Type the phrase instead.")
            return
        }
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            DispatchQueue.main.async {
                guard let self = self else { return }
                if granted {
                    self.startEngine(recognizer)
                } else {
                    self.onError?("Microphone permission is off. Type the phrase instead. You can turn it on in Settings.")
                }
            }
        }
    }

    private func startEngine(_ recognizer: SFSpeechRecognizer) {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            onError?("Couldn't use the microphone. Type the phrase instead.")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = false
        self.request = request
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            onError?("Couldn't use the microphone. Type the phrase instead.")
            return
        }
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        tapInstalled = true
        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            stop()
            onError?("Couldn't start listening. Type the phrase instead.")
            return
        }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let text = result?.bestTranscription.formattedString, result?.isFinal == true {
                self.stop()
                DispatchQueue.main.async { self.onText?(text) }
            } else if error != nil {
                self.stop()
                DispatchQueue.main.async { self.onError?("Couldn't hear that. Type the phrase instead.") }
            }
        }
    }
}
