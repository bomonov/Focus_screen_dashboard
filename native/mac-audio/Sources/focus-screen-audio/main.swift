// The audio helper for Focus Screen: hears the music player while a song plays, so the app
// can time that song's lyrics. Nothing is stored here; the app keeps or drops what it gets.
//
// Requests come in on stdin, one JSON object per line:
//   {"id":1,"op":"start","bundles":["com.apple.Music"],"pids":[]}   {"id":2,"op":"stop"}
//   {"id":3,"op":"requestAccess"}
//   {"id":4,"op":"mute","on":true,"bundles":["com.apple.Music"]}    {"id":5,"op":"mute","on":false}
//     keeps those apps off the speakers (for preparing a playlist unheard) while "start" still
//     hears them; it follows the apps if their audio processes change, until "on":false
// and everything goes out on stdout, one JSON object per line:
//   {"type":"access","status":"granted"}           at start and whenever the setting changes
//   {"type":"audio","at":1760000000.25,"pcm":"…"}  ~100 ms of 16 kHz mono 16-bit PCM, base64;
//                                                  `at` is the first sample's epoch seconds
//   {"type":"reply","id":1,"ok":true,"bundles":["com.apple.Music"]}
// It exits when stdin closes, so it never outlives the app.
import CoreAudio
import Foundation

/// How often to look at the access setting; macOS doesn't announce changes to it.
private let accessPollSeconds = 2.0

runAsOwnProcessIfPossible()

private var tap: PlayerTap?
/// Bumped by every start and stop, so audio from an earlier tap is never sent after it.
private var generation = 0
private var lastAccess = audioCaptureAccess()
/// While set, the apps to keep muted, and the mute holding the processes they have now.
private var muteBundles: [String]?
private var mute: PlayerMute?
private var mutedObjects = Set<AudioObjectID>()

private func noteAccess(_ status: String) {
  guard status != lastAccess else { return }
  lastAccess = status
  emit(["type": "access", "status": status])
}

private func stopTap() {
  generation += 1
  tap?.stop()
  tap = nil
}

private func start(_ id: Int, _ request: [String: Any]) {
  stopTap()
  let bundles = (request["bundles"] as? [String]) ?? []
  let pids = ((request["pids"] as? [Int]) ?? []).map { pid_t($0) }
  let mine = generation
  do {
    let processes = try findProcesses(bundles: bundles, pids: pids)
    guard !processes.isEmpty else {
      replyError(id, "noProcess")
      return
    }
    // A test run can keep the sound off the speakers; the app never asks for that.
    tap = try PlayerTap(processes: processes, mute: request["mute"] as? Bool ?? false) {
      at, pcm in
      let message: [String: Any] = ["type": "audio", "at": at, "pcm": pcm.base64EncodedString()]
      DispatchQueue.main.async {
        if generation == mine { emit(message) }
      }
    }
    reply(id, ["ok": true, "bundles": Array(Set(processes.map(\.bundle))).sorted()])
  } catch let error as TapError {
    replyError(id, error.message)
  } catch {
    replyError(id, "failed")
  }
}

/// Mutes the processes the muted apps have right now. The new mute is in place before the old
/// one goes, so no sound gets out while a process comes or goes.
private func refreshMute() {
  guard let bundles = muteBundles else { return }
  let processes = (try? findProcesses(bundles: bundles, pids: [])) ?? []
  let objects = Set(processes.map(\.object))
  guard objects != mutedObjects else { return }
  if processes.isEmpty {
    stopMute(keepingBundles: true)
    return
  }
  guard let next = try? PlayerMute(processes: processes) else { return }
  mute?.stop()
  mute = next
  mutedObjects = objects
}

private func stopMute(keepingBundles: Bool = false) {
  mute?.stop()
  mute = nil
  mutedObjects = []
  if !keepingBundles { muteBundles = nil }
}

private func setMute(_ id: Int, _ request: [String: Any]) {
  guard request["on"] as? Bool == true else {
    stopMute()
    reply(id, ["ok": true])
    return
  }
  let bundles = (request["bundles"] as? [String]) ?? []
  muteBundles = bundles
  refreshMute()
  // No process yet is fine: nothing is playing, and one that starts is muted as it appears.
  let processes = (try? findProcesses(bundles: bundles, pids: [])) ?? []
  guard processes.isEmpty || mute != nil else {
    stopMute()
    replyError(id, "failed")
    return
  }
  reply(id, ["ok": true, "bundles": Array(Set(processes.map(\.bundle))).sorted()])
}

/// Taps (and a mute) are let go of before exiting, however the helper is told to stop.
private func shutDown() -> Never {
  stopTap()
  stopMute()
  exit(0)
}

private func handle(_ request: [String: Any]) {
  guard let id = request["id"] as? Int else { return }
  switch request["op"] as? String {
  case "start":
    start(id, request)
  case "stop":
    stopTap()
    reply(id, ["ok": true])
  case "mute":
    setMute(id, request)
  case "requestAccess":
    requestAudioCaptureAccess { status in
      noteAccess(status)
      reply(id, ["ok": true, "status": status])
    }
  default:
    replyError(id, "badRequest")
  }
}

emit(["type": "access", "status": lastAccess])

let accessTimer = DispatchSource.makeTimerSource(queue: .main)
accessTimer.schedule(deadline: .now() + accessPollSeconds, repeating: accessPollSeconds)
accessTimer.setEventHandler { noteAccess(audioCaptureAccess()) }
accessTimer.resume()

// A browser can start a new audio process mid-playlist; a mute follows it.
private var processListAddress = AudioObjectPropertyAddress(
  mSelector: kAudioHardwarePropertyProcessObjectList, mScope: kAudioObjectPropertyScopeGlobal,
  mElement: kAudioObjectPropertyElementMain)
AudioObjectAddPropertyListenerBlock(
  AudioObjectID(kAudioObjectSystemObject), &processListAddress, .main
) { _, _ in refreshMute() }

// The app stops the helper with SIGTERM. Handled on the main queue, where Core Audio calls are
// safe, so a mute never outlives the helper by chance.
let stopSignals = [SIGTERM, SIGINT, SIGHUP].map { number -> DispatchSourceSignal in
  signal(number, SIG_IGN)
  let source = DispatchSource.makeSignalSource(signal: number, queue: .main)
  source.setEventHandler { shutDown() }
  source.resume()
  return source
}

Thread.detachNewThread {
  while let line = readLine(strippingNewline: true) {
    guard let data = line.data(using: .utf8),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else { continue }
    DispatchQueue.main.async { handle(request) }
  }
  DispatchQueue.main.async { shutDown() }
}

dispatchMain()
