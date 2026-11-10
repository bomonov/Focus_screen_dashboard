import Foundation

/// Keeps the chosen processes off the speakers for as long as it exists. A muted tap only
/// silences a process while something reads it (a tap nobody reads changed nothing on macOS 27),
/// so this is a muted PlayerTap whose audio is thrown away. A separate PlayerTap on the same
/// processes still hears them, so a song can be recorded while nobody hears it. Stopping it (or
/// the helper exiting) gives the sound back.
final class PlayerMute {
  private let tap: PlayerTap

  init(processes: [PlayerProcess]) throws {
    tap = try PlayerTap(processes: processes, mute: true) { _, _ in }
  }

  func stop() {
    tap.stop()
  }
}
