//! The app's window shows the app's own pages and nothing else.
//!
//! Template and document bodies come from the vault, and a vault is written by other people and
//! other programs: a link in a template's instructions is an ordinary thing to find there. Followed
//! inside the app's window, it would replace the app — and whatever was typed and not yet saved —
//! with a page the window has no way back from. So the window refuses to leave the app's pages and
//! to open windows of its own, and tells the screen what it refused, so the person is not left
//! with a click that did nothing. A link the person clicks is opened outside instead — in the
//! system's browser or mail app — when it is to the web or to mail ([`opens_outside`]).

use tauri::{AppHandle, Emitter, Url};

/// What the screen is told when the window refuses to go to an address.
pub const REFUSED: &str = "navigation-refused";

/// Whether `to` is one of the app's own pages: the bundled pages the app is served from, or the
/// development server while the app runs from it.
pub fn is_app_page(to: &Url, dev_url: Option<&Url>) -> bool {
    match to.scheme() {
        // macOS and Linux serve the bundled pages under the app's own scheme.
        "tauri" => to.host_str() == Some("localhost"),
        // Windows serves them from a host of its own, over http or https.
        "http" | "https" => {
            to.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == to.origin())
        }
        _ => false,
    }
}

/// Whether a link to `to` may be opened in the system's own app for it: the web and mail. A link
/// to anything else — a file, a program, another app's scheme — is not opened from a body someone
/// else wrote.
pub fn opens_outside(to: &Url) -> bool {
    matches!(to.scheme(), "http" | "https" | "mailto")
}

/// Lets the window go to `to` when it is one of the app's own pages; otherwise refuses and tells
/// the screen which address was refused.
pub fn allow(app: &AppHandle, to: &Url, dev_url: Option<&Url>) -> bool {
    if is_app_page(to, dev_url) {
        return true;
    }
    let _ = app.emit(REFUSED, to.as_str());
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn the_bundled_pages_are_the_apps_own() {
        assert!(is_app_page(&url("tauri://localhost/index.html"), None));
        assert!(is_app_page(&url("http://tauri.localhost/"), None));
        assert!(is_app_page(
            &url("https://tauri.localhost/#documents"),
            None
        ));
    }

    #[test]
    fn the_development_server_is_the_apps_own_only_while_the_app_runs_from_it() {
        let dev = url("http://localhost:1420");
        assert!(is_app_page(
            &url("http://localhost:1420/src/main.ts"),
            Some(&dev)
        ));
        assert!(!is_app_page(&url("http://localhost:1420/"), None));
        assert!(!is_app_page(&url("http://localhost:8080/"), Some(&dev)));
    }

    #[test]
    fn any_other_address_is_not() {
        for to in [
            "https://example.com/",
            "http://localhost/",
            "https://tauri.localhost.example.com/",
            "tauri://example.com/",
            "file:///C:/Windows/notepad.exe",
            "javascript:alert(1)",
            "data:text/html,<p>x</p>",
            "mailto:someone@example.com",
            "about:blank",
        ] {
            assert!(!is_app_page(&url(to), None), "{to}");
        }
    }

    #[test]
    fn only_the_web_and_mail_are_opened_outside() {
        for to in [
            "https://example.com/",
            "http://example.com/a?b=c",
            "mailto:someone@example.com",
        ] {
            assert!(opens_outside(&url(to)), "{to}");
        }
        for to in [
            "file:///C:/Windows/notepad.exe",
            "javascript:alert(1)",
            "data:text/html,<p>x</p>",
            "ms-settings:privacy",
            "tauri://localhost/",
            "about:blank",
        ] {
            assert!(!opens_outside(&url(to)), "{to}");
        }
    }
}
