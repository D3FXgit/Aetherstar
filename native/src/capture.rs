//! `cpal` device enumeration and stream lifecycle, sample-format conversion to
//! `f32`, and multi-channel de-interleave.
//!
//! There is no resampling step any more: pitch detection runs at the device's
//! own rate (see pitch.rs). The old per-window `rubato` resample built a fresh
//! sinc resampler -- and its 128x128 interpolation table -- for every window
//! of every channel, and on failure fell back to analysing native-rate audio
//! as if it were 48 kHz, which reads ~147 cents sharp on a 44.1 kHz device.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

/// Converted samples handed to the callback per call for non-`f32` devices.
/// Allocated once when the stream opens; a callback larger than this is
/// converted and delivered in whole-frame pieces rather than by allocating on
/// the audio thread. 32k samples is 4096 frames of 8 channels.
const CONVERT_SCRATCH_SAMPLES: usize = 1 << 15;

#[derive(Clone, Debug, PartialEq)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub channel_count: u16,
    pub sample_rate: u32,
}

/// Enumerates input devices on the default host. Never panics -- a device
/// whose name/config can't be read is skipped rather than failing the whole
/// list, since a bad optional-input device shouldn't hide every other one.
pub fn list_devices() -> Vec<AudioDeviceInfo> {
    let host = cpal::default_host();
    let Ok(input_devices) = host.input_devices() else {
        return Vec::new();
    };

    input_devices
        .filter_map(|device| {
            let name = device.description().ok()?.name().to_string();
            let id = device.id().ok()?.id().to_string();
            let config = device.default_input_config().ok()?;
            Some(AudioDeviceInfo {
                id,
                name,
                channel_count: config.channels(),
                sample_rate: config.sample_rate(),
            })
        })
        .collect()
}

/// Copies one channel out of an interleaved multi-channel buffer into `out`
/// (cleared first, its allocation reused), so a multi-channel interface's
/// channels can be treated as independent mono inputs.
///
/// Only the channels somebody is actually singing into get extracted -- the
/// consumer calls this once per subscription, into one reused buffer, instead
/// of splitting every channel into fresh `Vec`s for every window.
pub fn extract_channel(samples: &[f32], channel_count: usize, channel_index: usize, out: &mut Vec<f32>) {
    out.clear();
    if channel_count == 0 || channel_index >= channel_count {
        return;
    }
    out.extend(samples.iter().skip(channel_index).step_by(channel_count).copied());
}

fn i16_to_f32(sample: i16) -> f32 {
    sample as f32 / 32_768.0
}

fn i32_to_f32(sample: i32) -> f32 {
    (sample as f64 / 2_147_483_648.0) as f32
}

fn u16_to_f32(sample: u16) -> f32 {
    (sample as f32 - 32_768.0) / 32_768.0
}

/// Converts integer-format input buffers to `f32` on the audio thread without
/// allocating: the scratch buffer is sized once, up front, and a callback that
/// is bigger than it is delivered in whole-frame pieces.
struct FormatConverter {
    scratch: Vec<f32>,
    /// Samples per piece: the largest whole number of frames that fits.
    piece: usize,
}

impl FormatConverter {
    fn new(channel_count: u16) -> Self {
        let channels = (channel_count as usize).max(1);
        let piece = (CONVERT_SCRATCH_SAMPLES / channels).max(1) * channels;
        Self { scratch: vec![0.0; piece], piece }
    }

    fn convert<T: Copy, C: FnMut(&[f32])>(&mut self, data: &[T], to_f32: fn(T) -> f32, on_samples: &mut C) {
        for block in data.chunks(self.piece) {
            for (dst, &src) in self.scratch.iter_mut().zip(block) {
                *dst = to_f32(src);
            }
            on_samples(&self.scratch[..block.len()]);
        }
    }
}

/// Owns a live `cpal` input stream; dropping it stops capture (state is
/// instance-owned so `stopCapture`/hot-unplug cleanup is just `Drop`).
pub struct CaptureStream {
    _stream: cpal::Stream,
    pub sample_rate: u32,
    pub channel_count: u16,
}

/// Opens a stream against the current default input device, calling
/// `on_samples` with each raw (not yet resampled/de-interleaved) buffer the
/// OS delivers. Returns `Ok(None)` when there is no default input device
/// available in this environment (e.g. a headless CI/sandbox) rather than
/// erroring -- device-specific behavior is only meaningfully verified against
/// real hardware, by hand.
#[allow(dead_code)] // exercised by tests; not yet wired into AudioBridge, which always targets a specific device id
pub fn start_default_input_capture<F, E>(on_samples: F, on_error: E) -> Result<Option<CaptureStream>, String>
where
    F: FnMut(&[f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let host = cpal::default_host();
    let Some(device) = host.default_input_device() else {
        return Ok(None);
    };
    build_and_play_stream(&device, |_config| on_samples, on_error).map(Some)
}

/// Opens a stream against a specific input device, matched by the same `id`
/// [`list_devices`] reports. Returns `Ok(None)` when no currently-enumerated
/// device has that id (e.g. it was unplugged between listing and starting).
#[allow(dead_code)] // AudioBridge now always sizes its rings from the real config via the `_with` form
pub fn start_input_capture_for_device<F, E>(device_id: &str, on_samples: F, on_error: E) -> Result<Option<CaptureStream>, String>
where
    F: FnMut(&[f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    start_input_capture_for_device_with(device_id, |_config| on_samples, on_error)
}

/// The sample rate and channel count of a capture that is about to open.
///
/// Handed to the callback *factory* below because a caller that needs to know
/// the device's real layout -- live monitoring has to de-interleave, so it
/// does -- can otherwise only learn it after the callback closure has already
/// been moved into the stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CaptureConfig {
    pub sample_rate: u32,
    pub channel_count: u16,
}

/// [`start_input_capture_for_device`], but the sample callback is *built* from
/// the device's real [`CaptureConfig`] rather than having to be complete before
/// the device is opened.
///
/// This is the only reason `build_and_play_stream` takes a factory: the
/// alternative is a callback that reads the channel count out of a shared cell
/// on every buffer, on the audio thread, to learn something that is fixed for
/// the life of the stream.
pub fn start_input_capture_for_device_with<Make, F, E>(
    device_id: &str,
    make_callback: Make,
    on_error: E,
) -> Result<Option<CaptureStream>, String>
where
    Make: FnOnce(CaptureConfig) -> F,
    F: FnMut(&[f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let host = cpal::default_host();
    let Ok(mut input_devices) = host.input_devices() else {
        return Ok(None);
    };
    let Some(device) = input_devices.find(|device| device.id().map(|id| id.id() == device_id).unwrap_or(false)) else {
        return Ok(None);
    };
    build_and_play_stream(&device, make_callback, on_error).map(Some)
}

fn build_and_play_stream<Make, F, E>(device: &cpal::Device, make_callback: Make, mut on_error: E) -> Result<CaptureStream, String>
where
    Make: FnOnce(CaptureConfig) -> F,
    F: FnMut(&[f32]) + Send + 'static,
    E: FnMut(String) + Send + 'static,
{
    let supported_config = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_format = supported_config.sample_format();
    let stream_config: cpal::StreamConfig = supported_config.into();
    let sample_rate = stream_config.sample_rate;
    let channel_count = stream_config.channels;
    let mut on_samples = make_callback(CaptureConfig { sample_rate, channel_count });

    // cpal has no cross-platform hot-plug event API, but a device disappearing
    // mid-stream does reliably fire this error callback -- the main-process
    // relay wires it into the same "device list changed" signal a hot-plug
    // poll would produce.
    let err_fn = move |err: cpal::Error| on_error(err.to_string());

    // Many USB interfaces and Windows/Linux backends default to integer
    // formats. Those are converted to f32 into a scratch buffer allocated
    // here, once -- never on the audio thread.
    let stream = match sample_format {
        cpal::SampleFormat::F32 => device.build_input_stream(
            stream_config,
            move |data: &[f32], _: &cpal::InputCallbackInfo| on_samples(data),
            err_fn,
            None,
        ),
        cpal::SampleFormat::I16 => {
            let mut converter = FormatConverter::new(channel_count);
            device.build_input_stream(
                stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| converter.convert(data, i16_to_f32, &mut on_samples),
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::I32 => {
            let mut converter = FormatConverter::new(channel_count);
            device.build_input_stream(
                stream_config,
                move |data: &[i32], _: &cpal::InputCallbackInfo| converter.convert(data, i32_to_f32, &mut on_samples),
                err_fn,
                None,
            )
        }
        cpal::SampleFormat::U16 => {
            let mut converter = FormatConverter::new(channel_count);
            device.build_input_stream(
                stream_config,
                move |data: &[u16], _: &cpal::InputCallbackInfo| converter.convert(data, u16_to_f32, &mut on_samples),
                err_fn,
                None,
            )
        }
        other => return Err(format!("unsupported input sample format: {other:?}")),
    }
    .map_err(|e| e.to_string())?;

    stream.play().map_err(|e| e.to_string())?;
    Ok(CaptureStream { _stream: stream, sample_rate, channel_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pitch::PitchDetector;
    use crate::test_support::{assert_within_cents, synth_sine};

    #[test]
    fn list_devices_never_panics_and_returns_well_formed_entries() {
        // Which devices exist is hardware-dependent and checked by hand --
        // this only asserts the function is safe to call and every
        // entry it does return is well-formed.
        for device in list_devices() {
            assert!(!device.name.is_empty());
            assert!(device.sample_rate > 0);
        }
    }

    #[test]
    fn extract_channel_pulls_one_lane_in_order() {
        let interleaved = vec![1.0, 10.0, 2.0, 20.0, 3.0, 30.0];
        let mut out = Vec::new();
        extract_channel(&interleaved, 2, 0, &mut out);
        assert_eq!(out, vec![1.0, 2.0, 3.0]);
        extract_channel(&interleaved, 2, 1, &mut out);
        assert_eq!(out, vec![10.0, 20.0, 30.0], "the buffer is cleared, not appended to");
    }

    /// A stale channel index -- a device reconfigured to fewer channels --
    /// yields an empty channel the consumer skips, never a panic.
    #[test]
    fn extract_channel_out_of_range_is_empty() {
        let mut out = vec![9.0];
        extract_channel(&[1.0, 2.0], 2, 5, &mut out);
        assert!(out.is_empty());
        extract_channel(&[1.0, 2.0], 0, 0, &mut out);
        assert!(out.is_empty());
    }

    /// The replacement for the old resample-then-detect path: a 44.1 kHz
    /// device's channel goes straight to the detector at its own rate and
    /// must read true (the old fallback read it ~147 cents sharp).
    #[test]
    fn a_native_rate_channel_reads_true_pitch_without_resampling() {
        let input_rate = 44_100;
        let freq = 440.0;
        let n = PitchDetector::required_samples(input_rate);
        let mono = synth_sine(freq, input_rate, n);
        let interleaved: Vec<f32> = mono.iter().flat_map(|&s| [0.0, s]).collect();

        let mut lane = Vec::new();
        extract_channel(&interleaved, 2, 1, &mut lane);
        let mut detector = PitchDetector::new();
        let result = detector.analyze(&lane, input_rate).pitch.expect("should detect a pitch at the device rate");
        assert_within_cents(result.hz, freq, 5.0);
    }

    #[test]
    fn integer_formats_convert_to_unit_range_floats() {
        assert_eq!(i16_to_f32(0), 0.0);
        assert_eq!(i16_to_f32(i16::MIN), -1.0);
        assert!((i16_to_f32(i16::MAX) - 1.0).abs() < 1e-4);
        assert_eq!(i32_to_f32(0), 0.0);
        assert_eq!(i32_to_f32(i32::MIN), -1.0);
        assert!((i32_to_f32(i32::MAX) - 1.0).abs() < 1e-6);
        assert_eq!(u16_to_f32(32_768), 0.0);
        assert_eq!(u16_to_f32(0), -1.0);
        assert!((u16_to_f32(u16::MAX) - 1.0).abs() < 1e-4);
    }

    /// A callback bigger than the scratch buffer is delivered in pieces -- each
    /// a whole number of frames, so no piece ever splits a frame -- and every
    /// sample arrives, converted, in order.
    #[test]
    fn format_converter_delivers_big_callbacks_in_whole_frame_pieces() {
        let channels: u16 = 3;
        let mut converter = FormatConverter::new(channels);
        let piece = converter.piece;
        assert_eq!(piece % channels as usize, 0);

        let input: Vec<i16> = (0..(piece * 2 + 3 * 5)).map(|i| (i % 30_000) as i16).collect();
        let mut received: Vec<f32> = Vec::new();
        let mut calls = 0;
        converter.convert(&input, i16_to_f32, &mut |chunk: &[f32]| {
            assert_eq!(chunk.len() % channels as usize, 0, "a piece split a frame");
            received.extend_from_slice(chunk);
            calls += 1;
        });

        assert_eq!(calls, 3);
        let expected: Vec<f32> = input.iter().map(|&s| i16_to_f32(s)).collect();
        assert_eq!(received, expected);
    }

    #[test]
    fn start_and_stop_default_input_capture_round_trips_without_panicking() {
        match start_default_input_capture(|_samples| {}, |_err| {}) {
            Ok(Some(stream)) => drop(stream), // dropping stops the stream
            Ok(None) => eprintln!("no default input device in this environment -- skipping hardware-dependent assertion"),
            Err(e) => eprintln!("capture stream unavailable in this environment ({e}) -- skipping"),
        }
    }
}
