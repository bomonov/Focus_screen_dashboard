// swift-tools-version:5.9
import PackageDescription

// build.sh wraps the binary in "Focus Screen Reminders.app" (Info.plist and icon), which is
// the name macOS shows in its Reminders prompt and in System Settings.
let package = Package(
  name: "FocusScreenReminders",
  // Electron's own minimum. EventKit's newer access call is used where it exists (macOS 14+).
  platforms: [.macOS(.v12)],
  targets: [
    .executableTarget(name: "focus-screen-reminders")
  ]
)
