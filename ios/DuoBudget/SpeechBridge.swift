import AVFoundation
import Foundation
import Speech

/// Native fallback for the Web Speech API, which WKWebView often does not expose.
/// The page calls `webkit.messageHandlers.duoSpeech.postMessage({action:'start', lang:'en-AU'})`
/// and receives `window.__duoVoiceResult(text)` or `window.__duoVoiceError(message)`.
final class SpeechBridge: NSObject, SFSpeechRecognizerDelegate {
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
                    self.onError?("Microphone or speech recognition is turned off. Type the phrase instead.")
                default:
                    self.onError?("Speech recognition isn’t available on this iPhone yet. Type the phrase instead.")
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
            onError?("Speech recognition isn’t available right now. Type the phrase instead.")
            return
        }
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            onError?("Couldn’t use the microphone. Type the phrase instead.")
            return
        }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = false
        self.request = request
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak request] buffer, _ in
            request?.append(buffer)
        }
        tapInstalled = true
        audioEngine.prepare()
        do { try audioEngine.start() } catch {
            onError?("Couldn’t start listening. Type the phrase instead.")
            return
        }
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            guard let self = self else { return }
            if let text = result?.bestTranscription.formattedString, result?.isFinal == true {
                self.stop()
                DispatchQueue.main.async { self.onText?(text) }
            } else if error != nil {
                self.stop()
                DispatchQueue.main.async { self.onError?("Couldn’t hear that. Type the phrase instead.") }
            }
        }
    }
}
