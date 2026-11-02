/** Given the ramp's target value/duration and the current time, returns the automation params to schedule. Pure: the caller supplies "now". */
export function computeGainRamp(
  _fromGain: number,
  toGain: number,
  rampMs: number,
  nowSeconds: number,
): { targetGain: number; endTimeSeconds: number } {
  return { targetGain: toGain, endTimeSeconds: nowSeconds + rampMs / 1000 }
}
