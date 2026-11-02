//! Synthetic-signal helpers for `cargo test` only: tests generate their sine
//! waves instead of committing audio fixtures.
#![cfg(test)]

use std::f32::consts::PI;

pub fn synth_sine(freq: f32, sample_rate: u32, num_samples: usize) -> Vec<f32> {
    (0..num_samples).map(|i| (2.0 * PI * freq * i as f32 / sample_rate as f32).sin()).collect()
}

pub fn cents_difference(actual_hz: f32, expected_hz: f32) -> f32 {
    1200.0 * (actual_hz / expected_hz).log2()
}

pub fn assert_within_cents(actual_hz: f32, expected_hz: f32, max_cents: f32) {
    let cents = cents_difference(actual_hz, expected_hz).abs();
    assert!(
        cents <= max_cents,
        "expected {expected_hz} Hz, got {actual_hz} Hz ({cents:.2} cents off, budget {max_cents})"
    );
}
