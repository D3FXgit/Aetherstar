//! Live microphone monitoring -- the "karaoke effect": singers hear themselves
//! through the speakers. Lives here because only this crate holds the capture
//! stream (the app has no getUserMedia); the tap is a second consumer of the
//! input callback's slice and never changes the pitch path.
//!
//! Realtime: the input callback ([`InputFanout::on_input`]) and output callback
//! ([`MonitorReader::fill`]) never allocate or lock; one SPSC `rtrb` ring per
//! capture sits between them and control values cross as relaxed atomics.
//!
//! Feedback mitigation (no cancellation, deliberately): [`MONITOR_MAX_GAIN`]
//! keeps gain below unity, [`MonitorProcessor`]'s runaway guard mutes a mic
//! pinned near full scale, and its gate only passes audio while someone sings.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer};

use crate::worker::{now_epoch_ms, push_whole, CaptureMark};

/// The hard ceiling on monitor gain, as a linear multiplier on the captured
/// signal. See the feedback note above: the slider's 100% is this, not unity.
pub const MONITOR_MAX_GAIN: f32 = 0.6;

/// Frames the monitor output stream asks for per callback. 256 frames is
/// 5.3ms at 48kHz -- small enough that the output leg contributes little to
/// round-trip latency, large enough that a normal desktop scheduler makes the
/// deadline. Falls back to the device default if the device won't take it.
pub const MONITOR_OUTPUT_FRAMES: u32 = 256;

/// Ring capacity, in samples. ~85ms at 48kHz: far more than the target fill
/// ever needs, so a scheduling hiccup on either side costs a late sample
/// rather than a lost one, and small enough that a runaway fill can't hide
/// tens of milliseconds of latency (the reader trims it anyway -- see
/// [`MonitorReader::fill`]).
pub const MONITOR_RING_CAPACITY: usize = 4096;

/// Floor on the ring's steady-state fill, in frames. The reader will not start
/// (or restart after an underrun) until it holds at least this much, so the
/// first thing anyone hears is continuous rather than a stutter.
const MIN_TARGET_FILL_FRAMES: u32 = 64;

/// How far above the target fill the ring is allowed to drift before the
/// reader discards the excess. Latency *is* fill, so an unbounded fill is
/// unbounded latency; this caps it at target + one of these.
const OVERRUN_SLACK_FRAMES: u32 = 256;

/// Maximum fractional speed-up/slow-down the drift controller may apply to the
/// read rate, as a ratio. 0.5% is inaudible on a voice (about 8 cents) and is
/// an order of magnitude more than the drift between two crystal clocks.
const MAX_DRIFT_CORRECTION: f32 = 0.005;

/// How hard the drift controller pulls toward the target fill. Deliberately
/// tiny: this is a slow integrator, not a servo, and overshoot here is audible
/// as pitch wobble.
const DRIFT_GAIN: f32 = 0.05;

/// Maps the 0..1 level a user sets on the slider to a linear gain.
///
/// Square law rather than linear: a linear amplitude slider spends most of its
/// travel in a range that all sounds equally loud, so a level control has to
/// be roughly logarithmic to feel even. Squaring is the cheap standard taper
/// for exactly this and, unlike a dB map, gives exact silence at 0.
///
/// Out-of-range levels clamp rather than extrapolate -- a persisted level from
/// a hand-edited settings file must not be able to exceed [`MONITOR_MAX_GAIN`].
pub fn monitor_gain_for_level(level: f32) -> f32 {
    if !level.is_finite() {
        return 0.0;
    }
    let clamped = level.clamp(0.0, 1.0);
    MONITOR_MAX_GAIN * clamped * clamped
}

/// The monitor's on/off state and level, shared between the control thread
/// that writes them (a napi call from the main process) and the audio threads
/// that read them.
///
/// Atomics, not a `Mutex`: the output callback reads the gain once per buffer
/// and the input callback reads `enabled` once per buffer, and neither may
/// block. `Relaxed` is the right ordering because there is nothing to
/// synchronize *with* -- each value stands alone, and a change landing one
/// buffer later than it could have is imperceptible.
pub struct MonitorSettings {
    enabled: AtomicBool,
    /// `f32` bits. There is no `AtomicF32`, and a `to_bits`/`from_bits` pair
    /// round-trips exactly for every non-NaN value we ever store.
    gain_bits: AtomicU32,
}

impl MonitorSettings {
    pub fn new() -> Self {
        Self { enabled: AtomicBool::new(false), gain_bits: AtomicU32::new(0f32.to_bits()) }
    }

    /// Off by default and silent by default: a karaoke app that amplifies the
    /// room on first run without being asked is a bad first run.
    pub fn set(&self, enabled: bool, level: f32) {
        self.gain_bits.store(monitor_gain_for_level(level).to_bits(), Ordering::Relaxed);
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn gain(&self) -> f32 {
        f32::from_bits(self.gain_bits.load(Ordering::Relaxed))
    }
}

impl Default for MonitorSettings {
    fn default() -> Self {
        Self::new()
    }
}

/// Averages the channels named by `mask` out of one interleaved frame.
///
/// A device may carry eight microphones on eight channels, and the app may be
/// capturing any subset of them; monitoring covers exactly the channels that
/// are subscribed, because a channel nobody is scoring is a channel nobody is
/// singing into. Averaging rather than summing keeps a four-mic interface from
/// being four times louder than a one-mic one.
///
/// Bit 31 down: channel `i` is monitored when bit `i` is set. Channels past 31
/// are not representable and are simply not monitored -- the rig tops out at
/// eight mics, so this is unreachable in practice and silently dropping one
/// channel beats a panic on an audio thread.
pub fn downmix_selected_channels(frame: &[f32], mask: u32) -> f32 {
    let mut sum = 0.0f32;
    let mut count = 0u32;
    for (index, &sample) in frame.iter().enumerate() {
        if index < 32 && mask & (1 << index) != 0 {
            sum += sample;
            count += 1;
        }
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f32
    }
}

/// Nudges the resampling step so the ring converges on `target_fill`.
///
/// Input and output can be two different pieces of hardware with two different
/// crystals. Even at a few parts per million they drift, and a fixed read rate
/// means the ring slowly fills (latency creeps up) or slowly empties (periodic
/// dropouts). Reading fractionally faster when the ring is over-full and
/// slower when it is under-full holds the fill -- and therefore the latency --
/// where it was designed to be, and re-centres it after any glitch.
///
/// Correction is clamped to [`MAX_DRIFT_CORRECTION`] in both directions, so a
/// nonsense fill reading can never make the monitor play at the wrong speed.
pub fn drift_adjusted_step(base_step: f32, fill_frames: f32, target_fill_frames: f32) -> f32 {
    if target_fill_frames <= 0.0 || !base_step.is_finite() {
        return base_step;
    }
    let error = (fill_frames - target_fill_frames) / target_fill_frames;
    let correction = (error * DRIFT_GAIN).clamp(-MAX_DRIFT_CORRECTION, MAX_DRIFT_CORRECTION);
    base_step * (1.0 + correction)
}

fn one_pole_coeff(time_constant_secs: f32, sample_rate: f32) -> f32 {
    if time_constant_secs <= 0.0 || sample_rate <= 0.0 {
        return 1.0;
    }
    1.0 - (-1.0 / (time_constant_secs * sample_rate)).exp()
}

// --- MonitorProcessor tuning -------------------------------------------------

/// Peak-envelope attack. Fast, so a howl is detected as it starts rather than
/// after it is loud.
const ENVELOPE_ATTACK_SECS: f32 = 0.001;
/// Peak-envelope release. Slow enough that the envelope reads the *shape* of a
/// sung phrase rather than each individual glottal pulse.
const ENVELOPE_RELEASE_SECS: f32 = 0.120;

/// Gate opens above this input peak. Chosen well under any singing voice and
/// well over a quiet room: raising it would clip the ends of soft phrases,
/// which is the failure mode a gate has to avoid.
const GATE_OPEN_LEVEL: f32 = 0.020;
/// Gate closes below this. The gap from [`GATE_OPEN_LEVEL`] is the hysteresis
/// that stops a signal sitting on the threshold from chattering.
const GATE_CLOSE_LEVEL: f32 = 0.008;
/// Once open, the gate stays open for at least this long after the level drops
/// -- so a breath between two lines does not cut the singer off mid-phrase.
const GATE_HOLD_SECS: f32 = 0.250;
/// Gate open ramp. Short enough not to swallow a consonant.
const GATE_ATTACK_SECS: f32 = 0.005;
/// Gate close ramp. Long, so closing sounds like a fade rather than a click.
const GATE_RELEASE_SECS: f32 = 0.150;

/// Input peak envelope above which the runaway guard starts counting. Near
/// full scale: this is a saturating input, not a loud one.
const GUARD_TRIGGER_LEVEL: f32 = 0.92;
/// ...and it has to stay there this long. A shouted syllable peaks; feedback
/// sustains. Requiring sustain is what separates the two.
const GUARD_TRIGGER_SECS: f32 = 0.250;
/// Once muted, the input has to fall below this...
const GUARD_RELEASE_LEVEL: f32 = 0.250;
/// ...and stay below it this long before monitoring comes back. Long enough
/// that the guard cannot pump in and out of a howl it is only half killing.
const GUARD_RELEASE_SECS: f32 = 1.000;
/// Guard mute ramp. Fast -- this is an emergency -- but not a discontinuity.
const GUARD_MUTE_SECS: f32 = 0.020;
/// Guard un-mute ramp. Slow, so recovery does not itself restart the howl.
const GUARD_RECOVER_SECS: f32 = 0.200;

/// The per-sample chain applied to monitored audio: envelope follower ->
/// runaway guard -> gate -> level -> clamp.
///
/// A plain struct with no allocation and no shared state, so it can run inside
/// the output callback and still be unit-tested as ordinary Rust. Every
/// coefficient is derived from the sample rate at construction, so nothing in
/// [`MonitorProcessor::process`] computes a transcendental.
pub struct MonitorProcessor {
    envelope: f32,
    envelope_attack: f32,
    envelope_release: f32,

    gate_open: bool,
    gate_gain: f32,
    gate_hold_remaining: u32,
    gate_hold_samples: u32,
    gate_attack: f32,
    gate_release: f32,

    guard_muted: bool,
    guard_gain: f32,
    guard_hot_samples: u32,
    guard_trigger_samples: u32,
    guard_cool_samples: u32,
    guard_release_samples: u32,
    guard_mute_coeff: f32,
    guard_recover_coeff: f32,
}

impl MonitorProcessor {
    pub fn new(sample_rate: u32) -> Self {
        let rate = sample_rate.max(1) as f32;
        Self {
            envelope: 0.0,
            envelope_attack: one_pole_coeff(ENVELOPE_ATTACK_SECS, rate),
            envelope_release: one_pole_coeff(ENVELOPE_RELEASE_SECS, rate),

            gate_open: false,
            gate_gain: 0.0,
            gate_hold_remaining: 0,
            gate_hold_samples: (GATE_HOLD_SECS * rate) as u32,
            gate_attack: one_pole_coeff(GATE_ATTACK_SECS, rate),
            gate_release: one_pole_coeff(GATE_RELEASE_SECS, rate),

            guard_muted: false,
            guard_gain: 1.0,
            guard_hot_samples: 0,
            guard_trigger_samples: (GUARD_TRIGGER_SECS * rate) as u32,
            guard_cool_samples: 0,
            guard_release_samples: (GUARD_RELEASE_SECS * rate) as u32,
            guard_mute_coeff: one_pole_coeff(GUARD_MUTE_SECS, rate),
            guard_recover_coeff: one_pole_coeff(GUARD_RECOVER_SECS, rate),
        }
    }

    /// True while the runaway guard is holding monitoring down. Exposed so the
    /// guard's behaviour is directly assertable; nothing in the audio path
    /// branches on it.
    #[allow(dead_code)] // exercised by this module's tests, not by the audio path
    pub fn is_guard_muted(&self) -> bool {
        self.guard_muted
    }

    /// One sample in, one monitored sample out. `gain` is re-read per sample
    /// by the caller from [`MonitorSettings`], so moving the slider takes
    /// effect on the next buffer rather than after the ring drains.
    pub fn process(&mut self, sample: f32, gain: f32) -> f32 {
        let magnitude = sample.abs();
        let coeff = if magnitude > self.envelope { self.envelope_attack } else { self.envelope_release };
        self.envelope += (magnitude - self.envelope) * coeff;

        // --- runaway guard ---
        if self.envelope >= GUARD_TRIGGER_LEVEL {
            self.guard_hot_samples = self.guard_hot_samples.saturating_add(1);
        } else {
            self.guard_hot_samples = 0;
        }
        if !self.guard_muted && self.guard_hot_samples >= self.guard_trigger_samples {
            self.guard_muted = true;
            self.guard_cool_samples = 0;
        }
        if self.guard_muted {
            if self.envelope <= GUARD_RELEASE_LEVEL {
                self.guard_cool_samples = self.guard_cool_samples.saturating_add(1);
            } else {
                self.guard_cool_samples = 0;
            }
            if self.guard_cool_samples >= self.guard_release_samples {
                self.guard_muted = false;
                self.guard_hot_samples = 0;
            }
        }
        let guard_target = if self.guard_muted { 0.0 } else { 1.0 };
        let guard_coeff = if self.guard_muted { self.guard_mute_coeff } else { self.guard_recover_coeff };
        self.guard_gain += (guard_target - self.guard_gain) * guard_coeff;

        // --- gate, with hysteresis and a hold ---
        if self.envelope >= GATE_OPEN_LEVEL {
            self.gate_open = true;
            self.gate_hold_remaining = self.gate_hold_samples;
        } else if self.gate_open && self.envelope < GATE_CLOSE_LEVEL {
            if self.gate_hold_remaining == 0 {
                self.gate_open = false;
            } else {
                self.gate_hold_remaining -= 1;
            }
        }
        let gate_target = if self.gate_open { 1.0 } else { 0.0 };
        let gate_coeff = if self.gate_open { self.gate_attack } else { self.gate_release };
        self.gate_gain += (gate_target - self.gate_gain) * gate_coeff;

        // Clamped, not wrapped: a monitored sample that leaves this function
        // above full scale would be wrapped into noise by the driver.
        (sample * gain * self.gate_gain * self.guard_gain).clamp(-1.0, 1.0)
    }
}

/// The producer half of one capture's monitor ring: what the input callback
/// writes into.
pub struct MonitorTap {
    producer: Producer<f32>,
}

impl MonitorTap {
    pub fn new(producer: Producer<f32>) -> Self {
        Self { producer }
    }

    /// Pushes one already-downmixed mono sample. A full ring means the output
    /// side has stalled; dropping the sample is the only option that does not
    /// block an audio thread, and the reader's own overrun trim means a full
    /// ring is already the abnormal case.
    pub fn push(&mut self, sample: f32) {
        let _ = self.producer.push(sample);
    }
}

/// The entire body of the `cpal` input callback: the pitch push that has
/// always been there, and the monitor tap beside it.
///
/// It exists as a struct rather than a closure so the invariant that actually
/// matters -- *the pitch ring receives exactly the same samples in exactly the
/// same order whether or not monitoring is on* -- is something a test can
/// assert directly instead of something a code review has to believe.
pub struct InputFanout {
    pitch_producer: Producer<f32>,
    monitor: MonitorTap,
    channel_count: usize,
    /// Which channels of this device currently have a pitch subscriber. Written
    /// by `startCapture`/`stopCapture` on the control thread, read here with a
    /// relaxed load -- never a lock.
    channel_mask: Arc<AtomicU32>,
    settings: Arc<MonitorSettings>,
    /// Frames per input callback, published for the reader's target-fill
    /// calculation. The input stream runs at whatever buffer size the device
    /// chose (deliberately left to the device), so the only way to know it is
    /// to observe it.
    observed_input_frames: Arc<AtomicU32>,
    /// Where each accepted callback's capture-time mark goes, so the consumer
    /// can stamp every pitch frame with when its audio was *captured* rather
    /// than when it happened to be analysed. `None` (tests, measurement
    /// harnesses) simply skips the marks.
    timing: Option<Producer<CaptureMark>>,
    /// Interleaved samples accepted into the pitch ring so far -- the sample
    /// index each mark refers to. Dropped callbacks are not counted, so the
    /// consumer's own count of what it popped always agrees with it.
    written_samples: u64,
}

impl InputFanout {
    pub fn new(
        pitch_producer: Producer<f32>,
        monitor: MonitorTap,
        channel_count: usize,
        channel_mask: Arc<AtomicU32>,
        settings: Arc<MonitorSettings>,
        observed_input_frames: Arc<AtomicU32>,
    ) -> Self {
        Self {
            pitch_producer,
            monitor,
            channel_count,
            channel_mask,
            settings,
            observed_input_frames,
            timing: None,
            written_samples: 0,
        }
    }

    /// Adds the capture-time mark channel (see [`CaptureMark`]).
    pub fn with_timing(mut self, timing: Producer<CaptureMark>) -> Self {
        self.timing = Some(timing);
        self
    }

    pub fn on_input(&mut self, data: &[f32]) {
        // Only read the clock when someone is listening for marks. Reading it
        // is a vDSO call -- no lock, no allocation -- so it is audio-safe.
        let now_ms = if self.timing.is_some() { now_epoch_ms() } else { 0.0 };
        self.on_input_at(data, now_ms);
    }

    /// [`InputFanout::on_input`] with the callback's wall-clock time supplied,
    /// so the mark it sends is testable.
    pub fn on_input_at(&mut self, data: &[f32], now_ms: f64) {
        // Pitch first, unconditionally, with the samples exactly as the driver
        // delivered them; nothing below can reach back and change what it
        // pushed. The whole callback goes in or none of it does: a ring that
        // fills mid-callback must never leave a partial frame behind, or every
        // later frame would be de-interleaved a channel out of place (see
        // `push_whole`). Never blocks, never allocates (audio-thread rules).
        if push_whole(&mut self.pitch_producer, data) {
            self.written_samples += data.len() as u64;
            if let Some(timing) = self.timing.as_mut() {
                // A full mark ring only costs timing precision until the
                // consumer drains it; the audio itself is already in.
                let _ = timing.push(CaptureMark { end_sample: self.written_samples, t_ms: now_ms });
            }
        }

        if !self.settings.is_enabled() {
            return;
        }

        let channels = self.channel_count.max(1);
        self.observed_input_frames.store((data.len() / channels) as u32, Ordering::Relaxed);

        let mask = self.channel_mask.load(Ordering::Relaxed);
        if mask == 0 {
            return;
        }
        for frame in data.chunks_exact(channels) {
            self.monitor.push(downmix_selected_channels(frame, mask));
        }
    }
}

/// The consumer half: reads the ring at a drift-corrected rate, runs the
/// monitor chain, and writes into the output device's buffer.
pub struct MonitorReader {
    consumer: Consumer<f32>,
    processor: MonitorProcessor,
    settings: Arc<MonitorSettings>,
    observed_input_frames: Arc<AtomicU32>,
    /// `input_rate / output_rate`. Exactly 1.0 whenever the output device
    /// accepted the input's rate, which is the normal case.
    base_step: f32,
    output_frames_per_callback: u32,
    phase: f32,
    prev: f32,
    next: f32,
    /// False until the ring holds a full target fill. Re-priming after an
    /// underrun is what turns a glitch into one gap instead of a continuous
    /// stutter at the ring's empty edge.
    primed: bool,
    /// How many times the ring has run dry. This is the number that decides
    /// whether [`MonitorReader::target_fill_frames`] is big enough, so it is
    /// counted rather than reasoned about -- see the `monitor_round_trip_latency`
    /// measurement, which reports it per second of real capture.
    underruns: Arc<AtomicU32>,
}

impl MonitorReader {
    pub fn new(
        consumer: Consumer<f32>,
        settings: Arc<MonitorSettings>,
        observed_input_frames: Arc<AtomicU32>,
        input_rate: u32,
        output_rate: u32,
        output_frames_per_callback: u32,
    ) -> Self {
        let base_step = if output_rate == 0 { 1.0 } else { input_rate as f32 / output_rate as f32 };
        Self {
            consumer,
            processor: MonitorProcessor::new(output_rate.max(1)),
            settings,
            observed_input_frames,
            base_step,
            output_frames_per_callback: output_frames_per_callback.max(1),
            phase: 1.0,
            prev: 0.0,
            next: 0.0,
            primed: false,
            underruns: Arc::new(AtomicU32::new(0)),
        }
    }

    /// The shared underrun counter, so the owner of the stream can read it
    /// without reaching into the audio callback that owns the reader.
    pub fn underrun_counter(&self) -> Arc<AtomicU32> {
        self.underruns.clone()
    }

    /// The ring fill the reader steers toward, in frames.
    ///
    /// Latency is fill, so this is the number that matters. It has to cover the
    /// worst phase alignment between the two callbacks: the input arrives in
    /// bursts of one input buffer, so in the worst case the reader must survive
    /// a whole input period on what is already in the ring. Anything less
    /// under-runs on hardware whose input and output clocks are not on the same
    /// IO cycle; anything more is latency paid for nothing.
    pub fn target_fill_frames(&self) -> u32 {
        self.observed_input_frames
            .load(Ordering::Relaxed)
            .max(self.output_frames_per_callback)
            .max(MIN_TARGET_FILL_FRAMES)
    }

    /// Fills one output buffer. `channels` is the output stream's channel
    /// count; the same mono sample goes to every one of them, because a
    /// microphone is mono and panning it would just make it quieter on one
    /// side of the room.
    ///
    /// Allocation-free and lock-free: one relaxed load for the gain, one
    /// relaxed load for the enable flag, one atomic read of the ring's fill,
    /// and then arithmetic.
    pub fn fill(&mut self, output: &mut [f32], channels: usize) {
        let channels = channels.max(1);
        if !self.settings.is_enabled() {
            self.silence(output);
            return;
        }

        let target = self.target_fill_frames();
        let available = self.consumer.slots() as u32;

        // Latency is the ring's fill, so an over-full ring is latency nobody
        // asked for -- discard back down to target rather than let it stand.
        if available > target + OVERRUN_SLACK_FRAMES {
            for _ in 0..(available - target) {
                if self.consumer.pop().is_err() {
                    break;
                }
            }
        }

        if !self.primed {
            if self.consumer.slots() < target as usize {
                self.silence(output);
                return;
            }
            self.primed = true;
            self.phase = 1.0;
            self.prev = 0.0;
            self.next = 0.0;
        }

        let step = drift_adjusted_step(self.base_step, self.consumer.slots() as f32, target as f32);
        let gain = self.settings.gain();

        for frame in output.chunks_mut(channels) {
            let Some(raw) = self.next_input_sample(step) else {
                // Under-run: the rest of this buffer is silence and the reader
                // re-primes. Better one clean gap than a torn edge repeated
                // every callback.
                if self.primed {
                    self.underruns.fetch_add(1, Ordering::Relaxed);
                }
                self.primed = false;
                for out in frame.iter_mut() {
                    *out = 0.0;
                }
                continue;
            };
            let monitored = self.processor.process(raw, gain);
            for out in frame.iter_mut() {
                *out = monitored;
            }
        }
    }

    fn silence(&mut self, output: &mut [f32]) {
        for out in output.iter_mut() {
            *out = 0.0;
        }
    }

    /// One linearly-interpolated sample from the ring, advancing by `step`.
    ///
    /// `step` is 1.0 ± the drift correction in the common case, so the `while`
    /// runs at most twice -- bounded work, no allocation. Linear interpolation
    /// rather than a windowed sinc: this is a voice monitor at a ratio within a
    /// fraction of a percent of unity, where the interpolation error is far
    /// below the noise floor of the microphone feeding it, and a real
    /// resampler could not run in an output callback without allocating.
    fn next_input_sample(&mut self, step: f32) -> Option<f32> {
        self.phase += step;
        while self.phase >= 1.0 {
            let sample = self.consumer.pop().ok()?;
            self.prev = self.next;
            self.next = sample;
            self.phase -= 1.0;
        }
        Some(self.prev + (self.next - self.prev) * self.phase)
    }
}

/// A live monitor output stream. Dropping it closes the output device.
pub struct MonitorStream {
    stream: cpal::Stream,
    /// What the reader is actually running at, for the latency arithmetic in
    /// the `monitor_round_trip_latency` measurement and for diagnostics.
    pub output_sample_rate: u32,
    pub output_frames_per_callback: u32,
    /// Live count of ring under-runs, shared with the reader inside the
    /// callback. Non-zero means the target fill is too small for this pair of
    /// devices.
    pub underruns: Arc<AtomicU32>,
}

impl MonitorStream {
    pub fn play(&self) -> Result<(), String> {
        self.stream.play().map_err(|e| e.to_string())
    }

    pub fn pause(&self) -> Result<(), String> {
        self.stream.pause().map_err(|e| e.to_string())
    }
}

/// Picks an output config on the default output device, preferring the
/// capture's own sample rate so the monitor path needs no rate conversion at
/// all (`base_step` lands on exactly 1.0), and asking for
/// [`MONITOR_OUTPUT_FRAMES`] where the device allows it.
fn choose_output_config(device: &cpal::Device, input_rate: u32) -> Result<cpal::SupportedStreamConfig, String> {
    let default_config = device.default_output_config().map_err(|e| e.to_string())?;

    let matched = device.supported_output_configs().ok().and_then(|configs| {
        configs
            .filter(|range| range.sample_format() == default_config.sample_format())
            .filter(|range| range.channels() > 0)
            .find_map(|range| range.try_with_sample_rate(input_rate))
    });

    Ok(matched.unwrap_or(default_config))
}

fn clamp_buffer_size(supported: &cpal::SupportedBufferSize) -> (cpal::BufferSize, u32) {
    match supported {
        cpal::SupportedBufferSize::Range { min, max } => {
            let frames = MONITOR_OUTPUT_FRAMES.clamp(*min, *max);
            (cpal::BufferSize::Fixed(frames), frames)
        }
        // The platform won't say, so don't guess: asking for a size a device
        // cannot honour fails the whole stream, and a monitor that refuses to
        // open is worse than one a few milliseconds later than ideal.
        cpal::SupportedBufferSize::Unknown => (cpal::BufferSize::Default, MONITOR_OUTPUT_FRAMES),
    }
}

/// Opens the monitor output stream for one capture, reading from `consumer`.
///
/// Returns `Ok(None)` when the machine has no default output device, the same
/// way `capture.rs` returns `Ok(None)` for a missing input device -- a
/// headless CI box is not an error condition, it just cannot monitor.
///
/// The stream is returned **stopped**; the caller decides when to `play()` it.
pub fn start_monitor_output(
    consumer: Consumer<f32>,
    settings: Arc<MonitorSettings>,
    observed_input_frames: Arc<AtomicU32>,
    input_rate: u32,
) -> Result<Option<MonitorStream>, String> {
    let host = cpal::default_host();
    let Some(device) = host.default_output_device() else {
        return Ok(None);
    };

    let supported = choose_output_config(&device, input_rate)?;
    let sample_format = supported.sample_format();
    let (buffer_size, frames_per_callback) = clamp_buffer_size(supported.buffer_size());
    let mut config: cpal::StreamConfig = supported.into();
    config.buffer_size = buffer_size;

    let output_rate = config.sample_rate;
    let channels = config.channels.max(1) as usize;
    let mut reader =
        MonitorReader::new(consumer, settings, observed_input_frames, input_rate, output_rate, frames_per_callback);
    let underruns = reader.underrun_counter();

    let err_fn = |err: cpal::Error| eprintln!("aetherstar-native: monitor output stream error: {err}");

    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_output_stream(
            config,
            move |data: &mut [f32], _: &cpal::OutputCallbackInfo| reader.fill(data, channels),
            err_fn,
            None,
        ),
        other => return Err(format!("unsupported monitor output sample format: {other:?}")),
    }
    .map_err(|e| e.to_string())?;

    Ok(Some(MonitorStream {
        stream,
        output_sample_rate: output_rate,
        output_frames_per_callback: frames_per_callback,
        underruns,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worker::{create_mark_ring, create_ring_buffer};

    const RATE: u32 = 48_000;

    fn drain(consumer: &mut Consumer<f32>) -> Vec<f32> {
        let mut out = Vec::new();
        while let Ok(sample) = consumer.pop() {
            out.push(sample);
        }
        out
    }

    /// Feeds `seconds` of a constant-amplitude signal through the processor and
    /// returns the final output magnitude, so the slow envelope/gate ramps have
    /// somewhere to settle.
    fn settle(processor: &mut MonitorProcessor, amplitude: f32, gain: f32, seconds: f32) -> f32 {
        let samples = (RATE as f32 * seconds) as usize;
        let mut last = 0.0;
        for i in 0..samples {
            // A 220Hz sine, so the peak envelope has a real waveform to follow
            // rather than DC (which would make the gate trivially easy).
            let phase = i as f32 * std::f32::consts::TAU * 220.0 / RATE as f32;
            last = processor.process(amplitude * phase.sin(), gain);
        }
        // Sample the peak over one final cycle rather than one instant, since
        // the last sample of a sine could land anywhere in it.
        let mut peak: f32 = last.abs();
        for i in 0..(RATE / 220) as usize {
            let phase = (samples + i) as f32 * std::f32::consts::TAU * 220.0 / RATE as f32;
            peak = peak.max(processor.process(amplitude * phase.sin(), gain).abs());
        }
        peak
    }

    // --- level mapping ---

    #[test]
    fn monitor_gain_is_silent_at_zero_and_capped_at_the_maximum() {
        assert_eq!(monitor_gain_for_level(0.0), 0.0);
        assert_eq!(monitor_gain_for_level(1.0), MONITOR_MAX_GAIN);
    }

    /// The whole feedback story rests on this: 100% on the slider is still
    /// below unity, so the electronic half of the loop can never on its own
    /// carry a loop gain of 1.
    #[test]
    fn monitor_gain_never_reaches_unity_even_for_an_out_of_range_level() {
        const { assert!(MONITOR_MAX_GAIN < 1.0) };
        for level in [1.0f32, 2.0, 50.0, f32::INFINITY] {
            assert!(monitor_gain_for_level(level) <= MONITOR_MAX_GAIN, "level {level} escaped the cap");
        }
        assert_eq!(monitor_gain_for_level(-1.0), 0.0);
        assert_eq!(monitor_gain_for_level(f32::NAN), 0.0);
    }

    #[test]
    fn monitor_gain_taper_is_finer_at_the_quiet_end_than_a_linear_slider() {
        // Square law: half travel is a quarter of the gain, not half of it.
        let half = monitor_gain_for_level(0.5);
        assert!((half - MONITOR_MAX_GAIN * 0.25).abs() < 1e-6);
        // Monotonic, so the slider never moves the wrong way.
        let mut previous = -1.0;
        for step in 0..=20 {
            let gain = monitor_gain_for_level(step as f32 / 20.0);
            assert!(gain > previous, "gain must increase with level");
            previous = gain;
        }
    }

    // --- settings ---

    #[test]
    fn monitor_settings_start_off_and_silent() {
        let settings = MonitorSettings::new();
        assert!(!settings.is_enabled());
        assert_eq!(settings.gain(), 0.0);
    }

    #[test]
    fn monitor_settings_round_trip_the_level_through_the_taper() {
        let settings = MonitorSettings::new();
        settings.set(true, 0.5);
        assert!(settings.is_enabled());
        assert!((settings.gain() - monitor_gain_for_level(0.5)).abs() < 1e-7);
    }

    // --- channel selection ---

    #[test]
    fn downmix_averages_only_the_subscribed_channels() {
        let frame = [1.0, 3.0, 5.0, 7.0];
        assert_eq!(downmix_selected_channels(&frame, 0b0001), 1.0);
        assert_eq!(downmix_selected_channels(&frame, 0b0100), 5.0);
        assert_eq!(downmix_selected_channels(&frame, 0b0101), 3.0); // (1 + 5) / 2
    }

    /// Averaging, not summing: an interface with four subscribed mics must not
    /// monitor four times louder than a single-mic device.
    #[test]
    fn downmix_of_every_channel_cannot_exceed_the_loudest_channel() {
        let frame = [0.9, 0.9, 0.9, 0.9];
        assert!(downmix_selected_channels(&frame, 0b1111) <= 0.9);
    }

    #[test]
    fn downmix_with_no_subscribed_channels_is_silence() {
        assert_eq!(downmix_selected_channels(&[0.5, 0.5], 0), 0.0);
        assert_eq!(downmix_selected_channels(&[], 0b1111), 0.0);
    }

    // --- the invariant that matters: pitch detection is untouched ---

    /// The regression this pins: monitoring must be a *tap*, not a filter. If
    /// anyone ever moves the monitor work above the pitch push, reorders it,
    /// scales the samples in place, or makes the pitch push conditional on the
    /// monitor state, the pitch ring's contents change and scoring silently
    /// drifts. Comparing the two rings sample for sample is the only check
    /// that cannot be satisfied by a plausible-looking refactor.
    #[test]
    fn input_fanout_pushes_identical_pitch_samples_whether_or_not_monitoring_is_on() {
        let input: Vec<f32> = (0..4096).map(|i| ((i as f32) * 0.01).sin()).collect();

        fn run(enabled: bool, input: &[f32]) -> Vec<f32> {
            let (pitch_producer, mut pitch_consumer) = create_ring_buffer(1 << 16);
            let (monitor_producer, _monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
            let settings = Arc::new(MonitorSettings::new());
            settings.set(enabled, 1.0);
            let mut fanout = InputFanout::new(
                pitch_producer,
                MonitorTap::new(monitor_producer),
                2,
                Arc::new(AtomicU32::new(0b11)),
                settings,
                Arc::new(AtomicU32::new(0)),
            );
            for chunk in input.chunks(512) {
                fanout.on_input(chunk);
            }
            drain(&mut pitch_consumer)
        }

        let with_monitoring = run(true, &input);
        let without_monitoring = run(false, &input);
        assert_eq!(with_monitoring, without_monitoring);
        assert_eq!(with_monitoring, input, "the pitch ring must receive the raw input verbatim");
    }

    /// Same invariant from the other side: the callback must not mutate the
    /// buffer the driver handed it.
    #[test]
    fn input_fanout_does_not_mutate_the_buffer_it_is_given() {
        let input: Vec<f32> = (0..1024).map(|i| (i as f32) * 0.0009).collect();
        let snapshot = input.clone();

        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, _monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        settings.set(true, 1.0);
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            1,
            Arc::new(AtomicU32::new(1)),
            settings,
            Arc::new(AtomicU32::new(0)),
        );
        fanout.on_input(&input);

        assert_eq!(input, snapshot);
    }

    #[test]
    fn input_fanout_taps_nothing_while_monitoring_is_off() {
        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, mut monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            1,
            Arc::new(AtomicU32::new(1)),
            settings.clone(),
            Arc::new(AtomicU32::new(0)),
        );

        fanout.on_input(&[0.5; 256]);
        assert_eq!(drain(&mut monitor_consumer).len(), 0, "an off monitor must not even fill its ring");

        settings.set(true, 1.0);
        fanout.on_input(&[0.5; 256]);
        assert_eq!(drain(&mut monitor_consumer).len(), 256);
    }

    #[test]
    fn input_fanout_downmixes_multi_channel_input_to_one_mono_sample_per_frame() {
        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, mut monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        settings.set(true, 1.0);
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            4,
            // Only channel 2 is subscribed, so only channel 2 is monitored.
            Arc::new(AtomicU32::new(0b0100)),
            settings,
            Arc::new(AtomicU32::new(0)),
        );

        fanout.on_input(&[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);

        let monitored = drain(&mut monitor_consumer);
        assert_eq!(monitored.len(), 2, "eight interleaved samples on four channels is two frames");
        assert!((monitored[0] - 0.3).abs() < 1e-6);
        assert!((monitored[1] - 0.7).abs() < 1e-6);
    }

    #[test]
    fn input_fanout_publishes_the_observed_input_buffer_size() {
        let observed = Arc::new(AtomicU32::new(0));
        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, _monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        settings.set(true, 1.0);
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            2,
            Arc::new(AtomicU32::new(0b11)),
            settings,
            observed.clone(),
        );

        fanout.on_input(&[0.0; 1024]); // 1024 interleaved samples on 2 channels
        assert_eq!(observed.load(Ordering::Relaxed), 512);
    }

    // --- capture timing and whole-callback pushes ---

    #[test]
    fn input_fanout_marks_each_accepted_callback_with_its_time_and_sample_count() {
        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, _monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let (mark_producer, mut mark_consumer) = create_mark_ring(16);
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            2,
            Arc::new(AtomicU32::new(0b11)),
            Arc::new(MonitorSettings::new()),
            Arc::new(AtomicU32::new(0)),
        )
        .with_timing(mark_producer);

        fanout.on_input_at(&[0.0; 512], 1_000.0);
        fanout.on_input_at(&[0.0; 256], 1_005.0);

        assert_eq!(mark_consumer.pop().unwrap(), CaptureMark { end_sample: 512, t_ms: 1_000.0 });
        assert_eq!(mark_consumer.pop().unwrap(), CaptureMark { end_sample: 768, t_ms: 1_005.0 });
        assert!(mark_consumer.pop().is_err());
    }

    /// A callback the full ring could not take is dropped whole -- no partial
    /// frame in the ring, no mark, and the sample count the marks carry stays
    /// in step with what the consumer will actually pop.
    #[test]
    fn input_fanout_drops_a_callback_whole_when_the_pitch_ring_is_full() {
        let (pitch_producer, mut pitch_consumer) = create_ring_buffer(10);
        let (monitor_producer, _monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let (mark_producer, mut mark_consumer) = create_mark_ring(16);
        let mut fanout = InputFanout::new(
            pitch_producer,
            MonitorTap::new(monitor_producer),
            2,
            Arc::new(AtomicU32::new(0b11)),
            Arc::new(MonitorSettings::new()),
            Arc::new(AtomicU32::new(0)),
        )
        .with_timing(mark_producer);

        fanout.on_input_at(&[1.0, -1.0, 1.0, -1.0, 1.0, -1.0], 0.0); // 6 of 10 slots
        fanout.on_input_at(&[2.0, -2.0, 2.0, -2.0, 2.0, -2.0], 1.0); // does not fit: dropped whole
        fanout.on_input_at(&[3.0, -3.0], 2.0); // fits

        assert_eq!(drain(&mut pitch_consumer), vec![1.0, -1.0, 1.0, -1.0, 1.0, -1.0, 3.0, -3.0]);
        assert_eq!(mark_consumer.pop().unwrap().end_sample, 6);
        assert_eq!(mark_consumer.pop().unwrap(), CaptureMark { end_sample: 8, t_ms: 2.0 });
        assert!(mark_consumer.pop().is_err());
    }

    // --- drift control ---

    #[test]
    fn drift_step_is_unchanged_when_the_ring_sits_on_target() {
        assert_eq!(drift_adjusted_step(1.0, 256.0, 256.0), 1.0);
    }

    #[test]
    fn drift_step_speeds_up_on_an_over_full_ring_and_slows_down_on_an_empty_one() {
        assert!(drift_adjusted_step(1.0, 512.0, 256.0) > 1.0, "an over-full ring is latency: read faster");
        assert!(drift_adjusted_step(1.0, 64.0, 256.0) < 1.0, "a draining ring is about to under-run: read slower");
    }

    /// The correction is a latency trim, not a pitch control -- an absurd fill
    /// reading must never make the monitor play the singer back sharp.
    #[test]
    fn drift_step_correction_is_clamped_in_both_directions() {
        let fast = drift_adjusted_step(1.0, 100_000.0, 256.0);
        let slow = drift_adjusted_step(1.0, 0.0, 256.0);
        assert!(fast <= 1.0 + MAX_DRIFT_CORRECTION + 1e-6);
        assert!(slow >= 1.0 - MAX_DRIFT_CORRECTION - 1e-6);
    }

    #[test]
    fn drift_step_is_a_noop_for_a_nonsense_target() {
        assert_eq!(drift_adjusted_step(1.0, 10.0, 0.0), 1.0);
    }

    // --- the monitor chain ---

    #[test]
    fn processor_passes_a_sung_signal_through_at_the_requested_gain() {
        let mut processor = MonitorProcessor::new(RATE);
        let peak = settle(&mut processor, 0.5, 0.5, 0.5);
        assert!((peak - 0.25).abs() < 0.02, "expected ~0.25, got {peak}");
    }

    #[test]
    fn processor_is_silent_at_zero_gain() {
        let mut processor = MonitorProcessor::new(RATE);
        assert_eq!(settle(&mut processor, 0.8, 0.0, 0.5), 0.0);
    }

    /// Quiet room in, silence out: monitoring a mic nobody is singing into just
    /// re-amplifies the song's own bleed and room noise, which is both the
    /// ugliest thing this feature can do and the condition feedback builds in.
    #[test]
    fn processor_gate_keeps_a_quiet_room_out_of_the_speakers() {
        let mut processor = MonitorProcessor::new(RATE);
        let peak = settle(&mut processor, 0.004, 0.5, 1.0);
        assert!(peak < 1e-4, "a quiet room should be gated to silence, got {peak}");
    }

    #[test]
    fn processor_gate_opens_again_once_someone_sings() {
        let mut processor = MonitorProcessor::new(RATE);
        assert!(settle(&mut processor, 0.004, 0.5, 1.0) < 1e-4);
        let peak = settle(&mut processor, 0.6, 0.5, 0.5);
        assert!(peak > 0.25, "the gate must reopen for a real voice, got {peak}");
    }

    /// A breath between two lines is not the end of the phrase. Without the
    /// hold, the gate would close in the gap and chop the singer up.
    #[test]
    fn processor_gate_holds_through_a_short_gap_between_phrases() {
        let mut processor = MonitorProcessor::new(RATE);
        settle(&mut processor, 0.6, 0.5, 0.5);
        // 100ms of near-silence, well inside GATE_HOLD_SECS.
        let peak = settle(&mut processor, 0.003, 0.5, 0.100);
        // The envelope's own release keeps this from being exactly 0.5 * 0.003,
        // but the gate must still be open -- i.e. some signal is getting out.
        assert!(peak > 0.0, "the gate must not slam shut inside its hold window");
        // ...and it still reopens instantly for the next line.
        assert!(settle(&mut processor, 0.6, 0.5, 0.05) > 0.2);
    }

    /// The runaway guard. A mic pinned at full scale for a quarter of a second
    /// is howling (or has been dropped on a table); monitoring gets out of the
    /// way rather than feeding it.
    #[test]
    fn processor_runaway_guard_mutes_a_pinned_input() {
        let mut processor = MonitorProcessor::new(RATE);
        let peak = settle(&mut processor, 1.0, 0.5, 0.5);
        assert!(processor.is_guard_muted(), "a sustained full-scale input must trip the guard");
        assert!(peak < 0.01, "monitoring must be silent while the guard is engaged, got {peak}");
    }

    /// ...and it lets go on its own. A guard that latched forever would need a
    /// restart to undo, which nobody at a party is going to do.
    #[test]
    fn processor_runaway_guard_releases_once_the_input_calms_down() {
        let mut processor = MonitorProcessor::new(RATE);
        settle(&mut processor, 1.0, 0.5, 0.5);
        assert!(processor.is_guard_muted());

        settle(&mut processor, 0.1, 0.5, 1.5);
        assert!(!processor.is_guard_muted(), "the guard must release itself once the input calms");

        let peak = settle(&mut processor, 0.5, 0.5, 0.5);
        assert!(peak > 0.2, "monitoring must come back after the guard releases, got {peak}");
    }

    /// A loud singer is not feedback. A shouted note peaks near full scale for
    /// a few tens of milliseconds; requiring sustained saturation is exactly
    /// what keeps the guard off them.
    #[test]
    fn processor_runaway_guard_ignores_a_brief_shout() {
        let mut processor = MonitorProcessor::new(RATE);
        settle(&mut processor, 0.4, 0.5, 0.3);
        settle(&mut processor, 1.0, 0.5, 0.050);
        assert!(!processor.is_guard_muted(), "a 50ms peak is singing, not a howl");
    }

    #[test]
    fn processor_output_never_leaves_full_scale() {
        let mut processor = MonitorProcessor::new(RATE);
        for i in 0..RATE {
            let phase = i as f32 * std::f32::consts::TAU * 220.0 / RATE as f32;
            // Deliberately over-driven input and an over-range gain.
            let out = processor.process(4.0 * phase.sin(), 10.0);
            assert!((-1.0..=1.0).contains(&out), "sample {i} left full scale: {out}");
        }
    }

    // --- the reader ---

    fn reader_with(input_rate: u32, output_rate: u32, frames: u32) -> (Producer<f32>, MonitorReader, Arc<MonitorSettings>) {
        let (producer, consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        settings.set(true, 1.0);
        let observed = Arc::new(AtomicU32::new(frames));
        let reader = MonitorReader::new(consumer, settings.clone(), observed, input_rate, output_rate, frames);
        (producer, reader, settings)
    }

    #[test]
    fn reader_writes_silence_while_monitoring_is_off() {
        let (mut producer, mut reader, settings) = reader_with(RATE, RATE, 64);
        for _ in 0..1024 {
            let _ = producer.push(0.9);
        }
        settings.set(false, 1.0);

        let mut output = [1.0f32; 128];
        reader.fill(&mut output, 1);
        assert!(output.iter().all(|&s| s == 0.0));
    }

    /// A cold ring must not be played out sample by sample as it fills -- that
    /// is a stutter. The reader stays silent until it holds a full target fill.
    #[test]
    fn reader_stays_silent_until_the_ring_holds_a_full_target_fill() {
        let (mut producer, mut reader, _settings) = reader_with(RATE, RATE, 64);
        for _ in 0..10 {
            let _ = producer.push(0.9);
        }

        let mut output = [1.0f32; 128];
        reader.fill(&mut output, 1);
        assert!(output.iter().all(|&s| s == 0.0), "an under-filled ring must prime, not stutter");
    }

    #[test]
    fn reader_plays_a_primed_ring_through_the_monitor_chain() {
        let (mut producer, mut reader, _settings) = reader_with(RATE, RATE, 64);
        // Loud enough and long enough to open the gate before we measure.
        for i in 0..3000 {
            let phase = i as f32 * std::f32::consts::TAU * 220.0 / RATE as f32;
            let _ = producer.push(0.8 * phase.sin());
        }

        let mut peak = 0.0f32;
        for _ in 0..8 {
            let mut output = [0.0f32; 128];
            reader.fill(&mut output, 1);
            for sample in output {
                peak = peak.max(sample.abs());
            }
        }
        assert!(peak > 0.05, "a primed ring of real signal must reach the speakers, got {peak}");
    }

    /// Latency *is* fill. A ring left to grow -- a slow output clock, a
    /// leftover backlog from the last time monitoring was on -- would put the
    /// singer further and further behind themselves, which is the one failure
    /// mode that makes this feature worse than not having it.
    #[test]
    fn reader_trims_an_over_full_ring_back_toward_the_target() {
        let (mut producer, mut reader, _settings) = reader_with(RATE, RATE, 64);
        for _ in 0..3000 {
            let _ = producer.push(0.1);
        }

        let mut output = [0.0f32; 128];
        reader.fill(&mut output, 1);

        let target = reader.target_fill_frames();
        assert!(
            reader.consumer.slots() <= (target + OVERRUN_SLACK_FRAMES) as usize,
            "the reader must not let the ring hoard latency",
        );
    }

    #[test]
    fn reader_writes_the_same_mono_sample_to_every_output_channel() {
        let (mut producer, mut reader, _settings) = reader_with(RATE, RATE, 64);
        for i in 0..3000 {
            let phase = i as f32 * std::f32::consts::TAU * 220.0 / RATE as f32;
            let _ = producer.push(0.8 * phase.sin());
        }

        for _ in 0..8 {
            let mut output = [0.0f32; 256];
            reader.fill(&mut output, 2);
            for frame in output.chunks(2) {
                assert_eq!(frame[0], frame[1], "a microphone is mono -- both speakers get the same sample");
            }
        }
    }

    /// A rate mismatch must change the *rate* samples are consumed at, not the
    /// number of output samples produced -- the output buffer is always filled.
    #[test]
    fn reader_consumes_at_the_input_to_output_rate_ratio() {
        let (mut producer, mut reader, _settings) = reader_with(44_100, 48_000, 512);
        // Primed but under the overrun trim threshold, so this measures the
        // read rate rather than the trim.
        for _ in 0..(512 + OVERRUN_SLACK_FRAMES) {
            let _ = producer.push(0.5);
        }
        let before = reader.consumer.slots();

        let mut output = [0.0f32; 480];
        reader.fill(&mut output, 1);

        let consumed = before - reader.consumer.slots();
        let expected = (480.0 * 44_100.0 / 48_000.0) as usize;
        assert!(
            consumed.abs_diff(expected) <= 8,
            "480 output frames at 48k should consume ~{expected} input frames at 44.1k, consumed {consumed}",
        );
    }

    #[test]
    fn reader_fills_the_rest_of_the_buffer_with_silence_on_an_under_run() {
        let (mut producer, mut reader, _settings) = reader_with(RATE, RATE, 64);
        for _ in 0..80 {
            let _ = producer.push(0.9);
        }

        let mut output = [1.0f32; 512];
        reader.fill(&mut output, 1);
        assert_eq!(output[511], 0.0, "past the end of the data the buffer must be silence, not stale audio");
    }

    /// Not a pass/fail assertion -- a measurement, run by hand against real
    /// hardware:
    ///
    /// ```text
    /// cargo test --release --manifest-path native/Cargo.toml \
    ///     monitor_round_trip_latency -- --ignored --nocapture
    /// ```
    ///
    /// It opens the real capture + monitor path on the default devices, so
    /// whatever it prints includes the driver buffers on both sides, and
    /// reports two things:
    ///
    ///   * the **deterministic** buffering budget -- input driver buffer + the
    ///     ring's steady-state fill + output driver buffer -- which is the part
    ///     this crate controls and the part that has to be defended;
    ///   * an **acoustic** round trip, measured from the recording itself. With
    ///     monitoring live on a built-in mic and built-in speakers, every sound
    ///     in the room is re-emitted one full round trip later and re-recorded,
    ///     so the input's own envelope autocorrelation peaks at the round-trip
    ///     time. Make a sharp noise (or `afplay /System/Library/Sounds/Tink.aiff`)
    ///     while it runs; the printed peak is the real number, air included.
    #[test]
    #[ignore = "hardware measurement: needs a real mic and speakers, and someone to make a noise"]
    fn monitor_round_trip_latency() {
        use crate::capture;
        use std::sync::Mutex;

        const RECORD_SECS: u64 = 8;

        // The default input on a dev machine is rarely the one a party uses.
        // `AETHERSTAR_MONITOR_DEVICE=Scarlett` picks by name substring.
        let wanted = std::env::var("AETHERSTAR_MONITOR_DEVICE").unwrap_or_default();
        let devices = capture::list_devices();
        for device in &devices {
            println!("  available: {} ({} ch @ {} Hz)", device.name, device.channel_count, device.sample_rate);
        }
        let Some(device) = devices
            .iter()
            .find(|device| !wanted.is_empty() && device.name.contains(&wanted))
            .or_else(|| devices.first())
            .cloned()
        else {
            eprintln!("no input device in this environment -- nothing to measure");
            return;
        };
        println!("input device: {} ({} ch @ {} Hz)", device.name, device.channel_count, device.sample_rate);

        let (pitch_producer, _pitch_consumer) = create_ring_buffer(1 << 16);
        let (monitor_producer, monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let settings = Arc::new(MonitorSettings::new());
        let observed = Arc::new(AtomicU32::new(0));
        let recording: Arc<Mutex<Vec<f32>>> = Arc::new(Mutex::new(Vec::with_capacity(48_000 * RECORD_SECS as usize)));

        let mask = Arc::new(AtomicU32::new(1));
        let tap_recording = recording.clone();
        let settings_for_stream = settings.clone();
        let observed_for_stream = observed.clone();
        let capture_stream = capture::start_input_capture_for_device_with(
            &device.id,
            move |config| {
                let channels = config.channel_count.max(1) as usize;
                let mut fanout = InputFanout::new(
                    pitch_producer,
                    MonitorTap::new(monitor_producer),
                    channels,
                    mask,
                    settings_for_stream,
                    observed_for_stream,
                );
                move |data: &[f32]| {
                    fanout.on_input(data);
                    // A second, test-only tap so the measurement can look at
                    // exactly the samples the monitor saw. Locking here would
                    // be unacceptable in production; in a measurement harness
                    // with one other thread that is only sleeping, it is fine.
                    if let Ok(mut buffer) = tap_recording.lock() {
                        buffer.extend(data.iter().step_by(channels).copied());
                    }
                }
            },
            |err| eprintln!("capture error: {err}"),
        )
        .expect("capture should open");

        let Some(capture_stream) = capture_stream else {
            eprintln!("input device disappeared -- nothing to measure");
            return;
        };
        let input_rate = capture_stream.sample_rate;

        // A real, audible level -- the acoustic half of the measurement needs
        // the loop to actually exist.
        settings.set(true, 0.6);
        let monitor = start_monitor_output(monitor_consumer, settings.clone(), observed.clone(), input_rate)
            .expect("monitor output should build");
        let Some(monitor) = monitor else {
            eprintln!("no default output device -- nothing to measure");
            return;
        };
        monitor.play().expect("monitor should play");

        println!("recording {RECORD_SECS}s with monitoring live -- make a sharp noise now");
        std::thread::sleep(std::time::Duration::from_secs(RECORD_SECS));

        let input_frames = observed.load(Ordering::Relaxed);
        let output_frames = monitor.output_frames_per_callback;
        let output_rate = monitor.output_sample_rate;
        let underruns = monitor.underruns.load(Ordering::Relaxed);
        let target_fill = input_frames.max(output_frames).max(MIN_TARGET_FILL_FRAMES);
        drop(monitor);
        drop(capture_stream);

        // The ring holds *input*-rate frames; the output buffer holds
        // output-rate frames. Converting both with the same divisor is exactly
        // the mistake that makes a latency budget lie, so they get their own.
        let in_ms = |frames: u32| frames as f64 * 1000.0 / input_rate as f64;
        let out_ms = |frames: u32| frames as f64 * 1000.0 / output_rate as f64;
        let total = in_ms(input_frames) + in_ms(target_fill) + out_ms(output_frames);
        println!("--- deterministic buffering budget ---");
        println!("  input driver buffer : {input_frames:>5} frames  {:>6.2} ms  (@ {input_rate} Hz)", in_ms(input_frames));
        println!("  monitor ring fill   : {target_fill:>5} frames  {:>6.2} ms  (@ {input_rate} Hz)", in_ms(target_fill));
        println!("  output driver buffer: {output_frames:>5} frames  {:>6.2} ms  (@ {output_rate} Hz)", out_ms(output_frames));
        println!("  TOTAL               : {total:>6.2} ms (excludes ADC/DAC conversion and air)");
        println!(
            "  ring under-runs     : {underruns} in {RECORD_SECS}s ({:.2}/s) -- non-zero means the target fill is too small",
            underruns as f64 / RECORD_SECS as f64,
        );

        // --- acoustic round trip, from the recording's own echo ---
        let samples = recording.lock().unwrap().clone();
        if samples.len() < input_rate as usize {
            println!("not enough audio recorded for an acoustic estimate");
            return;
        }
        const ENVELOPE_RATE: usize = 8_000;
        let decimation = (input_rate as usize / ENVELOPE_RATE).max(1);
        let envelope: Vec<f32> = samples
            .chunks(decimation)
            .map(|chunk| chunk.iter().fold(0.0f32, |peak, s| peak.max(s.abs())))
            .collect();
        let mean = envelope.iter().sum::<f32>() / envelope.len() as f32;
        let centred: Vec<f32> = envelope.iter().map(|&s| s - mean).collect();

        let min_lag = (0.003 * ENVELOPE_RATE as f32) as usize; // 3ms -- below any plausible round trip
        let max_lag = (0.080 * ENVELOPE_RATE as f32) as usize; // 80ms -- above any tolerable one
        let mut best = (0usize, f32::MIN);
        for lag in min_lag..max_lag.min(centred.len() / 2) {
            let correlation: f32 = centred[lag..].iter().zip(centred.iter()).map(|(a, b)| a * b).sum();
            if correlation > best.1 {
                best = (lag, correlation);
            }
        }
        println!("--- acoustic round trip ---");
        println!(
            "  envelope autocorrelation peak at lag {} = {:.2} ms",
            best.0,
            best.0 as f64 * 1000.0 / ENVELOPE_RATE as f64,
        );
    }

    #[test]
    fn start_monitor_output_round_trips_without_panicking() {
        let (_producer, consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        match start_monitor_output(consumer, Arc::new(MonitorSettings::new()), Arc::new(AtomicU32::new(512)), RATE) {
            Ok(Some(stream)) => {
                stream.play().expect("a freshly built monitor stream should play");
                stream.pause().expect("...and pause");
                drop(stream);
            }
            Ok(None) => eprintln!("no default output device in this environment -- skipping hardware-dependent assertion"),
            Err(e) => eprintln!("monitor output unavailable in this environment ({e}) -- skipping"),
        }
    }
}
