// swift-tools-version:5.9
import PackageDescription

// build.sh wraps the binary in "Focus Screen Audio.app" (Info.plist and icon), which is the
// name macOS shows in its "record audio from other apps" prompt and in System Settings.
let package = Package(
  name: "FocusScreenAudio",
  // Core Audio process taps (CATapDescription) arrived in macOS 14.2.
  platforms: [.macOS("14.2")],
  targets: [
    .executableTarget(name: "focus-screen-audio")
  ]
)
