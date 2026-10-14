use tauri::WebviewWindow;

pub fn cursor_position(window: &WebviewWindow) -> Result<tauri::PhysicalPosition<f64>, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window;
        // Both CoreGraphics capture and Tao's monitor_from_point expect global
        // logical coordinates on macOS, unlike Windows' physical coordinates.
        let event =
            objc2_core_graphics::CGEvent::new(None).ok_or("Posizione cursore non disponibile.")?;
        let point = objc2_core_graphics::CGEvent::location(Some(&event));
        Ok(tauri::PhysicalPosition::new(point.x, point.y))
    }
    #[cfg(not(target_os = "macos"))]
    window.cursor_position().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
static PREVIOUS_WINDOW: std::sync::atomic::AtomicIsize = std::sync::atomic::AtomicIsize::new(0);

pub fn remember_focus() {
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        // A handle is kept only as an identifier and validated by Windows on activation.
        PREVIOUS_WINDOW.store(
            unsafe { GetForegroundWindow() }.0 as isize,
            Ordering::Relaxed,
        );
    }
}

pub fn has_foreground_focus(window: &WebviewWindow) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
        let handle = window.hwnd().map_err(|e| e.to_string())?;
        Ok(unsafe { GetForegroundWindow() }.0 == handle.0)
    }
    #[cfg(not(target_os = "windows"))]
    window.is_focused().map_err(|e| e.to_string())
}

pub fn restore_focus(overlay_was_focused: bool) {
    #[cfg(not(target_os = "windows"))]
    let _ = overlay_was_focused;
    #[cfg(target_os = "windows")]
    {
        use std::sync::atomic::Ordering;
        use windows::Win32::{
            Foundation::HWND,
            UI::WindowsAndMessaging::{IsWindow, SetForegroundWindow},
        };
        let raw = PREVIOUS_WINDOW.swap(0, Ordering::Relaxed);
        if raw != 0 && overlay_was_focused {
            let hwnd = HWND(raw as *mut std::ffi::c_void);
            unsafe {
                if IsWindow(Some(hwnd)).as_bool() && !SetForegroundWindow(hwnd).as_bool() {
                    eprintln!("Windows non ha concesso il ripristino del focus.");
                }
            }
        }
    }
}

pub fn configure(window: &WebviewWindow) -> Result<(), String> {
    window.set_always_on_top(true).map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    {
        window
            .set_visible_on_all_workspaces(true)
            .map_err(|e| e.to_string())?;
        let native_window = window.clone();
        window
            .run_on_main_thread(move || {
                let result = (|| -> Result<(), String> {
                    let pointer = native_window.ns_window().map_err(|e| e.to_string())?;
                    unsafe {
                        use objc2_app_kit::{NSWindow, NSWindowCollectionBehavior};
                        let native = &*(pointer as *const NSWindow);
                        let behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
                            | NSWindowCollectionBehavior::FullScreenAuxiliary;
                        native.setCollectionBehavior(behavior);
                        native.setLevel(25);
                    }
                    Ok(())
                })();
                if let Err(error) = result {
                    crate::overlay::report(tauri::Manager::app_handle(&native_window), error);
                }
            })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
