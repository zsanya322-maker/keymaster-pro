use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy)]
struct ClickStamp {
    at: Instant,
    x: i32,
    y: i32,
}

/// Detects a second physical button-down within the configured Windows
/// double-click time/rectangle. It never sleeps and therefore never blocks the
/// low-level hook while waiting for a possible second click.
#[derive(Debug, Default)]
pub struct DoubleClickDetector {
    last_down: HashMap<u8, ClickStamp>,
}

impl DoubleClickDetector {
    pub fn register_down(
        &mut self,
        button: u8,
        x: i32,
        y: i32,
        now: Instant,
        max_interval: Duration,
        max_dx: i32,
        max_dy: i32,
    ) -> bool {
        let matched = self.last_down.get(&button).is_some_and(|previous| {
            now.saturating_duration_since(previous.at) <= max_interval
                && (x - previous.x).abs() <= max_dx
                && (y - previous.y).abs() <= max_dy
        });

        if matched {
            // Consume the pair in detector state. A third click starts a new pair
            // instead of repeatedly firing on clicks 2+3, 3+4, ...
            self.last_down.remove(&button);
            true
        } else {
            self.last_down.insert(button, ClickStamp { at: now, x, y });
            false
        }
    }

    pub fn clear(&mut self) {
        self.last_down.clear();
    }
}

/// Converts a wheel delta + axis into the compact EngineSchema key.
/// 1=up, -1=down, 2=right, -2=left.
pub fn wheel_key(delta: i32, horizontal: bool) -> Option<i8> {
    if delta == 0 {
        return None;
    }
    Some(match (horizontal, delta.is_positive()) {
        (false, true) => 1,
        (false, false) => -1,
        (true, true) => 2,
        (true, false) => -2,
    })
}

#[derive(Debug, Clone, Copy, Default)]
pub struct MoveGate {
    anchor: Option<(i32, i32)>,
    last_fire: Option<Instant>,
}

impl MoveGate {
    /// Returns true once movement from the last accepted anchor reaches the
    /// configured Euclidean threshold and cooldown has elapsed. No sleeps or
    /// expensive platform calls occur in this path.
    pub fn should_fire(
        &mut self,
        x: i32,
        y: i32,
        now: Instant,
        min_distance: u16,
        cooldown: Duration,
    ) -> bool {
        let Some((ax, ay)) = self.anchor else {
            self.anchor = Some((x, y));
            return false;
        };

        let dx = i64::from(x - ax);
        let dy = i64::from(y - ay);
        let threshold = i64::from(min_distance.max(1));
        if dx * dx + dy * dy < threshold * threshold {
            return false;
        }

        if self
            .last_fire
            .is_some_and(|last| now.saturating_duration_since(last) < cooldown)
        {
            return false;
        }

        self.anchor = Some((x, y));
        self.last_fire = Some(now);
        true
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }
}

#[cfg(target_os = "windows")]
pub fn system_double_click_limits() -> (Duration, i32, i32) {
    use std::sync::LazyLock;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetSystemMetrics, SM_CXDOUBLECLK, SM_CYDOUBLECLK,
    };

    static LIMITS: LazyLock<(Duration, i32, i32)> = LazyLock::new(|| unsafe {
        let interval = Duration::from_millis(u64::from(GetDoubleClickTime()));
        // GetSystemMetrics returns the full rectangle dimensions. Compare each
        // coordinate against half of it around the first click.
        let dx = (GetSystemMetrics(SM_CXDOUBLECLK) / 2).max(1);
        let dy = (GetSystemMetrics(SM_CYDOUBLECLK) / 2).max(1);
        (interval, dx, dy)
    });
    *LIMITS
}

#[cfg(not(target_os = "windows"))]
pub fn system_double_click_limits() -> (Duration, i32, i32) {
    (Duration::from_millis(500), 4, 4)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wheel_sign_and_axis_are_distinct() {
        assert_eq!(wheel_key(120, false), Some(1));
        assert_eq!(wheel_key(-120, false), Some(-1));
        assert_eq!(wheel_key(120, true), Some(2));
        assert_eq!(wheel_key(-120, true), Some(-2));
        assert_eq!(wheel_key(0, true), None);
    }

    #[test]
    fn double_click_respects_time_and_rectangle_boundaries() {
        let base = Instant::now();
        let mut detector = DoubleClickDetector::default();
        assert!(!detector.register_down(
            1,
            100,
            100,
            base,
            Duration::from_millis(500),
            4,
            4,
        ));
        assert!(detector.register_down(
            1,
            104,
            96,
            base + Duration::from_millis(500),
            Duration::from_millis(500),
            4,
            4,
        ));

        // Pair was consumed: a third click is the start of a new pair.
        assert!(!detector.register_down(
            1,
            104,
            96,
            base + Duration::from_millis(510),
            Duration::from_millis(500),
            4,
            4,
        ));
        assert!(!detector.register_down(
            1,
            120,
            120,
            base + Duration::from_millis(520),
            Duration::from_millis(500),
            4,
            4,
        ));
        assert!(!detector.register_down(
            1,
            120,
            120,
            base + Duration::from_millis(1_100),
            Duration::from_millis(500),
            4,
            4,
        ));
    }

    #[test]
    fn double_click_state_is_per_button() {
        let base = Instant::now();
        let mut detector = DoubleClickDetector::default();
        assert!(!detector.register_down(1, 0, 0, base, Duration::from_secs(1), 5, 5));
        assert!(!detector.register_down(2, 0, 0, base, Duration::from_secs(1), 5, 5));
        assert!(detector.register_down(1, 0, 0, base + Duration::from_millis(10), Duration::from_secs(1), 5, 5));
        assert!(detector.register_down(2, 0, 0, base + Duration::from_millis(20), Duration::from_secs(1), 5, 5));
    }

    #[test]
    fn movement_gate_honors_distance_and_cooldown() {
        let base = Instant::now();
        let mut gate = MoveGate::default();
        assert!(!gate.should_fire(0, 0, base, 10, Duration::from_millis(100)));
        assert!(!gate.should_fire(6, 6, base + Duration::from_millis(1), 10, Duration::from_millis(100)));
        assert!(gate.should_fire(10, 0, base + Duration::from_millis(2), 10, Duration::from_millis(100)));
        assert!(!gate.should_fire(20, 0, base + Duration::from_millis(50), 10, Duration::from_millis(100)));
        assert!(gate.should_fire(20, 0, base + Duration::from_millis(102), 10, Duration::from_millis(100)));
    }
}
