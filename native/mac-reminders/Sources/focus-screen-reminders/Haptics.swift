import AppKit

/// Haptics mode (`--haptics`): while the Timer card's length wheels are open, the app writes one
/// line each time a wheel lands on 0: "tick" plays the trackpad's light alignment tick, as macOS
/// does when something snaps into place, and "tick firm" (a wheel that came onto 0 fast, where
/// the light one is easy to miss) the firmer level-change one. Only a Force Touch trackpad with a
/// finger on it feels anything; nothing else happens. It reads nothing on this Mac, needs no
/// access, and exits when stdin closes.
func runHaptics() -> Never {
  // The feedback goes out through the window server, so connect to it first.
  _ = NSApplication.shared
  Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
      let pattern: NSHapticFeedbackManager.FeedbackPattern
      switch line {
      case "tick": pattern = .alignment
      case "tick firm": pattern = .levelChange
      default: continue
      }
      DispatchQueue.main.async {
        NSHapticFeedbackManager.defaultPerformer.perform(pattern, performanceTime: .now)
      }
    }
    DispatchQueue.main.async { exit(0) }
  }
  // Nothing else to wait on: serve the main queue until stdin closes.
  dispatchMain()
}
