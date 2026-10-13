//! The keys a person gives the app for a model provider, kept in the system's credential store —
//! never in the vault or the app's settings, and never handed back to the window: it learns only
//! whether one is kept. A development or test build keeps its keys apart from the installed app's.

use serde::Serialize;
use tauri::{AppHandle, Runtime};
use tauri_kit_credentials::{build_kind, Credentials};

/// Why a key could not be kept, read or forgotten.
#[derive(Debug, Serialize)]
pub struct CredentialError {
    /// `invalid` (no such provider name, or an empty key) or `store` (the credential store refused).
    kind: &'static str,
    message: String,
}

impl From<tauri_kit_credentials::Error> for CredentialError {
    fn from(e: tauri_kit_credentials::Error) -> Self {
        CredentialError {
            kind: "store",
            message: e.to_string(),
        }
    }
}

type Result<T> = std::result::Result<T, CredentialError>;

/// The entry a provider's key is kept under. A provider is named as the model settings name it:
/// lower-case letters, digits and hyphens.
fn account(provider: &str) -> Result<String> {
    let named = !provider.is_empty()
        && provider.len() <= 32
        && provider
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if named {
        Ok(format!("model-key:{provider}"))
    } else {
        Err(CredentialError {
            kind: "invalid",
            message: format!("not a provider name: {provider:?}"),
        })
    }
}

fn credentials<R: Runtime>(app: &AppHandle<R>) -> Credentials {
    Credentials::new(&app.config().identifier, build_kind!())
}

fn kept(credentials: &Credentials, provider: &str) -> Result<bool> {
    Ok(credentials.contains(&account(provider)?)?)
}

fn keep(credentials: &Credentials, provider: &str, key: &str) -> Result<()> {
    let account = account(provider)?;
    let key = key.trim();
    if key.is_empty() {
        return Err(CredentialError {
            kind: "invalid",
            message: "an empty key".into(),
        });
    }
    Ok(credentials.set(&account, key)?)
}

fn forget(credentials: &Credentials, provider: &str) -> Result<()> {
    Ok(credentials.delete(&account(provider)?)?)
}

/// Whether a key is kept for `provider`.
#[tauri::command]
pub fn model_key_kept(app: AppHandle, provider: String) -> Result<bool> {
    kept(&credentials(&app), &provider)
}

/// Keeps `key` for `provider`, replacing any earlier one.
#[tauri::command]
pub fn keep_model_key(app: AppHandle, provider: String, key: String) -> Result<()> {
    keep(&credentials(&app), &provider, &key)
}

/// Forgets the key kept for `provider`, if any.
#[tauri::command]
pub fn forget_model_key(app: AppHandle, provider: String) -> Result<()> {
    forget(&credentials(&app), &provider)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Once;

    fn store() -> Credentials {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap())
        });
        Credentials::new("com.iyulab.lowline", build_kind!())
    }

    #[test]
    fn a_test_build_keeps_its_keys_apart_from_the_installed_apps() {
        assert_eq!(store().service(), "com.iyulab.lowline.test");
    }

    #[test]
    fn keeps_replaces_and_forgets_a_providers_key_saying_only_whether_one_is_kept() {
        let credentials = store();
        assert!(!kept(&credentials, "openai").unwrap());
        keep(&credentials, "openai", " sk-first ").unwrap();
        keep(&credentials, "openai", "sk-second").unwrap();
        assert!(kept(&credentials, "openai").unwrap());
        assert_eq!(
            credentials.get("model-key:openai").unwrap().as_deref(),
            Some("sk-second")
        );
        assert!(!kept(&credentials, "anthropic").unwrap());
        forget(&credentials, "openai").unwrap();
        assert!(!kept(&credentials, "openai").unwrap());
        forget(&credentials, "openai").unwrap(); // forgetting what is not kept is no error
    }

    #[test]
    fn refuses_a_name_that_is_no_provider_and_an_empty_key() {
        let credentials = store();
        for name in ["", "OpenAI", "a/b", "model key", &"x".repeat(33)] {
            assert_eq!(
                kept(&credentials, name).unwrap_err().kind,
                "invalid",
                "{name:?}"
            );
        }
        assert_eq!(
            keep(&credentials, "ollama", "  ").unwrap_err().kind,
            "invalid"
        );
        assert!(!kept(&credentials, "ollama").unwrap());
    }
}
