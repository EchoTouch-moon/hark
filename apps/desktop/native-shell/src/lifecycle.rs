/// Window-close policy for this shell. There is no sidecar to reap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WindowCloseDecision {
    /// Close button hides the window. The process keeps the Core database open.
    HideToTray,
    /// Explicit quit (tray or `quit_app`) may destroy the window and exit.
    AllowQuit,
}

pub fn decide_window_close(quit_requested: bool) -> WindowCloseDecision {
    if quit_requested {
        WindowCloseDecision::AllowQuit
    } else {
        WindowCloseDecision::HideToTray
    }
}
