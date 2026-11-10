import Darwin
import Foundation

/// Set in the copy we start, so that copy doesn't start another.
private let disclaimedMarker = "FOCUS_SCREEN_AUDIO_DISCLAIMED"
/// Read by the signal handler, which can't capture anything.
private var childPid: pid_t = 0
private let forwardedSignals = [SIGTERM, SIGINT, SIGHUP]

/// RTLD_DEFAULT: look the symbol up in everything already loaded.
private let rtldDefault = UnsafeMutableRawPointer(bitPattern: -2)

private typealias SetDisclaim = @convention(c) (UnsafeMutablePointer<posix_spawnattr_t?>, Int32) -> Int32

/// macOS asks for audio recording access on behalf of the app that started a process, which for
/// `npm run dev` is a terminal (and granting it there would cover everything run from it).
/// So the helper starts a copy of itself that "disclaims" its parent, the way Chrome starts
/// its helpers; macOS then asks for that copy alone. Returns only if that isn't possible,
/// in which case the helper simply runs as it is.
func runAsOwnProcessIfPossible() {
  guard getenv(disclaimedMarker) == nil,
    let symbol = dlsym(rtldDefault, "responsibility_spawnattrs_setdisclaim")
  else { return }
  let setDisclaim = unsafeBitCast(symbol, to: SetDisclaim.self)

  var attributes: posix_spawnattr_t?
  guard posix_spawnattr_init(&attributes) == 0 else { return }
  defer { posix_spawnattr_destroy(&attributes) }
  guard setDisclaim(&attributes, 1) == 0 else { return }

  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  setenv(disclaimedMarker, "1", 1)
  // Installed before the copy exists so a stop request can't slip in between; the copy
  // starts with default handlers again (exec resets caught signals).
  let forward: @convention(c) (Int32) -> Void = { signal in
    if childPid > 0 { kill(childPid, signal) }
  }
  for signal in forwardedSignals { Darwin.signal(signal, forward) }

  // The copy inherits stdin, stdout and stderr, so it talks to the app directly.
  guard posix_spawn(&childPid, path, nil, &attributes, CommandLine.unsafeArgv, environ) == 0
  else {
    for signal in forwardedSignals { Darwin.signal(signal, SIG_DFL) }
    unsetenv(disclaimedMarker)
    return
  }

  var status: Int32 = 0
  while waitpid(childPid, &status, 0) == -1 && errno == EINTR {}
  let signal = status & 0x7f
  exit(signal == 0 ? (status >> 8) & 0xff : 128 + signal)
}
