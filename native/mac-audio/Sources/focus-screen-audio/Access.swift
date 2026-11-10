import Foundation

// macOS has no public call that tells an app whether it may record other apps' audio: a tap
// started without permission just hears silence. TCC's own preflight/request calls answer it,
// looked up at run time so a macOS without them simply reports "unknown".
private typealias Preflight = @convention(c) (CFString, CFDictionary?) -> Int
private typealias Request =
  @convention(c) (CFString, CFDictionary?, @escaping @convention(block) (Bool) -> Void) -> Void

private let service = "kTCCServiceAudioCapture" as CFString
private let tcc = dlopen("/System/Library/PrivateFrameworks/TCC.framework/Versions/A/TCC", RTLD_NOW)

/// "granted", "denied" or "unknown" (not asked yet, or this macOS doesn't say).
func audioCaptureAccess() -> String {
  guard let symbol = dlsym(tcc, "TCCAccessPreflight") else { return "unknown" }
  switch unsafeBitCast(symbol, to: Preflight.self)(service, nil) {
  case 0: return "granted"
  case 1: return "denied"
  default: return "unknown"
  }
}

/// Shows macOS's prompt if it hasn't been answered; calls back on the main queue.
func requestAudioCaptureAccess(_ done: @escaping (String) -> Void) {
  guard let symbol = dlsym(tcc, "TCCAccessRequest") else {
    done(audioCaptureAccess())
    return
  }
  unsafeBitCast(symbol, to: Request.self)(service, nil) { _ in
    DispatchQueue.main.async { done(audioCaptureAccess()) }
  }
}
