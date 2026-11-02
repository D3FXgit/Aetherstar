//! Ref-counted per-device channel-subscription bookkeeping. Pure and
//! `cpal`-independent, so it is unit-testable without audio hardware.
//!
//! One physical device can have several concurrent channel subscriptions
//! (e.g. a 4-channel interface serving 4 players); the underlying `cpal`
//! stream should only be opened once (on the first subscriber) and torn
//! down once (on the last).

use std::collections::{HashMap, HashSet};

#[derive(Default)]
pub struct ChannelRegistry {
    devices: HashMap<String, HashSet<u32>>,
}

impl ChannelRegistry {
    pub fn new() -> Self {
        Self { devices: HashMap::new() }
    }

    /// Registers a channel subscription for `device_id`. Returns `true` when
    /// this is the *first* subscriber for that device -- the caller must open
    /// the underlying `cpal` stream in that case.
    pub fn register(&mut self, device_id: &str, channel_index: u32) -> bool {
        let channels = self.devices.entry(device_id.to_string()).or_default();
        let is_first = channels.is_empty();
        channels.insert(channel_index);
        is_first
    }

    /// Unregisters a channel subscription. Returns `true` when this was the
    /// *last* subscriber for that device -- the caller must tear down the
    /// underlying `cpal` stream in that case.
    pub fn unregister(&mut self, device_id: &str, channel_index: u32) -> bool {
        let Some(channels) = self.devices.get_mut(device_id) else { return false };
        channels.remove(&channel_index);
        if channels.is_empty() {
            self.devices.remove(device_id);
            true
        } else {
            false
        }
    }

    #[allow(dead_code)] // exercised by tests; a diagnostic accessor, not yet consumed by AudioBridge itself
    pub fn active_channels(&self, device_id: &str) -> Vec<u32> {
        let mut channels: Vec<u32> = self.devices.get(device_id).map(|set| set.iter().copied().collect()).unwrap_or_default();
        channels.sort_unstable();
        channels
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_registration_for_a_device_reports_true() {
        let mut registry = ChannelRegistry::new();
        assert!(registry.register("dev-1", 0));
    }

    #[test]
    fn second_registration_for_the_same_device_reports_false() {
        let mut registry = ChannelRegistry::new();
        registry.register("dev-1", 0);
        assert!(!registry.register("dev-1", 1));
    }

    #[test]
    fn a_different_device_gets_its_own_first_registration() {
        let mut registry = ChannelRegistry::new();
        registry.register("dev-1", 0);
        assert!(registry.register("dev-2", 0));
    }

    #[test]
    fn unregister_reports_false_while_other_channels_remain_active() {
        let mut registry = ChannelRegistry::new();
        registry.register("dev-1", 0);
        registry.register("dev-1", 1);
        assert!(!registry.unregister("dev-1", 0));
    }

    #[test]
    fn unregister_reports_true_once_the_last_channel_is_removed() {
        let mut registry = ChannelRegistry::new();
        registry.register("dev-1", 0);
        registry.register("dev-1", 1);
        registry.unregister("dev-1", 0);
        assert!(registry.unregister("dev-1", 1));
    }

    #[test]
    fn unregistering_an_unknown_device_or_channel_is_a_safe_no_op() {
        let mut registry = ChannelRegistry::new();
        assert!(!registry.unregister("dev-1", 0));

        registry.register("dev-1", 0);
        assert!(!registry.unregister("dev-1", 99));
    }

    #[test]
    fn active_channels_reflects_exactly_whats_registered() {
        let mut registry = ChannelRegistry::new();
        assert_eq!(registry.active_channels("dev-1"), Vec::<u32>::new());

        registry.register("dev-1", 2);
        registry.register("dev-1", 0);
        assert_eq!(registry.active_channels("dev-1"), vec![0, 2]);

        registry.unregister("dev-1", 0);
        assert_eq!(registry.active_channels("dev-1"), vec![2]);
    }

    #[test]
    fn re_registering_the_same_channel_index_does_not_report_first_again() {
        let mut registry = ChannelRegistry::new();
        registry.register("dev-1", 0);
        assert!(!registry.register("dev-1", 0));
    }

    #[test]
    fn registers_eight_channels_on_one_device_all_active_and_first_only_on_the_first() {
        let mut registry = ChannelRegistry::new();

        for channel_index in 0..8u32 {
            let is_first = registry.register("dev-1", channel_index);
            assert_eq!(is_first, channel_index == 0, "channel {channel_index} first-flag mismatch");
        }

        assert_eq!(registry.active_channels("dev-1"), (0..8u32).collect::<Vec<u32>>());

        for channel_index in 0..7u32 {
            assert!(!registry.unregister("dev-1", channel_index), "channel {channel_index} should not report last");
        }
        assert!(registry.unregister("dev-1", 7), "the final channel should report last");
    }
}
