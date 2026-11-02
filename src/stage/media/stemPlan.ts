/**
 * Decides which audio file is the timing clock and which (if any) is the
 * duckable guide vocal.
 *
 * The one inviolable rule of this app's playback is that there is exactly one
 * authoritative audio element: `useStageClock` derives the entire beat
 * position from `audio.currentTime`, so a second, independently-scheduled
 * element must never become a second source of truth, and the clock element
 * must never be swapped while it is working. Every branch below is written to
 * that rule.
 *
 * Why the *instrumental* is the clock when stems are in play: it is the track
 * that always plays at full volume and is never touched by the ducking
 * envelope or by drift correction, so it is the most stable reference of the
 * two. The vocal stem is the follower -- it is the one that gets nudged,
 * re-seeked and attenuated, and none of that can perturb the beat clock.
 */
export interface StemPlanInput {
  /** #AUDIO / #MP3 -- the full mix, if the chart has one. */
  mixUrl: string | null
  /** #VOCALS -- the separated a-cappella track. */
  vocalsUrl: string | null
  /** #INSTRUMENTAL -- the separated backing track. */
  instrumentalUrl: string | null
  /** The vocal stem's <audio> reported an error (missing, undecodable). */
  vocalStemFailed?: boolean
  /** The clock element itself reported an error -- gameplay is already dead, so anything that plays is an improvement. */
  clockFailed?: boolean
  /**
   * Every clock URL that has failed to load so far. None of them is ever
   * offered again: with only a "the clock failed" flag, a second failure would
   * hand back the first URL that had already failed, and the two would
   * alternate forever instead of reaching the error screen.
   */
  failedClockUrls?: ReadonlySet<string>
  /** True once the clock element has actually begun playing. Gates the one swap that is allowed. */
  playbackStarted?: boolean
}

export interface StemPlan {
  /** The single authoritative element's src, or null when nothing is playable at all. */
  clockUrl: string | null
  /** The follower element's src -- the guide vocal that gets ducked. Null means "one element, exactly as before". */
  vocalStemUrl: string | null
  /** True when both stems are actually in use, i.e. ducking is possible. */
  usingStems: boolean
}

export function planStemPlayback(input: StemPlanInput): StemPlan {
  const { mixUrl, vocalsUrl, instrumentalUrl, vocalStemFailed = false, playbackStarted = false } = input

  const stemsPresent = Boolean(vocalsUrl && instrumentalUrl)

  // No stems: today's behaviour, byte for byte -- one element, the full mix.
  if (!stemsPresent) {
    const clockUrl = mixUrl ?? instrumentalUrl ?? vocalsUrl ?? null
    return withClockFallback({ clockUrl, vocalStemUrl: null, usingStems: false }, input)
  }

  if (!vocalStemFailed) {
    return withClockFallback({ clockUrl: instrumentalUrl, vocalStemUrl: vocalsUrl, usingStems: true }, input)
  }

  // The vocal stem is unusable. Two different right answers, split by whether
  // the clock has already started:
  //
  // - Not started yet: nothing depends on the instrumental's position, so
  //   switching to the full mix is free and strictly better -- the singer
  //   hears the complete song instead of a bare backing track.
  // - Already playing: the instrumental IS the clock and the song is audible.
  //   Swapping now would reload a new element and reset it to 0 mid-song,
  //   trading a missing guide vocal for a broken one. Not worth it.
  if (mixUrl && !playbackStarted) {
    return withClockFallback({ clockUrl: mixUrl, vocalStemUrl: null, usingStems: false }, input)
  }
  return withClockFallback({ clockUrl: instrumentalUrl, vocalStemUrl: null, usingStems: false }, input)
}

/**
 * Last resort: the clock element itself failed to load. There is no gameplay
 * without a clock, so an error screen is the floor -- any other audio file in
 * the song is better than that, and swapping is safe precisely because the
 * thing being replaced is already dead.
 */
function withClockFallback(plan: StemPlan, input: StemPlanInput): StemPlan {
  const failed = input.failedClockUrls
  const clockFailed = Boolean(input.clockFailed) || (plan.clockUrl !== null && Boolean(failed?.has(plan.clockUrl)))
  if (!clockFailed) return plan
  const alternative = [input.mixUrl, input.instrumentalUrl, input.vocalsUrl].find(
    (url): url is string => typeof url === 'string' && url.length > 0 && url !== plan.clockUrl && !failed?.has(url),
  )
  return { clockUrl: alternative ?? null, vocalStemUrl: null, usingStems: false }
}
