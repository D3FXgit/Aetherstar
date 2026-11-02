/**
 * Native `AudioBufferSourceNode.loop = true` loops the raw decoded samples
 * exactly at the buffer's start/end. Unless the source file was authored as
 * a perfectly seamless loop (matched waveform phase at both edges), that
 * produces an audible click/pop every time it loops -- heard as "clipping".
 * Applying a very short linear fade at both edges removes the discontinuity
 * regardless of the source content, at a cost too brief to hear as a fade.
 */
export function applyLoopDeclick(buffer: AudioBuffer, fadeSeconds: number): void {
  const fadeSamples = Math.min(Math.round(fadeSeconds * buffer.sampleRate), Math.floor(buffer.length / 2))
  if (!(fadeSamples > 0)) return

  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < fadeSamples; i++) {
      const factor = i / fadeSamples
      data[i] *= factor
      data[data.length - 1 - i] *= factor
    }
  }
}
