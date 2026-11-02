export interface GainNodeLike {
  gain: {
    value: number
    setValueAtTime(value: number, time: number): void
    linearRampToValueAtTime(value: number, endTime: number): void
    // Optional so the minimal test doubles stay valid; the engine uses them to
    // clear a fade still in flight before scheduling a new one.
    cancelAndHoldAtTime?(cancelTime: number): void
    cancelScheduledValues?(cancelTime: number): void
  }
  connect(destination: unknown): void
  // Optional so the minimal test doubles stay valid; a streamed track's nodes
  // are unhooked with it when the track is released.
  disconnect?(): void
}

export interface BufferSourceNodeLike {
  buffer: AudioBuffer | null
  loop: boolean
  loopStart?: number
  loopEnd?: number
  connect(destination: GainNodeLike): void
  start(when?: number, offset?: number, duration?: number): void
  stop(when?: number): void
  /** Fires once the source has stopped -- at the end of its audio, or after a stop(). */
  onended?: (() => void) | null
}

export interface BiquadFilterNodeLike {
  type: string
  frequency: { value: number }
  Q: { value: number }
  gain: { value: number }
  connect(destination: unknown): void
}

export interface ConvolverNodeLike {
  buffer: AudioBuffer | null
  normalize: boolean
  connect(destination: unknown): void
}

/**
 * The part of an `HTMLMediaElement` the engine streams a long track through
 * (see webAudioManager.ts). An interface rather than the DOM type, so tests can
 * drive playback that jsdom does not have.
 */
export interface MediaElementLike {
  src: string
  crossOrigin: string | null
  preload: string
  currentTime: number
  readonly duration: number
  readonly readyState: number
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface MediaElementSourceNodeLike {
  connect(destination: unknown): void
  disconnect(): void
}

export interface AudioContextLike {
  readonly currentTime: number
  readonly state: 'suspended' | 'running' | 'closed'
  readonly destination: unknown
  createGain(): GainNodeLike
  createBufferSource(): BufferSourceNodeLike
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>
  resume(): Promise<void>
  // Optional: only the effect chains (src/audio/effectChain.ts) use these, and
  // they degrade without them -- so the many minimal test doubles of this
  // interface stay valid.
  readonly sampleRate?: number
  createBiquadFilter?(): BiquadFilterNodeLike
  createConvolver?(): ConvolverNodeLike
  createBuffer?(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer
  // Optional too: a context without it decodes every track whole, as before.
  createMediaElementSource?(element: MediaElementLike): MediaElementSourceNodeLike
}

/** The one place `new AudioContext()` is called for real -- everything else takes this as an injectable factory, for tests. */
export function createAudioContext(): AudioContextLike {
  return new AudioContext() as unknown as AudioContextLike
}

let sharedAudioContext: AudioContextLike | null = null

/**
 * The app's single AudioContext, shared by the music engine and the SFX player.
 *
 * Two contexts are not free the way two of most objects are. Each one is a
 * separate render graph pulled by the same output device, so Chromium has to
 * reconcile them every time either starts or stops making sound, and what gives
 * is the render quantum -- heard as buffer noise under whichever one was
 * already playing. Sharing means the SFX are simply more nodes in the graph the
 * music is already in, which is what mixing is supposed to be.
 *
 * It also means the autoplay-policy resume that webAudioManager.ts arms on a
 * user gesture unblocks the sound effects at the same moment, rather than each
 * subsystem having to win that fight separately.
 */
export function getSharedAudioContext(): AudioContextLike {
  if (!sharedAudioContext) sharedAudioContext = createAudioContext()
  return sharedAudioContext
}

/**
 * Brings a suspended context back, and keeps trying until a user gesture lets
 * it.
 *
 * ## Why the listener is armed *before* resume() answers
 *
 * This used to live in webAudioManager.ts and attached its gesture listener
 * inside `resume().then(...)`. That reads correctly and contains a trap:
 * Chromium does not *reject* `resume()` on a context the autoplay policy is
 * blocking, and it does not resolve it either -- the promise simply stays
 * pending until the context is allowed to run. So on a context created before
 * any qualifying gesture, the `.then` never ran, the listener was never
 * attached, and the one thing that could have unblocked it was the thing that
 * only got armed after it was already unblocked. Permanent silence, from a
 * promise nobody was waiting on.
 *
 * It stayed latent for as long as the only context was the music engine's,
 * built at the first `play()` -- by which point someone had clicked their way
 * to the menu, so `resume()` resolved at once. It stopped being latent when the
 * sound effects joined the same context (sfxPlayer.ts): a hover sound builds
 * the context during the boot screen, before anything has been clicked, and
 * because *everything* now shares that context, the trap took the whole app's
 * audio with it rather than just the music.
 *
 * So the listener goes on immediately, and `resume()` is asked in parallel
 * rather than waited on. If the policy is already satisfied the resume resolves
 * and the listener comes straight back off; if it is not, the next pointer or
 * key event asks again -- which is exactly the gesture the policy was waiting
 * for.
 *
 * @param onSettled fires once this attempt is finished with, so a caller can
 *   guarantee only one listener pair is ever attached at a time.
 */
export function ensureAudioContextRunning(audioContext: AudioContextLike, onSettled: () => void = () => {}): void {
  // 'closed' is deliberately not touched -- resume() rejects on one and nothing
  // can bring it back.
  if (audioContext.state !== 'suspended') {
    onSettled()
    return
  }

  let finished = false

  // Function declarations, not consts: the three refer to each other.
  function detach(): void {
    if (typeof window === 'undefined') return
    window.removeEventListener('pointerdown', onGesture)
    window.removeEventListener('keydown', onGesture)
  }

  function settle(): void {
    if (finished) return
    finished = true
    detach()
    onSettled()
  }

  /**
   * Detaches *before* asking, not after the answer comes back: this is a
   * one-shot, and `resume()` is asynchronous, so a listener left on until it
   * settles would fire again for every further click in the meantime -- a burst
   * of resume() calls for one gesture. If the gesture turns out not to have
   * been enough, `onSettled` lets the caller re-arm a fresh one.
   */
  function onGesture(): void {
    detach()
    void audioContext.resume().then(settle, settle)
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onGesture)
    window.addEventListener('keydown', onGesture)
  }

  // Asked in parallel with the listener above, never waited on before arming
  // it. A context that was only suspended (a backgrounded window, say, rather
  // than the autoplay policy) comes back here and takes the listener off again.
  void audioContext.resume().then(() => {
    if (audioContext.state === 'running') settle()
  }, () => {})
}
