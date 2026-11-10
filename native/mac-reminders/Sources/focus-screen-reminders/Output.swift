import Foundation

/// Prints one JSON object per line. Called on the main queue only, so lines never interleave.
func emit(_ message: [String: Any]) {
  guard
    let data = try? JSONSerialization.data(
      withJSONObject: message, options: [.withoutEscapingSlashes])
  else { return }
  data.withUnsafeBytes { bytes in
    _ = fwrite(bytes.baseAddress, 1, bytes.count, stdout)
  }
  fputs("\n", stdout)
  fflush(stdout)
}

func reply(_ id: Int, _ fields: [String: Any]) {
  var message = fields
  message["type"] = "reply"
  message["id"] = id
  emit(message)
}

func replyError(_ id: Int, _ error: String) {
  reply(id, ["ok": false, "error": error])
}
