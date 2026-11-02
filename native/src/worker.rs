//! Per-device isolated audio thread wiring: a lock-free ring buffer between the
//! `cpal` capture callback and the pitch-detection loop (so analysis never
//! blocks the audio callback), the capture-time
//! clock that timestamps each frame, the overlapping analysis-window assembly,
//! and the frame-batching policy for the `ThreadsafeFunction` flushes.

use std::time::{SystemTime, UNIX_EPOCH};

use rtrb::{Consumer, Producer, RingBuffer};

/// Smallest pitch ring ever allocated, in samples, whatever the device reports.
pub const MIN_PITCH_RING_CAPACITY: usize = 1 << 14;
/// Largest pitch ring ever allocated, in samples (16 MiB of `f32`) -- only a
/// 32-channel interface at 192 kHz would hit it, and it still holds ~0.7 s.
pub const MAX_PITCH_RING_CAPACITY: usize = 1 << 22;
/// Capture-time marks the ring between the input callback and the consumer can
/// hold. One mark per callback, drained every couple of milliseconds; a full
/// mark ring only costs timing precision, never audio.
pub const MARK_RING_CAPACITY: usize = 1024;

/// Ring capacity, in interleaved samples, for ~1 s of audio at this device's
/// real rate *and channel count*.
///
/// The old fixed 65,536 samples was "~1.4 s at 48 kHz" only for a mono device;
/// on an 8-channel interface it was 170 ms, which a GC pause in the main
/// process could overrun. A second is generous headroom for the consumer to
/// fall behind without ever blocking the audio callback.
pub fn pitch_ring_capacity(sample_rate: u32, channel_count: u16) -> usize {
    (sample_rate as usize)
        .saturating_mul((channel_count as usize).max(1))
        .clamp(MIN_PITCH_RING_CAPACITY, MAX_PITCH_RING_CAPACITY)
}

pub fn create_ring_buffer(capacity: usize) -> (Producer<f32>, Consumer<f32>) {
    RingBuffer::<f32>::new(capacity)
}

/// Pushes the whole of `data` into the ring, or none of it.
///
/// Called from the real-time input callback, so it never blocks and never
/// allocates. The all-or-nothing rule is what keeps interleaved channels in
/// their lanes: pushing sample by sample and dropping whichever pushes fail
/// would, the moment the ring filled mid-callback, drop a partial frame -- and
/// from then on every frame the consumer de-interleaves would be shifted by a
/// channel (mic B scored as lane A). Dropping a whole callback is a gap; a
/// partial one is a permanent channel swap.
///
/// `slots()` can only grow between the check and the pushes (this is the only
/// producer), so every push after a successful check succeeds.
pub fn push_whole(producer: &mut Producer<f32>, data: &[f32]) -> bool {
    if producer.slots() < data.len() {
        return false;
    }
    for &sample in data {
        let _ = producer.push(sample);
    }
    true
}

/// Wall-clock now, in epoch milliseconds -- the unit and epoch every pitch
/// frame's `t` travels in. Allocation- and lock-free, so it is
/// safe to call from the audio callback.
pub fn now_epoch_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

/// "By the time the input callback ran at `t_ms`, `end_sample` interleaved
/// samples had been written into the pitch ring." One per accepted callback,
/// sent from the input callback to the consumer through its own small ring.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CaptureMark {
    pub end_sample: u64,
    pub t_ms: f64,
}

pub fn create_mark_ring(capacity: usize) -> (Producer<CaptureMark>, Consumer<CaptureMark>) {
    RingBuffer::<CaptureMark>::new(capacity)
}

/// How fast the clock's offset estimate may creep *later* without a mark
/// proving it, in ms per second of audio. Covers any real sample-clock vs
/// system-clock drift (tens of ppm = hundredths of a ms per second) with a
/// wide margin, while still letting the estimate recover from a stale low.
const CLOCK_LEAK_MS_PER_SEC: f64 = 2.0;
/// A mark this much later than the current estimate is not jitter -- it is a
/// wall-clock step (NTP) or a dropped callback -- once it is confirmed by
/// [`CLOCK_RESYNC_VOTES`] consecutive marks.
const CLOCK_RESYNC_MS: f64 = 20.0;
/// Consecutive "much later" marks needed before the estimate jumps to them.
/// One callback scheduled >20 ms late (a busy machine, a GC pause in the
/// host) is not a clock step; adopting it at once moved the estimate forward
/// and the next on-time mark then pulled it straight back -- timestamps
/// stepped backwards. A real step keeps every following mark late too.
const CLOCK_RESYNC_VOTES: u32 = 3;

/// Maps a frame index of the captured stream to the epoch-ms wall-clock time
/// it was captured at.
///
/// Each mark says "the frame just before `end_sample / channels` existed by
/// `t_ms`". Callbacks only ever run *after* their audio was captured, and how
/// much after jitters with scheduling, so the earliest-looking mark is the
/// most accurate one: the estimate is a leaky minimum of `t - frame / rate`
/// over recent marks. That takes callback jitter out of the timestamps
/// instead of passing it straight to scoring.
pub struct CaptureClock {
    sample_rate: f64,
    channels: u64,
    offset_ms: Option<f64>,
    last_end_frame: f64,
    /// Consecutive marks so far that sat more than `CLOCK_RESYNC_MS` above the estimate.
    resync_votes: u32,
    /// The earliest-looking of those marks -- what a confirmed resync adopts.
    resync_min: f64,
}

impl CaptureClock {
    pub fn new(sample_rate: u32, channels: usize) -> Self {
        Self {
            sample_rate: sample_rate as f64,
            channels: channels.max(1) as u64,
            offset_ms: None,
            last_end_frame: 0.0,
            resync_votes: 0,
            resync_min: 0.0,
        }
    }

    pub fn observe(&mut self, mark: CaptureMark) {
        if self.sample_rate <= 0.0 || !mark.t_ms.is_finite() {
            return;
        }
        let end_frame = (mark.end_sample / self.channels) as f64;
        let observed = mark.t_ms - end_frame * 1000.0 / self.sample_rate;
        self.offset_ms = Some(match self.offset_ms {
            None => observed,
            Some(previous) => {
                let elapsed_secs = ((end_frame - self.last_end_frame) / self.sample_rate).max(0.0);
                if observed > previous + CLOCK_RESYNC_MS {
                    self.resync_min = if self.resync_votes == 0 { observed } else { self.resync_min.min(observed) };
                    self.resync_votes += 1;
                    if self.resync_votes >= CLOCK_RESYNC_VOTES {
                        self.resync_votes = 0;
                        self.resync_min
                    } else {
                        previous + elapsed_secs * CLOCK_LEAK_MS_PER_SEC
                    }
                } else {
                    self.resync_votes = 0;
                    observed.min(previous + elapsed_secs * CLOCK_LEAK_MS_PER_SEC)
                }
            }
        });
        self.last_end_frame = end_frame;
    }

    /// Capture time of (possibly fractional) frame index `frame`, or `None`
    /// before the first mark has arrived.
    pub fn frame_time_ms(&self, frame: f64) -> Option<f64> {
        if self.sample_rate <= 0.0 {
            return None;
        }
        self.offset_ms.map(|offset| offset + frame * 1000.0 / self.sample_rate)
    }
}

/// Accumulates interleaved samples from the ring and hands them out as
/// overlapping analysis windows: `window_frames` long, one every `hop_frames`.
///
/// Every complete window is handed out -- a device that delivers its audio in
/// big bursts gets every window in the burst analysed, not one per wake with
/// the rest left to pile up. The one exception is [`trim_backlog`]: if the
/// consumer has fallen more than `max_backlog_frames` behind, the stale audio
/// is skipped so pitch never lags the singer by more than that.
///
/// [`trim_backlog`]: WindowAssembler::trim_backlog
pub struct WindowAssembler {
    channels: usize,
    window_frames: usize,
    hop_frames: usize,
    max_backlog_frames: usize,
    buffer: Vec<f32>,
    /// Absolute frame index (since the stream opened) of `buffer[0]`.
    start_frame: u64,
}

impl WindowAssembler {
    pub fn new(channels: usize, window_frames: usize, hop_frames: usize, max_backlog_frames: usize) -> Self {
        let channels = channels.max(1);
        let window_frames = window_frames.max(1);
        let hop_frames = hop_frames.clamp(1, window_frames);
        let capacity = (window_frames + max_backlog_frames + hop_frames).saturating_mul(channels);
        Self { channels, window_frames, hop_frames, max_backlog_frames, buffer: Vec::with_capacity(capacity), start_frame: 0 }
    }

    pub fn push(&mut self, sample: f32) {
        self.buffer.push(sample);
    }

    #[allow(dead_code)] // exercised by tests; the consumer loop pushes sample by sample from the ring
    pub fn extend_from_slice(&mut self, samples: &[f32]) {
        self.buffer.extend_from_slice(samples);
    }

    /// Drops everything but the newest complete window when more than
    /// `max_backlog_frames` of audio is queued behind it. Returns the number
    /// of frames skipped (0 in normal operation).
    pub fn trim_backlog(&mut self) -> usize {
        let frames = self.buffer.len() / self.channels;
        if frames <= self.window_frames + self.max_backlog_frames {
            return 0;
        }
        let skip = frames - self.window_frames;
        self.buffer.drain(..skip * self.channels);
        self.start_frame += skip as u64;
        skip
    }

    /// The oldest complete window, interleaved, if one is buffered.
    pub fn window(&self) -> Option<&[f32]> {
        let needed = self.window_frames * self.channels;
        if self.buffer.len() >= needed {
            Some(&self.buffer[..needed])
        } else {
            None
        }
    }

    /// Frame index of the centre of [`WindowAssembler::window`] -- the instant
    /// a window's pitch describes, and so the instant its frame is stamped with.
    pub fn window_centre_frame(&self) -> f64 {
        self.start_frame as f64 + self.window_frames as f64 / 2.0
    }

    /// Moves on by one hop, keeping the overlap for the next window.
    pub fn advance(&mut self) {
        let consumed = (self.hop_frames * self.channels).min(self.buffer.len());
        let consumed = consumed - consumed % self.channels;
        self.buffer.drain(..consumed);
        self.start_frame += (consumed / self.channels) as u64;
    }
}

/// One analysed frame, timestamped in epoch-ms (`t` travels the wire as
/// `Float64Array` because epoch-ms exceeds f32's exact-integer range).
///
/// `t_ms` is the wall-clock capture time of the *centre* of the analysis
/// window -- not the time the analysis finished -- so a frame is never biased
/// late by the window length, the ring's queueing, or the analysis itself.
///
/// `hz`/`confidence` are both 0 for a frame the pitch detector rejected (below
/// the noise gate, or no threshold crossing); `rms` is always the real measured
/// level, so the input meters keep reading during silence. JS treats `hz == 0`
/// as "level-only frame" and keeps it out of the pitch stream.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimedPitch {
    pub t_ms: f64,
    pub hz: f32,
    pub confidence: f32,
    pub rms: f32,
}

/// Floats each frame contributes to the `values` array of a batch.
///
/// This is the single source of truth for the wire stride on the Rust side;
/// `PITCH_VALUES_PER_FRAME` in `electron/audio/native-bridge.cjs` is its JS
/// counterpart, and the two must agree. Timestamps deliberately do NOT ride in
/// `values`: epoch-ms (~1.7e12) is far past Float32's exact-integer range, so
/// packing `t` here would silently corrupt every timestamp.
pub const VALUES_PER_FRAME: usize = 3;

/// Packs a flushed batch into the two typed arrays the JS callback receives:
/// `times` (one f64 per frame) and `values` (`VALUES_PER_FRAME` f32s per frame,
/// interleaved `[hz, confidence, rms, ...]`).
///
/// Extracted from the emit path purely so the stride can be unit-tested -- the
/// packing loop used to live inside a spawned thread inside a napi method,
/// where an off-by-one stride could only ever be caught by hand.
pub fn pack_batch(batch: &[TimedPitch]) -> (Vec<f64>, Vec<f32>) {
    let mut times: Vec<f64> = Vec::with_capacity(batch.len());
    let mut values: Vec<f32> = Vec::with_capacity(batch.len() * VALUES_PER_FRAME);
    for frame in batch {
        times.push(frame.t_ms);
        values.push(frame.hz);
        values.push(frame.confidence);
        values.push(frame.rms);
    }
    (times, values)
}

/// Batches pitch frames for the `ThreadsafeFunction`.
///
/// The consumer loop calls [`FrameBatcher::flush`] at the end of every pass,
/// so a frame never waits for audio that has not arrived yet: a batch only
/// ever holds frames that became available together (a device delivering
/// 40 ms bursts yields batches of ~4; a small-buffer device yields batches of
/// one). The frame-count and elapsed-time thresholds on [`FrameBatcher::push`]
/// only split a pass that produced a lot at once -- catching up after a stall.
pub struct FrameBatcher {
    max_frames: usize,
    max_wait_ms: f64,
    pending: Vec<TimedPitch>,
    batch_start_ms: Option<f64>,
}

impl FrameBatcher {
    pub fn new(max_frames: usize, max_wait_ms: f64) -> Self {
        Self { max_frames, max_wait_ms, pending: Vec::with_capacity(max_frames), batch_start_ms: None }
    }

    /// Returns `Some(batch)` when this frame's arrival should trigger a flush.
    pub fn push(&mut self, frame: TimedPitch) -> Option<Vec<TimedPitch>> {
        let start = *self.batch_start_ms.get_or_insert(frame.t_ms);
        let elapsed = frame.t_ms - start;
        self.pending.push(frame);

        if self.pending.len() >= self.max_frames || elapsed >= self.max_wait_ms {
            self.batch_start_ms = None;
            return Some(std::mem::take(&mut self.pending));
        }
        None
    }

    /// Hands back whatever is pending, if anything.
    pub fn flush(&mut self) -> Option<Vec<TimedPitch>> {
        self.batch_start_ms = None;
        if self.pending.is_empty() {
            None
        } else {
            Some(std::mem::take(&mut self.pending))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ring_buffer_round_trip_preserves_order_across_threads() {
        let (mut producer, mut consumer) = create_ring_buffer(4096);
        let samples: Vec<f32> = (0..20_000).map(|i| i as f32 * 0.001).collect();

        let producer_samples = samples.clone();
        let producer_thread = std::thread::spawn(move || {
            for &sample in &producer_samples {
                // Simulates the cpal capture callback pushing sample-by-sample
                // without ever blocking -- spin/yield on a momentarily full buffer.
                while producer.push(sample).is_err() {
                    std::thread::yield_now();
                }
            }
        });

        let mut received = Vec::with_capacity(samples.len());
        while received.len() < samples.len() {
            match consumer.pop() {
                Ok(sample) => received.push(sample),
                Err(_) => std::thread::yield_now(),
            }
        }
        producer_thread.join().unwrap();

        assert_eq!(received, samples, "ring buffer must preserve every sample, in order");
    }

    #[test]
    fn pitch_ring_holds_about_a_second_for_the_real_channel_count() {
        assert_eq!(pitch_ring_capacity(48_000, 1), 48_000);
        assert_eq!(pitch_ring_capacity(48_000, 8), 384_000);
        assert_eq!(pitch_ring_capacity(44_100, 2), 88_200);
        assert_eq!(pitch_ring_capacity(0, 0), MIN_PITCH_RING_CAPACITY);
        assert_eq!(pitch_ring_capacity(192_000, 64), MAX_PITCH_RING_CAPACITY);
    }

    #[test]
    fn push_whole_writes_all_of_a_callback_or_none_of_it() {
        let (mut producer, mut consumer) = create_ring_buffer(8);
        assert!(push_whole(&mut producer, &[1.0, 2.0, 3.0, 4.0, 5.0]));
        assert!(!push_whole(&mut producer, &[6.0, 7.0, 8.0, 9.0]), "only 3 slots free: must drop the whole callback");
        assert!(push_whole(&mut producer, &[6.0, 7.0, 8.0]));

        let mut received = Vec::new();
        while let Ok(sample) = consumer.pop() {
            received.push(sample);
        }
        assert_eq!(received, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0]);
    }

    /// The channel-shift regression: a ring that fills mid-callback must never
    /// leave half a frame behind, or every later frame lands in the wrong lane.
    #[test]
    fn a_full_ring_never_shifts_interleaved_channels() {
        // Odd capacity on purpose, so a sample-by-sample fill would split a frame.
        let (mut producer, mut consumer) = create_ring_buffer(7);
        let mut received = Vec::new();
        for callback in 0..50 {
            // Two channels: lane A carries +callback, lane B carries -callback - 1000.
            let a = callback as f32;
            let b = -(callback as f32) - 1000.0;
            push_whole(&mut producer, &[a, b, a, b]);
            // A consumer that only sometimes keeps up.
            if callback % 3 == 0 {
                while let Ok(sample) = consumer.pop() {
                    received.push(sample);
                }
            }
        }
        while let Ok(sample) = consumer.pop() {
            received.push(sample);
        }
        assert_eq!(received.len() % 2, 0);
        for frame in received.chunks_exact(2) {
            assert!(frame[0] >= 0.0, "lane A got {}", frame[0]);
            assert!(frame[1] <= -1000.0, "lane B got {}", frame[1]);
        }
    }

    #[test]
    fn capture_clock_maps_frames_to_the_time_they_were_captured() {
        let mut clock = CaptureClock::new(48_000, 2);
        assert_eq!(clock.frame_time_ms(0.0), None, "no mark yet, no time");

        // 480 frames (960 interleaved samples) were in by t = 1_000_010 ms,
        // so frame 0 was captured 10 ms earlier.
        clock.observe(CaptureMark { end_sample: 960, t_ms: 1_000_010.0 });
        assert!((clock.frame_time_ms(0.0).unwrap() - 1_000_000.0).abs() < 1e-6);
        assert!((clock.frame_time_ms(240.0).unwrap() - 1_000_005.0).abs() < 1e-6);
    }

    #[test]
    fn capture_clock_filters_out_late_callback_jitter() {
        let mut clock = CaptureClock::new(48_000, 1);
        // On-time callbacks every 480 frames (10 ms), with every other one
        // running 3 ms late.
        for k in 1..=20u64 {
            let late = if k % 2 == 0 { 3.0 } else { 0.0 };
            clock.observe(CaptureMark { end_sample: k * 480, t_ms: 5_000.0 + k as f64 * 10.0 + late });
        }
        // Frame 0 was really captured at 5_000 ms; the late marks must not
        // drag the estimate by anything like 3 ms.
        let t0 = clock.frame_time_ms(0.0).unwrap();
        assert!((t0 - 5_000.0).abs() < 0.05, "estimate {t0}");
    }

    #[test]
    fn capture_clock_follows_a_wall_clock_step_forward() {
        let mut clock = CaptureClock::new(48_000, 1);
        clock.observe(CaptureMark { end_sample: 480, t_ms: 10.0 });
        // System clock stepped forward by 1 s (NTP): adopted once three
        // consecutive marks confirm it.
        clock.observe(CaptureMark { end_sample: 960, t_ms: 1_020.0 });
        clock.observe(CaptureMark { end_sample: 1_440, t_ms: 1_030.0 });
        clock.observe(CaptureMark { end_sample: 1_920, t_ms: 1_040.0 });
        assert!((clock.frame_time_ms(960.0).unwrap() - 1_020.0).abs() < 1e-6);
        assert!((clock.frame_time_ms(1_920.0).unwrap() - 1_040.0).abs() < 1e-6);
    }

    #[test]
    fn capture_clock_ignores_a_single_very_late_callback() {
        let mut clock = CaptureClock::new(48_000, 1);
        // On-time callbacks every 480 frames (10 ms)...
        for k in 1..=5u64 {
            clock.observe(CaptureMark { end_sample: k * 480, t_ms: 5_000.0 + k as f64 * 10.0 });
        }
        // ...one scheduled 40 ms late, then on time again.
        clock.observe(CaptureMark { end_sample: 6 * 480, t_ms: 5_060.0 + 40.0 });
        let during = clock.frame_time_ms(0.0).unwrap();
        for k in 7..=10u64 {
            clock.observe(CaptureMark { end_sample: k * 480, t_ms: 5_000.0 + k as f64 * 10.0 });
        }
        let after = clock.frame_time_ms(0.0).unwrap();
        // Never jumped to the late mark, so there was nothing to step back from.
        assert!((during - 5_000.0).abs() < 0.1, "estimate during the late mark: {during}");
        assert!((after - 5_000.0).abs() < 0.1, "estimate afterwards: {after}");
    }

    #[test]
    fn capture_clock_resync_votes_reset_on_an_on_time_mark() {
        let mut clock = CaptureClock::new(48_000, 1);
        clock.observe(CaptureMark { end_sample: 480, t_ms: 10.0 });
        // Two late marks, an on-time one, then two more late ones: never three in a row.
        clock.observe(CaptureMark { end_sample: 960, t_ms: 60.0 });
        clock.observe(CaptureMark { end_sample: 1_440, t_ms: 70.0 });
        clock.observe(CaptureMark { end_sample: 1_920, t_ms: 40.0 });
        clock.observe(CaptureMark { end_sample: 2_400, t_ms: 90.0 });
        clock.observe(CaptureMark { end_sample: 2_880, t_ms: 100.0 });
        assert!((clock.frame_time_ms(0.0).unwrap() - 0.0).abs() < 0.1);
    }

    #[test]
    fn window_assembler_hands_out_every_overlapping_window_from_a_burst() {
        // Mono, 100-frame windows, 10-frame hop.
        let mut windows = WindowAssembler::new(1, 100, 10, 10_000);
        let burst: Vec<f32> = (0..400).map(|i| i as f32).collect();
        windows.extend_from_slice(&burst);

        let mut starts = Vec::new();
        let mut centres = Vec::new();
        while let Some(window) = windows.window() {
            starts.push(window[0]);
            centres.push(windows.window_centre_frame());
            windows.advance();
        }
        // (400 - 100) / 10 + 1 windows, each 10 frames after the last.
        assert_eq!(starts.len(), 31);
        assert_eq!(starts[0], 0.0);
        assert_eq!(starts[1], 10.0);
        assert_eq!(starts[30], 300.0);
        assert_eq!(centres[0], 50.0);
        assert_eq!(centres[30], 350.0);
    }

    #[test]
    fn window_assembler_keeps_interleaved_frames_together() {
        let mut windows = WindowAssembler::new(2, 4, 2, 10_000);
        windows.extend_from_slice(&[0.0, 100.0, 1.0, 101.0, 2.0, 102.0, 3.0, 103.0, 4.0, 104.0, 5.0, 105.0]);
        assert_eq!(windows.window().unwrap(), &[0.0, 100.0, 1.0, 101.0, 2.0, 102.0, 3.0, 103.0]);
        windows.advance();
        assert_eq!(windows.window().unwrap(), &[2.0, 102.0, 3.0, 103.0, 4.0, 104.0, 5.0, 105.0]);
        assert_eq!(windows.window_centre_frame(), 4.0);
        windows.advance();
        assert!(windows.window().is_none());
    }

    #[test]
    fn window_assembler_skips_a_stale_backlog_to_the_newest_window() {
        let mut windows = WindowAssembler::new(1, 100, 10, 50);
        windows.extend_from_slice(&(0..120).map(|i| i as f32).collect::<Vec<_>>());
        assert_eq!(windows.trim_backlog(), 0, "120 frames is within window + backlog");

        windows.extend_from_slice(&(120..1000).map(|i| i as f32).collect::<Vec<_>>());
        assert_eq!(windows.trim_backlog(), 900);
        let window = windows.window().unwrap();
        assert_eq!(window[0], 900.0, "only the newest window survives");
        assert_eq!(windows.window_centre_frame(), 950.0, "and its timing still counts the skipped frames");
    }

    fn pitch(t_ms: f64) -> TimedPitch {
        TimedPitch { t_ms, hz: 220.0, confidence: 0.9, rms: 0.3 }
    }

    #[test]
    fn batcher_flushes_on_frame_count_threshold() {
        let mut batcher = FrameBatcher::new(3, 1000.0);
        assert!(batcher.push(pitch(0.0)).is_none());
        assert!(batcher.push(pitch(10.0)).is_none());
        let batch = batcher.push(pitch(20.0)).expect("third frame should flush");
        assert_eq!(batch.len(), 3);
    }

    #[test]
    fn batcher_flushes_on_time_threshold_even_with_few_frames() {
        let mut batcher = FrameBatcher::new(10, 25.0);
        assert!(batcher.push(pitch(0.0)).is_none());
        let batch = batcher.push(pitch(30.0)).expect("elapsed time should flush before the frame-count threshold");
        assert_eq!(batch.len(), 2);
    }

    #[test]
    fn batcher_starts_a_fresh_batch_after_each_flush() {
        let mut batcher = FrameBatcher::new(2, 1000.0);
        let first = batcher.push(pitch(0.0));
        assert!(first.is_none());
        let flushed = batcher.push(pitch(1.0)).unwrap();
        assert_eq!(flushed.len(), 2);

        assert!(batcher.push(pitch(2.0)).is_none());
        let second_flush = batcher.push(pitch(3.0)).unwrap();
        assert_eq!(second_flush.len(), 2);
    }

    #[test]
    fn batcher_flush_hands_back_pending_frames_without_waiting() {
        let mut batcher = FrameBatcher::new(8, 30.0);
        assert!(batcher.flush().is_none(), "nothing pending, nothing to emit");
        assert!(batcher.push(pitch(0.0)).is_none());
        let batch = batcher.flush().expect("a lone frame must not wait for a second one");
        assert_eq!(batch.len(), 1);
        assert!(batcher.flush().is_none());
        // And the time threshold restarts from the next frame, not the flushed one.
        assert!(batcher.push(pitch(100.0)).is_none());
    }

    #[test]
    fn pack_batch_writes_three_interleaved_values_per_frame() {
        let batch = [
            TimedPitch { t_ms: 1_700_000_000_123.0, hz: 220.0, confidence: 0.9, rms: 0.25 },
            TimedPitch { t_ms: 1_700_000_000_153.0, hz: 0.0, confidence: 0.0, rms: 0.004 },
        ];

        let (times, values) = pack_batch(&batch);

        assert_eq!(times, vec![1_700_000_000_123.0, 1_700_000_000_153.0]);
        assert_eq!(values, vec![220.0, 0.9, 0.25, 0.0, 0.0, 0.004]);
    }

    /// The stride invariant JS relies on to pair `values[i * stride]` with
    /// `times[i]`. If this ever drifts, every timestamp downstream silently
    /// shifts onto the wrong frame -- which is exactly the failure the
    /// separate `times` channel exists to prevent, so it gets its own test.
    #[test]
    fn pack_batch_keeps_values_and_times_lengths_in_lockstep() {
        for frame_count in 0..5 {
            let batch: Vec<TimedPitch> = (0..frame_count).map(|i| pitch(i as f64 * 10.0)).collect();
            let (times, values) = pack_batch(&batch);
            assert_eq!(times.len(), frame_count);
            assert_eq!(values.len(), frame_count * VALUES_PER_FRAME);
        }
    }

    /// Reading the packed arrays back with the documented stride must recover
    /// the original frames -- the Rust half of the round trip whose JS half is
    /// `decodeBatch` in electron/audio/native-bridge.cjs.
    #[test]
    fn packed_batch_round_trips_through_the_documented_stride() {
        let batch: Vec<TimedPitch> = (0..4)
            .map(|i| TimedPitch {
                t_ms: 1_700_000_000_000.0 + i as f64 * 30.0,
                hz: 110.0 * (i + 1) as f32,
                confidence: 0.5,
                rms: 0.1 * (i + 1) as f32,
            })
            .collect();

        let (times, values) = pack_batch(&batch);

        for (i, frame) in batch.iter().enumerate() {
            assert_eq!(times[i], frame.t_ms);
            assert_eq!(values[i * VALUES_PER_FRAME], frame.hz);
            assert_eq!(values[i * VALUES_PER_FRAME + 1], frame.confidence);
            assert_eq!(values[i * VALUES_PER_FRAME + 2], frame.rms);
        }
    }
}
