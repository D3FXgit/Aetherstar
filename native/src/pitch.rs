//! Hand-rolled YIN pitch detection with a lightweight pYIN-style refinement,
//! octave-error suppression against recent history, and an RMS noise gate.
//! Self-contained: no external pitch-detection library.
//!
//! Cost model. YIN's difference function is O(window x tau_max), and both of
//! those scale with the sample rate -- at 48 kHz one window was ~470k
//! multiply-adds, per channel, per frame. A singing voice's fundamental sits
//! far below 1.5 kHz, so the coarse search runs on a copy low-passed and
//! decimated by an integer factor to ~16 kHz (9x fewer multiply-adds at 48k,
//! 36x at 96k), and only the final sub-sample refinement goes back to the
//! full-rate samples, over a handful of lags around the coarse answer. That
//! keeps full-rate precision (well under a cent on clean tones) at a small
//! fraction of the cost, which is what lets frames run at a 10 ms hop.
//!
//! The detector runs at the device's own sample rate: there is no resampling
//! step in front of it any more, so there is no resampler to fail and no
//! "analyse at the wrong rate" fallback to be sharp by.

use std::collections::VecDeque;
use std::f32::consts::PI;

/// Lowest singable frequency this detector is tuned for (margin below the 80 Hz bottom of the supported range).
const MIN_FREQ_HZ: f32 = 70.0;
/// Highest fundamental the detector will report. Nothing a voice sings in a
/// karaoke song goes above this, and capping it stops a whistle, a sibilant or
/// a high harmonic of the backing track from being scored as a sung note.
const MAX_FREQ_HZ: f32 = 1500.0;
/// Headroom on [`MAX_FREQ_HZ`] for interpolation jitter right at the cap.
const MAX_FREQ_TOLERANCE: f32 = 1.03;
/// YIN's absolute threshold for accepting a candidate period (standard value is 0.1-0.15).
const ABSOLUTE_THRESHOLD: f32 = 0.15;
/// RMS below this (on a [-1, 1] signal) is treated as silence/noise, not a pitch.
const RMS_NOISE_GATE: f32 = 0.01;
/// How many recently-accepted pitches we keep for octave-error suppression.
/// Frames now arrive every ~10 ms, so 12 of them span roughly the same
/// ~120-140 ms of singing the old 5-frame history did at a ~28 ms cadence.
const HISTORY_LEN: usize = 12;
/// An alternate-octave candidate is only preferred over the primary one if its
/// difference-function value is no more than this much worse.
const OCTAVE_CANDIDATE_MARGIN: f32 = 0.12;
/// The rate the coarse YIN search runs at, approximately: the input is
/// decimated by `round(rate / this)`, never by a fractional factor.
const ANALYSIS_TARGET_RATE_HZ: f32 = 16_000.0;
/// Anti-alias FIR length per unit of decimation factor (plus one, for an odd,
/// symmetric filter). 25 taps at 48 kHz.
const FILTER_TAPS_PER_FACTOR: usize = 8;
/// Anti-alias cutoff as a fraction of the *decimated* Nyquist frequency --
/// ~6.4 kHz at 48k -> 16k, far above any fundamental the cap lets through.
const FILTER_CUTOFF_FRACTION: f32 = 0.8;

pub struct PitchResult {
    pub hz: f32,
    pub confidence: f32,
}

/// One analysis window's full result.
///
/// `rms` is reported for *every* window, including ones the noise gate rejects
/// and ones too short to run YIN on -- the input-level meters on the player
/// matrix exist precisely to diagnose a quiet or dead mic, so a below-gate
/// frame is the frame that matters most there. `pitch` stays `None` for those,
/// so nothing downstream ever sees a fabricated pitch.
pub struct AnalysisResult {
    pub rms: f32,
    pub pitch: Option<PitchResult>,
}

pub struct PitchDetector {
    history: VecDeque<f32>,
    /// The decimation factor `filter` was designed for, so the coefficients
    /// are computed once per stream rather than once per window.
    filter_factor: usize,
    filter: Vec<f32>,
}

impl PitchDetector {
    pub fn new() -> Self {
        Self { history: VecDeque::with_capacity(HISTORY_LEN + 1), filter_factor: 1, filter: vec![1.0] }
    }

    /// Minimum sample count `detect` needs for the given sample rate, so callers
    /// (the ring-buffer-draining worker) know how much audio to hand it.
    ///
    /// Two periods of [`MIN_FREQ_HZ`] at the decimated rate, plus what the
    /// anti-alias filter consumes at the edges -- ~29 ms at 44.1/48/96 kHz.
    pub fn required_samples(sample_rate: u32) -> usize {
        let factor = decimation_factor(sample_rate);
        let tau_max = (analysis_rate(sample_rate, factor) / MIN_FREQ_HZ).ceil() as usize;
        if factor == 1 {
            tau_max * 2
        } else {
            2 * tau_max * factor + filter_taps(factor) - 1 + factor
        }
    }

    /// Analyses one window: always an RMS level, plus a pitch when one is found.
    ///
    /// The level is computed before -- and independently of -- the noise gate,
    /// so a gated window still reports how loud it was.
    pub fn analyze(&mut self, samples: &[f32], sample_rate: u32) -> AnalysisResult {
        let level = rms(samples);
        AnalysisResult { rms: level, pitch: self.detect(samples, sample_rate, level) }
    }

    fn detect(&mut self, samples: &[f32], sample_rate: u32, level: f32) -> Option<PitchResult> {
        // A non-finite level means a non-finite sample got in -- a disconnecting
        // interface, an unclocked channel, a driver returning garbage for an
        // input that is not really there. There is no pitch in that window, and
        // trying to find one propagates the NaN through the whole YIN pipeline.
        // Checked on the level rather than by scanning the window because `rms`
        // has already summed every sample: a single NaN or infinity in there
        // makes the whole sum non-finite.
        if !level.is_finite() {
            return None;
        }
        if level < RMS_NOISE_GATE || sample_rate == 0 {
            return None;
        }

        let factor = decimation_factor(sample_rate);
        let rate = analysis_rate(sample_rate, factor);
        let decimated: Vec<f32>;
        let analysis: &[f32] = if factor == 1 {
            samples
        } else {
            self.ensure_filter(factor);
            decimated = decimate(samples, &self.filter, factor);
            &decimated
        };

        // Clamped to half the window so `difference_function` can never read
        // past the end of a short window (it reads up to index 2 * tau_max - 1).
        let tau_max = ((rate / MIN_FREQ_HZ).ceil() as usize).min(analysis.len() / 2);
        if tau_max < 8 {
            return None;
        }
        let window = tau_max;

        let diff = difference_function(analysis, window, tau_max);
        let cmndf = cumulative_mean_normalized_difference(&diff);

        // No threshold crossing means no periodicity: breath, noise, bleed.
        // That is an unvoiced frame, not a low-confidence pitch.
        let primary_tau = pick_tau(&cmndf, ABSOLUTE_THRESHOLD)?;
        // The first dip lies above the frequency cap. Reporting the next dip
        // instead would be an octave (or worse) error, so the frame is unvoiced.
        let min_tau = rate / (MAX_FREQ_HZ * MAX_FREQ_TOLERANCE);
        if (primary_tau as f32) < min_tau {
            return None;
        }

        let chosen_tau = self.suppress_octave_error(&cmndf, primary_tau, rate, min_tau);
        let period = refine_period(samples, chosen_tau * factor, factor)
            .unwrap_or_else(|| parabolic_interpolate(&cmndf, chosen_tau) * factor as f32);
        if !period.is_finite() || period <= 0.0 {
            return None;
        }
        let hz = sample_rate as f32 / period;
        if hz > MAX_FREQ_HZ * MAX_FREQ_TOLERANCE {
            return None;
        }
        let confidence = (1.0 - cmndf[chosen_tau]).clamp(0.0, 1.0);

        self.history.push_back(hz);
        if self.history.len() > HISTORY_LEN {
            self.history.pop_front();
        }

        Some(PitchResult { hz, confidence })
    }

    fn ensure_filter(&mut self, factor: usize) {
        if self.filter_factor != factor {
            self.filter = design_lowpass(factor);
            self.filter_factor = factor;
        }
    }

    /// pYIN-style refinement: rather than a single hard threshold, compare the
    /// primary candidate against its half/double-frequency alternates and, when
    /// one of them is both close to recent history and not meaningfully worse
    /// by the difference function, prefer it. This is a deliberately lightweight
    /// stand-in for pYIN's full HMM/Viterbi candidate decoding, which the
    /// synthetic-fixture tests here do not need.
    fn suppress_octave_error(&self, cmndf: &[f32], primary_tau: usize, rate: f32, min_tau: f32) -> usize {
        if self.history.is_empty() {
            return primary_tau;
        }
        let history_avg = self.history.iter().sum::<f32>() / self.history.len() as f32;

        let primary_hz = rate / primary_tau as f32;
        let mut best_tau = primary_tau;
        let mut best_score = cmndf[primary_tau] + freq_distance(primary_hz, history_avg);

        for &candidate_tau in &[primary_tau * 2, primary_tau / 2] {
            if candidate_tau == 0 || candidate_tau >= cmndf.len() || (candidate_tau as f32) < min_tau {
                continue;
            }
            if cmndf[candidate_tau] > cmndf[primary_tau] + OCTAVE_CANDIDATE_MARGIN {
                continue; // meaningfully worse fit -- not a real alternate reading
            }
            let candidate_hz = rate / candidate_tau as f32;
            let score = cmndf[candidate_tau] + freq_distance(candidate_hz, history_avg);
            if score < best_score {
                best_score = score;
                best_tau = candidate_tau;
            }
        }

        best_tau
    }
}

impl Default for PitchDetector {
    fn default() -> Self {
        Self::new()
    }
}

/// The integer factor the input is decimated by before the coarse YIN search:
/// 3 at 44.1/48 kHz, 6 at 88.2/96 kHz, 1 (no decimation) at 22.05 kHz and below.
pub fn decimation_factor(sample_rate: u32) -> usize {
    ((sample_rate as f32 / ANALYSIS_TARGET_RATE_HZ).round() as usize).max(1)
}

fn analysis_rate(sample_rate: u32, factor: usize) -> f32 {
    sample_rate as f32 / factor.max(1) as f32
}

fn filter_taps(factor: usize) -> usize {
    if factor <= 1 {
        1
    } else {
        FILTER_TAPS_PER_FACTOR * factor + 1
    }
}

/// Hamming-windowed-sinc low-pass for decimating by `factor`, normalised to
/// unity gain at DC. A single `[1.0]` tap (a no-op) for `factor <= 1`.
fn design_lowpass(factor: usize) -> Vec<f32> {
    let taps = filter_taps(factor);
    if taps <= 1 {
        return vec![1.0];
    }
    // Cycles per input sample.
    let cutoff = FILTER_CUTOFF_FRACTION * 0.5 / factor as f32;
    let span = (taps - 1) as f32;
    let mut coefficients: Vec<f32> = (0..taps)
        .map(|i| {
            let n = i as f32 - span / 2.0;
            let sinc = if n == 0.0 { 2.0 * cutoff } else { (2.0 * PI * cutoff * n).sin() / (PI * n) };
            let window = 0.54 - 0.46 * (2.0 * PI * i as f32 / span).cos();
            sinc * window
        })
        .collect();
    let sum: f32 = coefficients.iter().sum();
    if sum.is_finite() && sum != 0.0 {
        for coefficient in &mut coefficients {
            *coefficient /= sum;
        }
    }
    coefficients
}

/// Filters and keeps every `factor`-th output, "valid" mode only (no output
/// sample depends on audio outside the window), so overlapping windows never
/// need filter state carried between them.
fn decimate(samples: &[f32], filter: &[f32], factor: usize) -> Vec<f32> {
    let taps = filter.len();
    if factor == 0 || taps == 0 || samples.len() < taps {
        return Vec::new();
    }
    let count = (samples.len() - taps) / factor + 1;
    (0..count)
        .map(|k| {
            let start = k * factor;
            samples[start..start + taps].iter().zip(filter).map(|(s, h)| s * h).sum::<f32>()
        })
        .collect()
}

/// log2 distance between two frequencies, used purely as a "closeness to
/// recent history" penalty when disambiguating octave candidates.
fn freq_distance(hz: f32, history_avg_hz: f32) -> f32 {
    if history_avg_hz <= 0.0 || hz <= 0.0 {
        return 0.0;
    }
    (hz / history_avg_hz).log2().abs() * 0.05
}

fn rms(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

/// sum_{j=0}^{window-1} (x[j] - x[j+lag])^2. Callers guarantee
/// `lag + window <= samples.len()`.
fn squared_difference(samples: &[f32], lag: usize, window: usize) -> f32 {
    samples[..window]
        .iter()
        .zip(&samples[lag..lag + window])
        .map(|(a, b)| {
            let d = a - b;
            d * d
        })
        .sum()
}

/// YIN step 1: d(tau) = sum_{j=0}^{window-1} (x[j] - x[j+tau])^2
fn difference_function(samples: &[f32], window: usize, tau_max: usize) -> Vec<f32> {
    let mut diff = vec![0.0f32; tau_max + 1];
    for (tau, slot) in diff.iter_mut().enumerate().skip(1) {
        *slot = squared_difference(samples, tau, window);
    }
    diff
}

/// YIN step 2: cumulative mean normalized difference function.
fn cumulative_mean_normalized_difference(diff: &[f32]) -> Vec<f32> {
    let mut cmndf = vec![0.0f32; diff.len()];
    if cmndf.is_empty() {
        return cmndf;
    }
    cmndf[0] = 1.0;
    let mut running_sum = 0.0f32;
    for tau in 1..diff.len() {
        running_sum += diff[tau];
        cmndf[tau] = if running_sum == 0.0 {
            1.0
        } else {
            diff[tau] * tau as f32 / running_sum
        };
    }
    cmndf
}

/// YIN step 3: the first local minimum under the absolute threshold.
///
/// There is deliberately no "global minimum" fallback any more. That fallback
/// gave every window *some* pitch -- breath, room noise, backing-track bleed --
/// and every one of those then reached scoring as a sung note. No threshold
/// crossing means no periodicity, and the frame is reported unvoiced.
///
/// NaN never satisfies `<`, so a NaN in `cmndf` is simply never picked (the
/// old fallback's `partial_cmp().unwrap()` on NaN was the 8-player crash).
fn pick_tau(cmndf: &[f32], threshold: f32) -> Option<usize> {
    let mut tau = 2;
    while tau + 1 < cmndf.len() {
        if cmndf[tau] < threshold {
            while tau + 1 < cmndf.len() && cmndf[tau + 1] < cmndf[tau] {
                tau += 1;
            }
            return Some(tau);
        }
        tau += 1;
    }
    None
}

/// Sub-sample period estimate at the *full* input rate.
///
/// The coarse search ran on the decimated signal, so its period is only good
/// to +/- `factor` input samples. This evaluates the plain difference function
/// on the original samples for every lag in `centre_lag +/- (factor + 1)` --
/// a few thousand multiply-adds -- and fits a parabola through the minimum and
/// its two neighbours. Returns `None` when the window is too short to do so.
fn refine_period(samples: &[f32], centre_lag: usize, factor: usize) -> Option<f32> {
    let reach = factor.max(1) + 1;
    let lo = centre_lag.saturating_sub(reach).max(1);
    let hi = centre_lag + reach;
    if hi >= samples.len() || hi < lo + 2 {
        return None;
    }
    let window = samples.len() - hi;
    if window < 8 {
        return None;
    }
    let diffs: Vec<f32> = (lo..=hi).map(|lag| squared_difference(samples, lag, window)).collect();
    // Interior points only, so the parabola has a neighbour on each side.
    let best = (1..diffs.len() - 1).min_by(|&a, &b| diffs[a].total_cmp(&diffs[b]))?;
    let (y0, y1, y2) = (diffs[best - 1], diffs[best], diffs[best + 1]);
    let denom = y0 - 2.0 * y1 + y2;
    let shift = if denom > 0.0 && denom.is_finite() { (0.5 * (y0 - y2) / denom).clamp(-0.5, 0.5) } else { 0.0 };
    Some((lo + best) as f32 + shift)
}

/// YIN step 5: parabolic interpolation around the chosen tau for sub-sample
/// precision. Now only the fallback for when [`refine_period`] cannot run.
fn parabolic_interpolate(cmndf: &[f32], tau: usize) -> f32 {
    if tau == 0 || tau + 1 >= cmndf.len() {
        return tau as f32;
    }
    let (x0, x1, x2) = (cmndf[tau - 1], cmndf[tau], cmndf[tau + 1]);
    // Standard 3-point parabolic-peak interpolation offset: p = 0.5*(y-1 - y1) / (y-1 - 2*y0 + y1).
    let denom = x0 - 2.0 * x1 + x2;
    if denom.abs() < f32::EPSILON {
        return tau as f32;
    }
    let shift = 0.5 * (x0 - x2) / denom;
    tau as f32 + shift
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{assert_within_cents, synth_sine};

    fn synth_sine_with_harmonic(fundamental: f32, harmonic_amplitude: f32, sample_rate: u32, num_samples: usize) -> Vec<f32> {
        (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (2.0 * PI * fundamental * t).sin() + harmonic_amplitude * (2.0 * PI * fundamental * 2.0 * t).sin()
            })
            .collect()
    }

    /// A band-limited sawtooth: every harmonic up to `max_harmonic_hz` at 1/k
    /// amplitude -- a much more voice-like spectrum than a pure sine, and the
    /// case the decimation filter actually has to earn its keep on.
    fn synth_sawtooth(fundamental: f32, max_harmonic_hz: f32, sample_rate: u32, num_samples: usize) -> Vec<f32> {
        let harmonics = (max_harmonic_hz / fundamental).floor().max(1.0) as usize;
        (0..num_samples)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                (1..=harmonics).map(|k| (2.0 * PI * fundamental * k as f32 * t).sin() / k as f32).sum::<f32>() * 0.5
            })
            .collect()
    }

    /// A deterministic pseudo-random generator (xorshift32) so the noise test
    /// is reproducible across runs (no committed audio fixtures).
    fn synth_noise(seed: u32, num_samples: usize) -> Vec<f32> {
        let mut state = seed;
        (0..num_samples)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                (state as f32 / u32::MAX as f32) * 2.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn detects_sine_sweep_within_five_cents() {
        let sample_rate = 48_000;
        let sweep_hz = [80.0, 110.0, 150.0, 220.0, 330.0, 440.0, 523.25, 660.0, 880.0, 1100.0];
        for &freq in &sweep_hz {
            let mut detector = PitchDetector::new();
            let samples = synth_sine(freq, sample_rate, PitchDetector::required_samples(sample_rate) + 64);
            let result = detector.analyze(&samples, sample_rate).pitch.expect("expected a pitch for a clean sine");
            assert_within_cents(result.hz, freq, 5.0);
        }
    }

    /// The detector now runs at the device's own rate (no resampling step), so
    /// every common rate -- decimated by 3, by 6, or not at all -- has to hold
    /// the same accuracy budget on its own.
    #[test]
    fn detects_sine_sweep_within_five_cents_at_every_common_device_rate() {
        let sweep_hz = [80.0, 110.0, 220.0, 440.0, 880.0, 1100.0, 1400.0];
        for &sample_rate in &[44_100u32, 48_000, 88_200, 96_000, 22_050, 16_000] {
            for &freq in &sweep_hz {
                let mut detector = PitchDetector::new();
                let samples = synth_sine(freq, sample_rate, PitchDetector::required_samples(sample_rate));
                let result = detector
                    .analyze(&samples, sample_rate)
                    .pitch
                    .unwrap_or_else(|| panic!("expected a pitch for {freq} Hz at {sample_rate} Hz"));
                assert_within_cents(result.hz, freq, 5.0);
                assert!(result.confidence > 0.8, "{freq} Hz at {sample_rate} Hz: confidence {}", result.confidence);
            }
        }
    }

    #[test]
    fn detects_harmonic_rich_tones_within_five_cents() {
        for &sample_rate in &[44_100u32, 48_000, 96_000] {
            for &freq in &[98.0f32, 196.0, 392.0, 784.0] {
                let mut detector = PitchDetector::new();
                let samples = synth_sawtooth(freq, 15_000.0, sample_rate, PitchDetector::required_samples(sample_rate));
                let result = detector
                    .analyze(&samples, sample_rate)
                    .pitch
                    .unwrap_or_else(|| panic!("expected a pitch for a {freq} Hz sawtooth at {sample_rate} Hz"));
                assert_within_cents(result.hz, freq, 5.0);
            }
        }
    }

    #[test]
    fn confidence_is_high_for_clean_sine_and_noise_is_unvoiced() {
        let sample_rate = 48_000;
        let n = PitchDetector::required_samples(sample_rate) + 64;

        let mut clean_detector = PitchDetector::new();
        let clean = synth_sine(220.0, sample_rate, n);
        let clean_result = clean_detector.analyze(&clean, sample_rate).pitch.expect("clean sine should detect a pitch");
        assert!(clean_result.confidence > 0.8, "expected high confidence, got {}", clean_result.confidence);

        // Loud (well above the noise gate) and aperiodic: breath, hiss, bleed.
        // With the global-minimum fallback gone this must be unvoiced outright,
        // not a low-confidence pitch that still reaches scoring.
        for seed in [0x1234_5678u32, 1, 999, 0xDEAD_BEEF, 42, 7] {
            let mut noise_detector = PitchDetector::new();
            let noise = synth_noise(seed, n);
            let result = noise_detector.analyze(&noise, sample_rate);
            assert!(result.rms > RMS_NOISE_GATE, "fixture must clear the noise gate");
            assert!(result.pitch.is_none(), "noise (seed {seed:#x}) must be unvoiced");
        }
    }

    #[test]
    fn tones_above_the_frequency_cap_are_unvoiced_not_octave_folded() {
        for &sample_rate in &[44_100u32, 48_000] {
            for &freq in &[1_600.0f32, 2_000.0, 3_000.0] {
                let mut detector = PitchDetector::new();
                let samples = synth_sine(freq, sample_rate, PitchDetector::required_samples(sample_rate));
                let pitch = detector.analyze(&samples, sample_rate).pitch;
                assert!(
                    pitch.is_none(),
                    "{freq} Hz at {sample_rate} Hz is above the cap and must not be reported (got {:?} Hz)",
                    pitch.map(|p| p.hz)
                );
            }
        }
    }

    #[test]
    fn octave_error_is_suppressed_against_recent_history() {
        let sample_rate = 48_000;
        let n = PitchDetector::required_samples(sample_rate) + 64;
        let mut detector = PitchDetector::new();

        // Prime history with several clean 220 Hz frames.
        for _ in 0..3 {
            let samples = synth_sine(220.0, sample_rate, n);
            let result = detector.analyze(&samples, sample_rate).pitch.unwrap();
            assert_within_cents(result.hz, 220.0, 5.0);
        }

        // A frame with a strong 2nd-harmonic component -- a classic case where a
        // naive YIN can lock onto the harmonic (440 Hz) instead of the true
        // fundamental (220 Hz). History-aware suppression should keep it at 220.
        let ambiguous = synth_sine_with_harmonic(220.0, 0.9, sample_rate, n);
        let result = detector.analyze(&ambiguous, sample_rate).pitch.unwrap();
        assert_within_cents(result.hz, 220.0, 25.0);
    }

    #[test]
    fn noise_gate_rejects_near_silence() {
        let sample_rate = 48_000;
        let n = PitchDetector::required_samples(sample_rate) + 64;
        let mut detector = PitchDetector::new();
        let near_silence = synth_sine(220.0, sample_rate, n).iter().map(|s| s * 0.0005).collect::<Vec<_>>();
        assert!(detector.analyze(&near_silence, sample_rate).pitch.is_none());
    }

    /// The meter's whole reason to exist is diagnosing an input that is too
    /// quiet, so the frames the noise gate throws away must still carry a level.
    #[test]
    fn a_below_noise_gate_window_still_reports_its_level() {
        let sample_rate = 48_000;
        let n = PitchDetector::required_samples(sample_rate) + 64;
        let mut detector = PitchDetector::new();

        let quiet = synth_sine(220.0, sample_rate, n).iter().map(|s| s * 0.0005).collect::<Vec<_>>();
        let result = detector.analyze(&quiet, sample_rate);

        assert!(result.pitch.is_none(), "this level is under the gate, so there must be no pitch");
        // A full-scale sine has RMS 1/sqrt(2); scaled by 0.0005 that is ~0.000354.
        assert!(result.rms > 0.0, "a gated frame must still report a non-zero level, got {}", result.rms);
        assert!((result.rms - 0.000_353_6).abs() < 1e-5, "unexpected rms {}", result.rms);
        assert!(result.rms < RMS_NOISE_GATE, "fixture should be below the gate, got {}", result.rms);
    }

    /// The 8-player crash, at its source.
    ///
    /// A non-finite sample -- a disconnecting interface, an unclocked channel --
    /// used to reach `pick_tau`'s fallback as a NaN, where `partial_cmp`
    /// returns `None` and the `unwrap()` panicked. That panic unwound the
    /// per-device consumer thread while it held the subscription lock, and the
    /// next `start_capture` on that device aborted the entire Electron process
    /// on a poisoned `lock().unwrap()`. Eight singers on one interface share
    /// that lock, which is why it showed up at eight players and not at two.
    #[test]
    fn non_finite_samples_yield_no_pitch_instead_of_panicking() {
        let sample_rate = 48_000;
        let mut detector = PitchDetector::new();

        for bad in [f32::NAN, f32::INFINITY, f32::NEG_INFINITY] {
            let mut samples = synth_sine(220.0, sample_rate, 4096);
            samples[100] = bad;
            let result = detector.analyze(&samples, sample_rate);
            assert!(result.pitch.is_none(), "a window containing {bad} has no pitch to report");
        }

        // And an all-NaN window, where even the level is unusable.
        let samples = vec![f32::NAN; 4096];
        assert!(detector.analyze(&samples, sample_rate).pitch.is_none());
    }

    /// With no value under the threshold there is no pitch: `pick_tau` used to
    /// fall back to the global minimum here (and, before that, panic on NaN).
    #[test]
    fn pick_tau_reports_unvoiced_when_nothing_crosses_the_threshold() {
        let cmndf = vec![1.0, 1.0, f32::NAN, 0.9, f32::NAN, 0.95];
        assert_eq!(pick_tau(&cmndf, 0.1), None);
        assert_eq!(pick_tau(&[], 0.1), None);
        assert_eq!(pick_tau(&[1.0], 0.1), None);
    }

    #[test]
    fn pick_tau_takes_the_bottom_of_the_first_dip_under_the_threshold() {
        let cmndf = vec![1.0, 1.0, 0.8, 0.12, 0.05, 0.3, 0.9, 0.01, 0.5];
        assert_eq!(pick_tau(&cmndf, 0.15), Some(4), "the first dip wins, even over a deeper later one");
    }

    #[test]
    fn decimation_factor_targets_roughly_sixteen_kilohertz() {
        assert_eq!(decimation_factor(48_000), 3);
        assert_eq!(decimation_factor(44_100), 3);
        assert_eq!(decimation_factor(96_000), 6);
        assert_eq!(decimation_factor(88_200), 6);
        assert_eq!(decimation_factor(192_000), 12);
        assert_eq!(decimation_factor(22_050), 1);
        assert_eq!(decimation_factor(16_000), 1);
        assert_eq!(decimation_factor(8_000), 1);
        assert_eq!(decimation_factor(0), 1);
    }

    fn magnitude_response(filter: &[f32], cycles_per_sample: f32) -> f32 {
        let (mut re, mut im) = (0.0f32, 0.0f32);
        for (i, &h) in filter.iter().enumerate() {
            let phase = 2.0 * PI * cycles_per_sample * i as f32;
            re += h * phase.cos();
            im -= h * phase.sin();
        }
        (re * re + im * im).sqrt()
    }

    #[test]
    fn anti_alias_filter_passes_the_voice_band_and_stops_what_would_alias() {
        for factor in [2usize, 3, 6] {
            let filter = design_lowpass(factor);
            assert_eq!(filter.len(), filter_taps(factor));
            assert!((magnitude_response(&filter, 0.0) - 1.0).abs() < 1e-4, "unity DC gain at factor {factor}");
            // 1.5 kHz at a 16 kHz decimated rate: the top of the pitch range.
            let passband = magnitude_response(&filter, 1_500.0 / 16_000.0 / factor as f32);
            assert!((passband - 1.0).abs() < 0.01, "factor {factor}: passband gain {passband}");
            // A quarter above the decimated Nyquist: must be >= 40 dB down.
            let stopband = magnitude_response(&filter, 0.625 / factor as f32);
            assert!(stopband < 0.01, "factor {factor}: stopband gain {stopband}");
        }
        assert_eq!(design_lowpass(1), vec![1.0]);
    }

    #[test]
    fn required_samples_always_leaves_two_lowest_periods_after_decimation() {
        for &sample_rate in &[16_000u32, 22_050, 32_000, 44_100, 48_000, 88_200, 96_000, 192_000] {
            let factor = decimation_factor(sample_rate);
            let needed = PitchDetector::required_samples(sample_rate);
            let decimated_len = decimate(&vec![0.0; needed], &design_lowpass(factor), factor).len();
            let tau_max = (analysis_rate(sample_rate, factor) / MIN_FREQ_HZ).ceil() as usize;
            assert!(decimated_len >= 2 * tau_max, "{sample_rate} Hz: {decimated_len} < {}", 2 * tau_max);
            // And the window stays short enough to be a ~30 ms frame.
            let window_ms = needed as f32 * 1000.0 / sample_rate as f32;
            assert!(window_ms < 32.0, "{sample_rate} Hz: window is {window_ms} ms");
        }
    }

    /// A window shorter than the detector would like -- but longer than the
    /// "too short" bail-out -- used to index past its own end in the
    /// difference function. It must degrade, never panic.
    #[test]
    fn windows_of_any_length_never_panic() {
        for &sample_rate in &[22_050u32, 48_000] {
            let full = synth_sine(220.0, sample_rate, PitchDetector::required_samples(sample_rate) + 8);
            let mut detector = PitchDetector::new();
            for len in (0..full.len()).step_by(7) {
                let _ = detector.analyze(&full[..len], sample_rate);
            }
        }
    }

    #[test]
    fn reported_level_tracks_signal_amplitude() {
        let sample_rate = 48_000;
        let n = PitchDetector::required_samples(sample_rate) + 64;
        let full_scale = synth_sine(220.0, sample_rate, n);

        // A sine of peak amplitude a has RMS a/sqrt(2). The window isn't a whole
        // number of periods, so allow 1% rather than an exact match.
        for &amplitude in &[1.0f32, 0.5, 0.25, 0.05] {
            let mut detector = PitchDetector::new();
            let scaled = full_scale.iter().map(|s| s * amplitude).collect::<Vec<_>>();
            let rms = detector.analyze(&scaled, sample_rate).rms;
            let expected = amplitude / 2.0f32.sqrt();
            assert!(
                (rms - expected).abs() / expected < 0.01,
                "amplitude {amplitude}: expected rms ~{expected}, got {rms}"
            );
        }
    }

    #[test]
    fn an_empty_window_reports_zero_level_and_no_pitch() {
        let mut detector = PitchDetector::new();
        let result = detector.analyze(&[], 48_000);
        assert_eq!(result.rms, 0.0);
        assert!(result.pitch.is_none());
    }

    /// A window too short for YIN bails out before the difference function, but
    /// it is still audio and still has a level.
    #[test]
    fn a_too_short_window_reports_its_level_and_no_pitch() {
        let mut detector = PitchDetector::new();
        let loud_but_short = [1.0f32, -1.0, 1.0, -1.0, 1.0, -1.0];
        let result = detector.analyze(&loud_but_short, 48_000);
        assert!(result.pitch.is_none(), "six samples cannot produce a pitch at 48kHz");
        assert!((result.rms - 1.0).abs() < 1e-6, "expected full-scale rms, got {}", result.rms);
    }
}
