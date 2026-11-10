let context: AudioContext | undefined

// C6, E6, G6: a rising major arpeggio reads as "done", not "alarm".
const NOTES_HZ = [1046.5, 1318.5, 1568]
const NOTE_GAP_SEC = 0.22
const RING_SEC = 1.6
const VOLUME = 0.2

/** A soft bell, synthesized so there's no sound file to ship or load. */
export function playChime(): void {
  context ??= new AudioContext()
  const audio = context
  // A context can start suspended; resuming is a no-op when it's already running.
  void audio.resume()
  const start = audio.currentTime + 0.05
  NOTES_HZ.forEach((hz, index) => strike(audio, hz, start + index * NOTE_GAP_SEC))
}

function strike(audio: AudioContext, hz: number, at: number): void {
  const envelope = audio.createGain()
  envelope.gain.setValueAtTime(0.0001, at)
  envelope.gain.exponentialRampToValueAtTime(VOLUME, at + 0.01)
  envelope.gain.exponentialRampToValueAtTime(0.0001, at + RING_SEC)
  envelope.connect(audio.destination)

  // A quiet octave on top makes a plain sine sound more like a bell.
  for (const [ratio, level] of [
    [1, 1],
    [2, 0.3]
  ] as const) {
    const partial = audio.createGain()
    partial.gain.value = level
    partial.connect(envelope)
    const tone = audio.createOscillator()
    tone.frequency.value = hz * ratio
    tone.connect(partial)
    tone.start(at)
    tone.stop(at + RING_SEC)
  }
}
