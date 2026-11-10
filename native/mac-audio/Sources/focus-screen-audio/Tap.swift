import AVFoundation
import CoreAudio
import Foundation

/// What the app gets: 16 kHz mono, plenty for lining up words, and small enough to send as text.
let outputRate = 16_000.0
/// About 100 ms of audio per message.
private let framesPerChunk = AVAudioFrameCount(outputRate / 10)

struct TapError: Error {
  let message: String
  init(_ message: String, _ status: OSStatus = noErr) {
    self.message = status == noErr ? message : "\(message) (\(status))"
  }
}

/// Plain values only (ids, numbers, structs); strings go through readString.
private func read<T: BitwiseCopyable>(
  _ object: AudioObjectID, _ selector: AudioObjectPropertySelector, _ initial: T
) throws -> T {
  var address = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var value = initial
  var size = UInt32(MemoryLayout<T>.size)
  let status = withUnsafeMutablePointer(to: &value) {
    AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
  }
  guard status == noErr else { throw TapError("Couldn't read audio property", status) }
  return value
}

/// Core Audio hands string properties over retained; we take ownership.
private func readString(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws
  -> String
{
  var address = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var value: Unmanaged<CFString>?
  var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
  let status = withUnsafeMutablePointer(to: &value) {
    AudioObjectGetPropertyData(object, &address, 0, nil, &size, $0)
  }
  guard status == noErr, let value else { throw TapError("Couldn't read audio property", status) }
  return value.takeRetainedValue() as String
}

private func readArray(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) throws
  -> [AudioObjectID]
{
  var address = AudioObjectPropertyAddress(
    mSelector: selector, mScope: kAudioObjectPropertyScopeGlobal,
    mElement: kAudioObjectPropertyElementMain)
  var size: UInt32 = 0
  var status = AudioObjectGetPropertyDataSize(object, &address, 0, nil, &size)
  guard status == noErr else { throw TapError("Couldn't list audio objects", status) }
  var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
  status = AudioObjectGetPropertyData(object, &address, 0, nil, &size, &ids)
  guard status == noErr else { throw TapError("Couldn't list audio objects", status) }
  return ids
}

private func bundleID(of process: AudioObjectID) -> String {
  (try? readString(process, kAudioProcessPropertyBundleID)) ?? ""
}

struct PlayerProcess {
  let object: AudioObjectID
  let pid: pid_t
  let bundle: String
}

/// The audio clients whose bundle ID starts with one of `bundles`, or whose pid is in `pids`.
func findProcesses(bundles: [String], pids: [pid_t]) throws -> [PlayerProcess] {
  try readArray(AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyProcessObjectList)
    .compactMap { object in
      let pid = (try? read(object, kAudioProcessPropertyPID, pid_t(-1))) ?? -1
      let bundle = bundleID(of: object)
      let wanted =
        pids.contains(pid) || bundles.contains { !$0.isEmpty && bundle.hasPrefix($0) }
      return wanted ? PlayerProcess(object: object, pid: pid, bundle: bundle) : nil
    }
}

/// The UID of the device macOS plays system sound through; the tap device keeps its clock.
private func defaultOutputUID() throws -> String {
  let device = try read(
    AudioObjectID(kAudioObjectSystemObject), kAudioHardwarePropertyDefaultSystemOutputDevice,
    AudioObjectID(kAudioObjectUnknown))
  return try readString(device, kAudioDevicePropertyDeviceUID)
}

/// Seconds since 1970 for a Core Audio host time.
private func epochSeconds(hostTime: UInt64) -> Double {
  var timebase = mach_timebase_info_data_t()
  mach_timebase_info(&timebase)
  let now = mach_absolute_time()
  let ago = now >= hostTime ? Double(now - hostTime) : -Double(hostTime - now)
  return Date().timeIntervalSince1970 - ago * Double(timebase.numer) / Double(timebase.denom) / 1e9
}

/// Listens to the chosen processes through a private process tap (macOS 14.2+), the way
/// Apple's "capturing system audio" sample does, and hands over 16 kHz mono chunks.
final class PlayerTap {
  private var tapID = AudioObjectID(kAudioObjectUnknown)
  private var deviceID = AudioObjectID(kAudioObjectUnknown)
  private var procID: AudioDeviceIOProcID?
  private let queue = DispatchQueue(label: "focus-screen-audio.tap", qos: .userInitiated)

  /// `onChunk(epochSecondsOfFirstSample, littleEndianInt16Samples)` runs on the tap's queue.
  init(processes: [PlayerProcess], mute: Bool, onChunk: @escaping (Double, Data) -> Void) throws {
    let description = CATapDescription(stereoMixdownOfProcesses: processes.map(\.object))
    description.uuid = UUID()
    description.isPrivate = true
    description.muteBehavior = mute ? .muted : .unmuted
    var status = AudioHardwareCreateProcessTap(description, &tapID)
    guard status == noErr else { throw TapError("Couldn't create the audio tap", status) }

    do {
      var format = try read(tapID, kAudioTapPropertyFormat, AudioStreamBasicDescription())
      guard let input = AVAudioFormat(streamDescription: &format),
        let output = AVAudioFormat(
          commonFormat: .pcmFormatInt16, sampleRate: outputRate, channels: 1, interleaved: true),
        let converter = AVAudioConverter(from: input, to: output)
      else { throw TapError("Unsupported audio format") }
      converter.downmix = true

      // A tap is heard through a private aggregate device, clocked by the output it plays to.
      let outputUID = try defaultOutputUID()
      let device: [String: Any] = [
        kAudioAggregateDeviceNameKey: "Focus Screen Audio",
        kAudioAggregateDeviceUIDKey: UUID().uuidString,
        kAudioAggregateDeviceMainSubDeviceKey: outputUID,
        kAudioAggregateDeviceSubDeviceListKey: [[kAudioSubDeviceUIDKey: outputUID]],
        kAudioAggregateDeviceIsPrivateKey: true,
        kAudioAggregateDeviceIsStackedKey: false,
        kAudioAggregateDeviceTapAutoStartKey: true,
        kAudioAggregateDeviceTapListKey: [
          [kAudioSubTapUIDKey: description.uuid.uuidString, kAudioSubTapDriftCompensationKey: true]
        ],
      ]
      status = AudioHardwareCreateAggregateDevice(device as CFDictionary, &deviceID)
      guard status == noErr else { throw TapError("Couldn't create the tap device", status) }

      var pending = Data()
      var pendingStart: Double?
      let chunk = AVAudioPCMBuffer(pcmFormat: output, frameCapacity: framesPerChunk * 4)!
      status = AudioDeviceCreateIOProcIDWithBlock(&procID, deviceID, queue) {
        _, inputData, inputTime, _, _ in
        guard
          let buffer = AVAudioPCMBuffer(
            pcmFormat: input, bufferListNoCopy: inputData, deallocator: nil),
          buffer.frameLength > 0
        else { return }
        let at =
          inputTime.pointee.mFlags.contains(.hostTimeValid)
          ? epochSeconds(hostTime: inputTime.pointee.mHostTime) : Date().timeIntervalSince1970

        var supplied = false
        chunk.frameLength = 0
        var error: NSError?
        converter.convert(to: chunk, error: &error) { _, inputStatus in
          if supplied {
            inputStatus.pointee = .noDataNow
            return nil
          }
          supplied = true
          inputStatus.pointee = .haveData
          return buffer
        }
        guard error == nil, chunk.frameLength > 0, let samples = chunk.int16ChannelData else {
          return
        }
        if pendingStart == nil { pendingStart = at }
        pending.append(
          Data(bytes: samples[0], count: Int(chunk.frameLength) * MemoryLayout<Int16>.size))
        if pending.count >= Int(framesPerChunk) * 2, let start = pendingStart {
          onChunk(start, pending)
          pending = Data()
          pendingStart = nil
        }
      }
      guard status == noErr else { throw TapError("Couldn't listen to the tap", status) }
      status = AudioDeviceStart(deviceID, procID)
      guard status == noErr else { throw TapError("Couldn't start the tap", status) }
    } catch {
      stop()
      throw error
    }
  }

  func stop() {
    if deviceID != kAudioObjectUnknown {
      if let procID {
        AudioDeviceStop(deviceID, procID)
        AudioDeviceDestroyIOProcID(deviceID, procID)
      }
      AudioHardwareDestroyAggregateDevice(deviceID)
      deviceID = AudioObjectID(kAudioObjectUnknown)
    }
    procID = nil
    if tapID != kAudioObjectUnknown {
      AudioHardwareDestroyProcessTap(tapID)
      tapID = AudioObjectID(kAudioObjectUnknown)
    }
  }
}
