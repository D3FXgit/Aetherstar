#![deny(clippy::all)]

mod capture;
mod monitor;
mod pitch;
mod registry;
#[cfg(test)]
mod test_support;
mod worker;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use napi_derive::napi;

use capture::CaptureStream;
use monitor::{
    start_monitor_output, InputFanout, MonitorSettings, MonitorStream, MonitorTap, MONITOR_RING_CAPACITY,
};
use pitch::PitchDetector;
use registry::ChannelRegistry;
use rtrb::Consumer;
use worker::{
    create_mark_ring, create_ring_buffer, now_epoch_ms, pack_batch, pitch_ring_capacity, push_whole, CaptureClock,
    CaptureMark, FrameBatcher, TimedPitch, WindowAssembler, MARK_RING_CAPACITY,
};

/// Locks a mutex, recovering a poisoned one instead of aborting the process.
///
/// `lock().unwrap()` is the usual shorthand and it is the wrong default here.
/// Poisoning only means some thread panicked while holding the lock; in this
/// library that thread is the per-device consumer, and what it guards is a map
/// of pitch subscriptions -- data that a panicked analysis window leaves stale,
/// never structurally broken. Aborting on it turns one bad audio window into a
/// dead party: the panic unwinds a worker nobody was watching, and the crash
/// lands minutes later on whichever unrelated call next takes the same lock.
/// That is exactly how the 8-player crash presented (see pitch.rs's `pick_tau`).
///
/// So the poison is stepped over deliberately. The panic that caused it is a
/// bug to fix at its source -- and the ones that were reachable have been --
/// but no single window may ever be able to take the whole app down.
fn lock_recovering<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}


/// How many raw samples `startRawScope` accumulates before flushing a chunk to
/// JS -- roughly 20ms at a typical 48kHz device rate (the raw-buffer scope is
/// a second, independent, lab-only stream). Rounded up to
/// a whole number of frames, so a chunk never splits a frame.
const RAW_SCOPE_FLUSH_SAMPLES: usize = 960;
/// Hop between successive analysis windows. Windows are ~29 ms long and
/// overlap, so a pitch frame arrives every 10 ms (100 Hz per channel) instead
/// of once per non-overlapping window (~35 Hz).
const ANALYSIS_HOP_MS: f64 = 10.0;
/// If the consumer ever falls this far behind the audio (a stalled thread, a
/// machine under heavy load), the stale audio is skipped rather than analysed
/// late -- pitch that lags the singer by more than this is worse than a gap.
const MAX_ANALYSIS_BACKLOG_MS: f64 = 250.0;
/// Pitch-frame batching: every pass of
/// the consumer loop flushes whatever it produced, so no frame ever waits for
/// a later one. These thresholds only split one unusually large pass (catching
/// up after a stall) into several emits.
const PITCH_BATCH_MAX_FRAMES: usize = 8;
const PITCH_BATCH_MAX_WAIT_MS: f64 = 30.0;
/// How long a consumer thread sleeps when its ring was empty.
const CONSUMER_IDLE_SLEEP: Duration = Duration::from_millis(2);

#[napi(object)]
#[derive(Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub channel_count: u16,
    pub sample_rate: u32,
}

impl From<capture::AudioDeviceInfo> for AudioDevice {
    fn from(info: capture::AudioDeviceInfo) -> Self {
        Self { id: info.id, name: info.name, channel_count: info.channel_count, sample_rate: info.sample_rate }
    }
}

/// A channel registration that is undone on drop unless [`commit`]ted.
///
/// `start_capture` registers the channel first and only then tries to open
/// the device. Every early `?`/`return Err` after that used to leave the
/// registration behind: the next `stop_capture` then never saw "last
/// subscriber", so the stream, its thread and the microphone stayed open for
/// the life of the app. Holding the registration in this guard makes every
/// error path -- present and future -- undo it.
///
/// [`commit`]: PendingRegistration::commit
struct PendingRegistration<'a> {
    registry: &'a Mutex<ChannelRegistry>,
    device_id: String,
    channel_index: u32,
    armed: bool,
}

impl<'a> PendingRegistration<'a> {
    fn new(registry: &'a Mutex<ChannelRegistry>, device_id: &str, channel_index: u32) -> Self {
        Self { registry, device_id: device_id.to_string(), channel_index, armed: true }
    }

    /// The capture is up: keep the registration.
    fn commit(mut self) {
        self.armed = false;
    }
}

impl Drop for PendingRegistration<'_> {
    fn drop(&mut self) {
        if self.armed {
            lock_recovering(self.registry).unregister(&self.device_id, self.channel_index);
        }
    }
}

/// Rust-side state for one active raw-scope stream; dropping it stops the
/// `cpal` stream and signals/joins its consumer thread (cleanup is just `Drop`).
struct ActiveStream {
    _capture: CaptureStream,
    stop_flag: Arc<AtomicBool>,
    consumer_thread: Option<std::thread::JoinHandle<()>>,
}

impl Drop for ActiveStream {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.consumer_thread.take() {
            let _ = handle.join();
        }
    }
}

/// One channel's own pitch-detection state and JS emit callback. Each channel
/// on a shared device gets its own detector/batcher -- pitch state must never
/// be shared across channels.
struct ChannelSubscription {
    detector: PitchDetector,
    batcher: FrameBatcher,
    emit: Box<dyn Fn(Vec<f64>, Vec<f32>) + Send>,
}

/// One physical device's shared capture: a single `cpal` stream fanned out to
/// however many channel subscriptions are currently registered -- opened on
/// the first subscriber, torn down on the last.
struct DeviceCapture {
    _capture: CaptureStream,
    stop_flag: Arc<AtomicBool>,
    consumer_thread: Option<std::thread::JoinHandle<()>>,
    subscriptions: Arc<Mutex<HashMap<u32, ChannelSubscription>>>,

    // --- live monitoring ("karaoke effect", see monitor.rs) ---
    /// Which channels of this device currently have a subscriber, as a bitmask.
    /// The input callback reads it with a relaxed load to decide which channels
    /// to monitor -- a lock there would stall an audio thread.
    channel_mask: Arc<AtomicU32>,
    /// Frames per input callback, observed rather than assumed: the input
    /// stream deliberately keeps whatever buffer size the device chose (see
    /// `start_capture`), so this is the only way the monitor reader can size
    /// its target fill.
    observed_input_frames: Arc<AtomicU32>,
    /// The read end of the monitor ring, parked here until the first time
    /// monitoring is switched on. Only ever touched by control code holding the
    /// `captures` lock -- never from an audio callback.
    monitor_consumer: Option<Consumer<f32>>,
    /// Built lazily on first enable and then kept, paused, across later
    /// off/on cycles: rebuilding it would mean handing the ring's consumer to a
    /// second owner, and pausing is what `cpal` gives us for exactly this.
    monitor_stream: Option<MonitorStream>,
    input_sample_rate: u32,
}

impl DeviceCapture {
    /// Recomputes the monitored-channel mask from the live subscription set.
    ///
    /// Monitoring follows the pitch subscriptions rather than a list of its
    /// own: a channel nobody is scoring is a channel nobody is singing into,
    /// and deriving it means the two can never disagree.
    fn refresh_channel_mask(&self) {
        let mask = lock_recovering(&self.subscriptions)
            .keys()
            .filter(|&&index| index < 32)
            .fold(0u32, |mask, &index| mask | (1 << index));
        self.channel_mask.store(mask, Ordering::Relaxed);
    }

    /// Brings this capture's monitor output in line with the current setting.
    ///
    /// Errors are logged, never propagated: a machine with no usable output
    /// device must still capture and score, and a failure to monitor is not a
    /// failure to sing.
    fn apply_monitoring(&mut self, settings: &Arc<MonitorSettings>) {
        if !settings.is_enabled() {
            if let Some(stream) = &self.monitor_stream {
                // Even if a backend refuses to pause, MonitorReader::fill
                // re-checks the same flag and writes silence -- so "off" is
                // enforced twice and never depends on pause() succeeding.
                if let Err(e) = stream.pause() {
                    eprintln!("aetherstar-native: could not pause monitor stream: {e}");
                }
                // Switching off is the moment a "it was crackling" report is
                // still fresh, so this is where the ring's under-run count is
                // worth surfacing. Silent when there weren't any, which is the
                // normal case on every device pair measured so far.
                let underruns = stream.underruns.load(Ordering::Relaxed);
                if underruns > 0 {
                    eprintln!(
                        "aetherstar-native: monitor ring under-ran {underruns} time(s) while it was on -- \
                         the output device could not keep up with the input",
                    );
                }
            }
            return;
        }

        if self.monitor_stream.is_none() {
            let Some(consumer) = self.monitor_consumer.take() else {
                return; // Already taken by a stream that failed to build; don't retry into a second owner.
            };
            match start_monitor_output(
                consumer,
                settings.clone(),
                self.observed_input_frames.clone(),
                self.input_sample_rate,
            ) {
                Ok(Some(stream)) => {
                    // The one line that makes a latency complaint diagnosable
                    // from a log rather than from a rebuild.
                    eprintln!(
                        "aetherstar-native: microphone monitoring open -- input {} Hz, output {} Hz @ {} frames/callback",
                        self.input_sample_rate, stream.output_sample_rate, stream.output_frames_per_callback,
                    );
                    self.monitor_stream = Some(stream);
                }
                Ok(None) => eprintln!("aetherstar-native: no default output device -- microphone monitoring is unavailable"),
                Err(e) => eprintln!("aetherstar-native: could not open monitor output stream: {e}"),
            }
        }

        if let Some(stream) = &self.monitor_stream {
            if let Err(e) = stream.play() {
                eprintln!("aetherstar-native: could not start monitor stream: {e}");
            }
        }
    }
}

impl Drop for DeviceCapture {
    fn drop(&mut self) {
        self.stop_flag.store(true, Ordering::SeqCst);
        if let Some(handle) = self.consumer_thread.take() {
            let _ = handle.join();
        }
    }
}

/// The napi-facing bridge: one instance owns every currently-active capture
/// and raw-scope stream. Pitch captures are keyed by device id, with a
/// `ChannelRegistry` tracking which channel(s) of each device are currently
/// subscribed --
/// `startCapture(deviceId, channelIndex, callback)` / `stopCapture(deviceId, channelIndex)`.
#[napi]
pub struct AudioBridge {
    captures: Arc<Mutex<HashMap<String, DeviceCapture>>>,
    channel_registry: Arc<Mutex<ChannelRegistry>>,
    raw_scopes: Arc<Mutex<HashMap<String, ActiveStream>>>,
    /// Live-monitoring on/off + level, shared straight into every capture's
    /// audio callbacks as atomics (see monitor.rs). Off, silent, until the main
    /// process says otherwise.
    monitor_settings: Arc<MonitorSettings>,
}

#[napi]
impl AudioBridge {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            captures: Arc::new(Mutex::new(HashMap::new())),
            channel_registry: Arc::new(Mutex::new(ChannelRegistry::new())),
            raw_scopes: Arc::new(Mutex::new(HashMap::new())),
            monitor_settings: Arc::new(MonitorSettings::new()),
        }
    }

    /// Turns live microphone monitoring -- the "karaoke effect" -- on or off,
    /// and sets its level. `level` is 0..1 as the user's slider reports it; the
    /// mapping to an actual gain (and its hard sub-unity ceiling) lives in
    /// `monitor::monitor_gain_for_level`.
    ///
    /// Applies to every capture that is currently open and to every capture
    /// opened afterwards, so a mic plugged in mid-party is monitored without
    /// anyone touching the setting again. Idempotent -- the main process calls
    /// it on startup with whatever was persisted, whether or not anything has
    /// changed.
    #[napi]
    pub fn set_mic_monitoring(&self, enabled: bool, level: f64) {
        self.monitor_settings.set(enabled, level as f32);
        let mut captures = lock_recovering(&self.captures);
        for capture in captures.values_mut() {
            capture.apply_monitoring(&self.monitor_settings);
        }
    }

    #[napi]
    pub fn list_devices(&self) -> Vec<AudioDevice> {
        capture::list_devices().into_iter().map(AudioDevice::from).collect()
    }

    /// Starts pitch-detected capture for one channel of one device. `callback`
    /// receives `(deviceId, times, values)` batches -- `times` epoch-ms as `Float64Array`, `values` interleaved
    /// `[hz, confidence, rms, ...]` as `Float32Array`, three per frame.
    /// A frame whose pitch was rejected (below the noise gate, or no YIN
    /// threshold crossing) is still emitted, with `hz` and `confidence` at 0
    /// and its real measured `rms`, so input-level meters keep reading during
    /// silence. Multiple channels of the
    /// same device can be captured concurrently: the first
    /// subscriber for a `device_id` opens its `cpal` stream; later
    /// subscribers for the same device just register one more channel
    /// against the stream already running.
    #[napi]
    pub fn start_capture(
        &self,
        device_id: String,
        channel_index: u32,
        callback: Function<'static, (String, Float64Array, Float32Array), ()>,
    ) -> Result<()> {
        let tsfn = callback.build_threadsafe_function::<(String, Float64Array, Float32Array)>().build()?;
        let emit_device_id = device_id.clone();
        let emit = move |times: Vec<f64>, values: Vec<f32>| {
            let _ = tsfn.call(
                (emit_device_id.clone(), Float64Array::new(times), Float32Array::new(values)),
                ThreadsafeFunctionCallMode::NonBlocking,
            );
        };
        let subscription = ChannelSubscription {
            detector: PitchDetector::new(),
            batcher: FrameBatcher::new(PITCH_BATCH_MAX_FRAMES, PITCH_BATCH_MAX_WAIT_MS),
            emit: Box::new(emit),
        };

        let is_first = lock_recovering(&self.channel_registry).register(&device_id, channel_index);
        // From here on, any early return unregisters this channel again.
        let registration = PendingRegistration::new(&self.channel_registry, &device_id, channel_index);

        if !is_first {
            // Device stream is already running -- just add this channel's
            // subscription to it; no new cpal stream, no new thread.
            if let Some(device_capture) = lock_recovering(&self.captures).get(&device_id) {
                lock_recovering(&device_capture.subscriptions).insert(channel_index, subscription);
                device_capture.refresh_channel_mask();
                registration.commit();
                return Ok(());
            }
            // Registry said "not first" but no DeviceCapture exists -- shouldn't
            // happen, but fall through to opening a fresh one rather than losing
            // this subscriber.
        }

        // The monitor ring is allocated here, with the capture, even when
        // monitoring is off: allocating one later would mean allocating while
        // an audio thread is already running against the producer half.
        let (monitor_producer, monitor_consumer) = create_ring_buffer(MONITOR_RING_CAPACITY);
        let channel_mask = Arc::new(AtomicU32::new(1 << channel_index.min(31)));
        let observed_input_frames = Arc::new(AtomicU32::new(0));

        let monitor_settings = self.monitor_settings.clone();
        let fanout_channel_mask = channel_mask.clone();
        let fanout_observed_frames = observed_input_frames.clone();

        // The pitch ring is sized from the device's real rate and channel
        // count (~1 s of audio), so it is built inside the callback factory,
        // which is the first point that knows them -- still on this thread,
        // still before the stream starts. The read ends come back out through
        // these slots.
        let mut pitch_consumer_slot: Option<Consumer<f32>> = None;
        let mut mark_consumer_slot: Option<Consumer<CaptureMark>> = None;
        let pitch_slot = &mut pitch_consumer_slot;
        let mark_slot = &mut mark_consumer_slot;

        // The input stream's buffer size is left at the device default on
        // purpose. Monitoring would be a millisecond or two tighter with a
        // smaller one, but this is the stream pitch detection reads, and the
        // rule for this feature is that the scoring path does not change --
        // same samples, same results.
        let capture = capture::start_input_capture_for_device_with(
            &device_id,
            move |config| {
                let (pitch_producer, pitch_consumer) =
                    create_ring_buffer(pitch_ring_capacity(config.sample_rate, config.channel_count));
                let (mark_producer, mark_consumer) = create_mark_ring(MARK_RING_CAPACITY);
                *pitch_slot = Some(pitch_consumer);
                *mark_slot = Some(mark_consumer);
                let mut fanout = InputFanout::new(
                    pitch_producer,
                    MonitorTap::new(monitor_producer),
                    config.channel_count.max(1) as usize,
                    fanout_channel_mask,
                    monitor_settings,
                    fanout_observed_frames,
                )
                .with_timing(mark_producer);
                move |data: &[f32]| fanout.on_input(data)
            },
            |err| eprintln!("aetherstar-native: capture stream error: {err}"),
        )
        .map_err(Error::from_reason)?;

        let Some(capture) = capture else {
            return Err(Error::from_reason(format!("no input device found for id: {device_id}")));
        };
        let (Some(mut consumer), Some(mut mark_consumer)) = (pitch_consumer_slot, mark_consumer_slot) else {
            return Err(Error::from_reason(format!("capture for {device_id} opened without its sample ring")));
        };

        let channel_count = capture.channel_count.max(1) as usize;
        let input_rate = capture.sample_rate;
        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = stop_flag.clone();

        let subscriptions: Arc<Mutex<HashMap<u32, ChannelSubscription>>> = Arc::new(Mutex::new(HashMap::new()));
        lock_recovering(&subscriptions).insert(channel_index, subscription);
        let thread_subscriptions = subscriptions.clone();

        let consumer_thread = std::thread::spawn(move || {
            let window_frames = PitchDetector::required_samples(input_rate).max(1);
            let hop_frames = ((input_rate as f64 * ANALYSIS_HOP_MS / 1000.0).round() as usize).max(1);
            let max_backlog_frames = (input_rate as f64 * MAX_ANALYSIS_BACKLOG_MS / 1000.0) as usize;
            let mut windows = WindowAssembler::new(channel_count, window_frames, hop_frames, max_backlog_frames);
            let mut clock = CaptureClock::new(input_rate, channel_count);
            // The newest timestamp emitted so far. The clock's estimate can
            // still move earlier (the leaky minimum settling on an earlier
            // mark, or the system clock stepping back), but the renderer's
            // pitch stream must never go backwards in time, so emitted stamps
            // are clamped to it.
            let mut last_t_ms = f64::NEG_INFINITY;
            // One reused buffer for whichever channel is being analysed --
            // only subscribed channels are ever extracted.
            let mut lane: Vec<f32> = Vec::with_capacity(window_frames);

            while !thread_stop_flag.load(Ordering::Relaxed) {
                while let Ok(mark) = mark_consumer.pop() {
                    clock.observe(mark);
                }
                let mut drained_any = false;
                while let Ok(sample) = consumer.pop() {
                    windows.push(sample);
                    drained_any = true;
                }
                if !drained_any {
                    // Every complete window was analysed on the previous pass,
                    // so an empty ring really does mean there is nothing to do.
                    std::thread::sleep(CONSUMER_IDLE_SLEEP);
                    continue;
                }

                let skipped = windows.trim_backlog();
                if skipped > 0 {
                    eprintln!(
                        "aetherstar-native: pitch analysis fell behind -- skipped {skipped} frames ({:.0} ms) of stale audio",
                        skipped as f64 * 1000.0 / input_rate.max(1) as f64,
                    );
                }

                // Analyse *every* complete window, not one per wake: a device
                // that delivers audio in large bursts would otherwise build a
                // backlog -- and a latency -- that only ever grows.
                let mut produced_any = false;
                while let Some(window) = windows.window() {
                    // Stamped with when the window's centre was *captured*, not
                    // when the analysis happened to finish, so the window
                    // length, queueing and analysis time never bias scoring late.
                    let t_ms = clock.frame_time_ms(windows.window_centre_frame()).unwrap_or_else(now_epoch_ms);
                    let t_ms = t_ms.max(last_t_ms);
                    last_t_ms = t_ms;
                    let mut subs = lock_recovering(&thread_subscriptions);
                    for (&idx, sub) in subs.iter_mut() {
                        capture::extract_channel(window, channel_count, idx as usize, &mut lane);
                        if lane.is_empty() {
                            // A stale channel index -- a device reconfigured to
                            // fewer channels -- degrades to silence for that
                            // subscriber rather than taking the capture down.
                            continue;
                        }
                        let result = sub.detector.analyze(&lane, input_rate);
                        // Every analysed window emits a frame, pitched or not: the
                        // input-level meters have to keep reading while a mic is
                        // silent, and a frame that stops arriving is how the
                        // renderer tells a quiet input from a dead one. A frame
                        // with no pitch carries hz = confidence = 0 and is kept out
                        // of the renderer's pitch stream there, not here.
                        let (hz, confidence) = result.pitch.map_or((0.0, 0.0), |p| (p.hz, p.confidence));
                        let frame = TimedPitch { t_ms, hz, confidence, rms: result.rms };
                        if let Some(batch) = sub.batcher.push(frame) {
                            let (times, values) = pack_batch(&batch);
                            (sub.emit)(times, values);
                        }
                        produced_any = true;
                    }
                    drop(subs);
                    windows.advance();
                }

                // Nothing produced this pass waits for the next one.
                if produced_any {
                    let mut subs = lock_recovering(&thread_subscriptions);
                    for sub in subs.values_mut() {
                        if let Some(batch) = sub.batcher.flush() {
                            let (times, values) = pack_batch(&batch);
                            (sub.emit)(times, values);
                        }
                    }
                }
            }
        });

        let mut device_capture = DeviceCapture {
            _capture: capture,
            stop_flag,
            consumer_thread: Some(consumer_thread),
            subscriptions,
            channel_mask,
            observed_input_frames,
            monitor_consumer: Some(monitor_consumer),
            monitor_stream: None,
            input_sample_rate: input_rate,
        };
        // A mic plugged in (or a song started) while monitoring is already on
        // has to come up monitored, without the user touching the setting
        // again -- so a new capture adopts the current setting immediately.
        device_capture.apply_monitoring(&self.monitor_settings);
        lock_recovering(&self.captures).insert(device_id, device_capture);
        registration.commit();
        Ok(())
    }

    #[napi]
    pub fn stop_capture(&self, device_id: String, channel_index: u32) {
        let is_last = lock_recovering(&self.channel_registry).unregister(&device_id, channel_index);
        if is_last {
            // Drop tears down the thread, the cpal input stream, and -- with
            // it -- this device's monitor output stream. Monitoring can never
            // outlive the capture it taps.
            lock_recovering(&self.captures).remove(&device_id);
        } else if let Some(device_capture) = lock_recovering(&self.captures).get(&device_id) {
            lock_recovering(&device_capture.subscriptions).remove(&channel_index);
            device_capture.refresh_channel_mask();
        }
    }

    /// Starts a second, independent raw-waveform stream for one device, used
    /// only by `/lab/mic`'s buffer scope. `callback` receives
    /// `(deviceId, chunk)` -- `chunk` is a raw `Float32Array` window, not
    /// pitch-detected or resampled.
    #[napi]
    pub fn start_raw_scope(&self, device_id: String, callback: Function<'static, (String, Float32Array), ()>) -> Result<()> {
        let tsfn = callback.build_threadsafe_function::<(String, Float32Array)>().build()?;
        let emit_device_id = device_id.clone();

        // The audio callback only copies into a ring; buffering, the
        // `Float32Array`, the device-id `String` and the `ThreadsafeFunction`
        // call (which queues under a lock) all happen on a consumer thread.
        // Doing them in the callback -- as this used to -- allocated and locked
        // on the real-time audio thread every ~20 ms.
        let mut consumer_slot: Option<Consumer<f32>> = None;
        let slot = &mut consumer_slot;
        let capture = capture::start_input_capture_for_device_with(
            &device_id,
            move |config| {
                let (mut producer, consumer) =
                    create_ring_buffer(pitch_ring_capacity(config.sample_rate, config.channel_count));
                *slot = Some(consumer);
                move |data: &[f32]| {
                    let _ = push_whole(&mut producer, data);
                }
            },
            |err| eprintln!("aetherstar-native: raw scope stream error: {err}"),
        )
        .map_err(Error::from_reason)?;

        let Some(capture) = capture else {
            return Err(Error::from_reason(format!("no input device found for id: {device_id}")));
        };
        let Some(mut consumer) = consumer_slot else {
            return Err(Error::from_reason(format!("raw scope for {device_id} opened without its sample ring")));
        };

        let channels = capture.channel_count.max(1) as usize;
        let flush_samples = RAW_SCOPE_FLUSH_SAMPLES.div_ceil(channels) * channels;
        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = stop_flag.clone();
        let consumer_thread = std::thread::spawn(move || {
            let mut flush_buffer: Vec<f32> = Vec::with_capacity(flush_samples);
            while !thread_stop_flag.load(Ordering::Relaxed) {
                let mut drained_any = false;
                while let Ok(sample) = consumer.pop() {
                    drained_any = true;
                    flush_buffer.push(sample);
                    if flush_buffer.len() >= flush_samples {
                        let chunk = std::mem::replace(&mut flush_buffer, Vec::with_capacity(flush_samples));
                        let _ = tsfn.call(
                            (emit_device_id.clone(), Float32Array::new(chunk)),
                            ThreadsafeFunctionCallMode::NonBlocking,
                        );
                    }
                }
                if !drained_any {
                    std::thread::sleep(CONSUMER_IDLE_SLEEP);
                }
            }
        });

        lock_recovering(&self.raw_scopes).insert(
            device_id,
            ActiveStream { _capture: capture, stop_flag, consumer_thread: Some(consumer_thread) },
        );
        Ok(())
    }

    #[napi]
    pub fn stop_raw_scope(&self, device_id: String) {
        lock_recovering(&self.raw_scopes).remove(&device_id);
    }
}

impl Default for AudioBridge {
    fn default() -> Self {
        Self::new()
    }
}
