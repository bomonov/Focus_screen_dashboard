#!/bin/sh
# Builds the Safari container app and installs it to ~/Applications (or $INSTALL_DIR).
# Xcode registers every build with macOS, and Safari lists each registered copy as its own
# extension, so the build copy is unregistered and removed once installed.
set -e
cd "$(dirname "$0")/../.."

APP="Focus Screen Connector.app"
BUILD_DIR="$HOME/Library/Developer/Xcode/DerivedData/FocusScreenConnector"
BUILT="$BUILD_DIR/Build/Products/Release/$APP"
INSTALL_DIR="${INSTALL_DIR:-$HOME/Applications}"
INSTALLED="$INSTALL_DIR/$APP"
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Versions/Current/Frameworks/LaunchServices.framework/Versions/Current/Support/lsregister

xcodebuild -quiet \
  -project "native/safari-extension/Focus Screen Connector/Focus Screen Connector.xcodeproj" \
  -scheme "Focus Screen Connector" -configuration Release \
  -derivedDataPath "$BUILD_DIR" -allowProvisioningUpdates build

pluginkit -r "$BUILT/Contents/PlugIns/Focus Screen Connector Extension.appex" 2>/dev/null || true
"$LSREGISTER" -u "$BUILT"
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALLED"
ditto "$BUILT" "$INSTALLED"
rm -rf "$BUILT"
"$LSREGISTER" -f "$INSTALLED"
echo "Installed $INSTALLED"
