//! The vault: a folder of plain files that is the only source of truth.
//!
//! Every file the app reads or writes goes through [`Vault`], which takes paths relative to the
//! vault root and refuses any that would leave it — `..`, absolute paths, drive prefixes, and
//! links that point outside. Writes are atomic (the old content or the new, never a torn file).

use std::fs;
use std::io::{self, Write};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri_kit_watch::OwnWrites;

/// Folder for form templates.
pub const TEMPLATES_DIR: &str = "서식";
/// Folder for documents filled in from templates.
pub const DOCUMENTS_DIR: &str = "문서";
/// File name suffix that marks a template.
pub const TEMPLATE_SUFFIX: &str = ".fd.md";
/// File name suffix of a document.
pub const DOCUMENT_SUFFIX: &str = ".md";

#[derive(Debug)]
pub enum VaultError {
    /// The path is not a plain relative path inside the vault.
    OutsideVault(String),
    /// A create-only write found a file already there.
    AlreadyExists(String),
    NotFound(String),
    Io(io::Error),
}

impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultError::OutsideVault(p) => write!(f, "path is outside the vault: {p}"),
            VaultError::AlreadyExists(p) => write!(f, "file already exists: {p}"),
            VaultError::NotFound(p) => write!(f, "not found: {p}"),
            VaultError::Io(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for VaultError {}

impl From<io::Error> for VaultError {
    fn from(e: io::Error) -> Self {
        VaultError::Io(e)
    }
}

impl VaultError {
    /// A stable code the UI can branch on.
    pub fn kind(&self) -> &'static str {
        match self {
            VaultError::OutsideVault(_) => "outside-vault",
            VaultError::AlreadyExists(_) => "already-exists",
            VaultError::NotFound(_) => "not-found",
            VaultError::Io(_) => "io",
        }
    }
}

pub type Result<T> = std::result::Result<T, VaultError>;

/// One file in a vault listing. `path` is relative to the vault root and uses `/`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub path: String,
    pub name: String,
    pub modified_ms: u64,
}

#[derive(Debug, Clone)]
pub struct Vault {
    root: PathBuf,
    /// What this app wrote, so the vault watch does not report it back as an outside edit.
    own: OwnWrites,
}

impl Vault {
    /// Opens an existing folder as a vault.
    pub fn open(path: &Path) -> Result<Self> {
        let root = dunce::canonicalize(path).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => VaultError::NotFound(path.display().to_string()),
            _ => VaultError::Io(e),
        })?;
        if !root.is_dir() {
            return Err(VaultError::NotFound(path.display().to_string()));
        }
        Ok(Vault {
            root,
            own: OwnWrites::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The record of this app's own writes, for the vault watch.
    pub fn own_writes(&self) -> &OwnWrites {
        &self.own
    }

    /// Maps a vault-relative path to a location inside the vault, or refuses it.
    pub fn resolve(&self, rel: &str) -> Result<PathBuf> {
        let outside = || VaultError::OutsideVault(rel.to_string());
        let rel_path = Path::new(rel);
        if rel.is_empty() {
            return Err(outside());
        }
        for component in rel_path.components() {
            match component {
                Component::Normal(_) => {}
                // `..`, `.`, a root or a drive prefix never name a place inside the vault.
                _ => return Err(outside()),
            }
        }
        let joined = self.root.join(rel_path);

        // A link inside the vault may point outside it: check where the nearest existing
        // ancestor (or the file itself) really is.
        let mut probe = joined.as_path();
        loop {
            if probe.exists() {
                let real = dunce::canonicalize(probe)?;
                if !real.starts_with(&self.root) {
                    return Err(outside());
                }
                break;
            }
            match probe.parent() {
                Some(parent) => probe = parent,
                None => return Err(outside()),
            }
        }
        Ok(joined)
    }

    /// Lists the files directly inside `dir` whose names end with `suffix`, sorted by path.
    /// A missing folder is an empty listing.
    pub fn list(&self, dir: &str, suffix: &str) -> Result<Vec<Entry>> {
        let abs = self.resolve(dir)?;
        let read = match fs::read_dir(&abs) {
            Ok(read) => read,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut entries = Vec::new();
        for item in read {
            let item = item?;
            let meta = item.metadata()?;
            if !meta.is_file() {
                continue;
            }
            let Some(name) = item.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !name.ends_with(suffix) {
                continue;
            }
            let modified_ms = meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            entries.push(Entry {
                path: format!("{dir}/{name}"),
                name,
                modified_ms,
            });
        }
        entries.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(entries)
    }

    pub fn read(&self, rel: &str) -> Result<String> {
        let abs = self.resolve(rel)?;
        fs::read_to_string(&abs).map_err(|e| match e.kind() {
            io::ErrorKind::NotFound => VaultError::NotFound(rel.to_string()),
            _ => VaultError::Io(e),
        })
    }

    /// Replaces (or creates) a file atomically.
    pub fn write(&self, rel: &str, content: &str) -> Result<()> {
        let abs = self.prepare(rel)?;
        self.own.record(&abs, content.as_bytes());
        tauri_kit_fs::write_atomic(&abs, content.as_bytes())
            .inspect_err(|_| self.own.forget(&abs))?;
        Ok(())
    }

    /// Creates a file atomically, refusing to replace one that is already there.
    pub fn create(&self, rel: &str, content: &str) -> Result<()> {
        let abs = self.prepare(rel)?;
        self.own.record(&abs, content.as_bytes());
        tauri_kit_fs::write_atomic_new(&abs, content.as_bytes()).map_err(|e| {
            self.own.forget(&abs);
            match e.kind() {
                io::ErrorKind::AlreadyExists => VaultError::AlreadyExists(rel.to_string()),
                _ => VaultError::Io(e),
            }
        })
    }

    /// Appends one line to a file, creating it (and its folders) if needed.
    ///
    /// The line and its newline go out in one write and are flushed to disk before this returns.
    /// A crash can still leave a partial last line; readers skip a line they cannot parse.
    /// TODO: move to tauri-kit-fs once a second app needs append-only logs (thin-app procedure 2).
    pub fn append_line(&self, rel: &str, line: &str) -> Result<()> {
        if line.contains(['\n', '\r']) {
            return Err(VaultError::Io(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a line cannot hold a line break",
            )));
        }
        let abs = self.prepare(rel)?;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&abs)?;
        let mut bytes = Vec::with_capacity(line.len() + 1);
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
        file.write_all(&bytes)?;
        file.sync_data()?;
        Ok(())
    }

    fn prepare(&self, rel: &str) -> Result<PathBuf> {
        let abs = self.resolve(rel)?;
        if let Some(parent) = abs.parent() {
            fs::create_dir_all(parent)?;
        }
        // Creating the folders may have followed a link; check again now that they exist.
        self.resolve(rel)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        (dir, vault)
    }

    #[test]
    fn resolves_plain_relative_paths() {
        let (_dir, v) = vault();
        let p = v.resolve("서식/버그 리포트.fd.md").unwrap();
        assert!(p.starts_with(v.root()));
    }

    #[test]
    fn refuses_parent_components() {
        let (_dir, v) = vault();
        for rel in ["..", "../x.md", "서식/../../x.md", "a/../b.md", "./a.md"] {
            assert!(
                matches!(v.resolve(rel), Err(VaultError::OutsideVault(_))),
                "{rel} should be refused"
            );
        }
    }

    #[test]
    fn refuses_absolute_and_empty_paths() {
        let (dir, v) = vault();
        let abs = dir.path().join("a.md");
        for rel in ["", "/a.md", abs.to_str().unwrap()] {
            assert!(
                matches!(v.resolve(rel), Err(VaultError::OutsideVault(_))),
                "{rel:?} should be refused"
            );
        }
        #[cfg(windows)]
        for rel in ["C:\\a.md", "C:a.md", "\\\\server\\share\\a.md"] {
            assert!(
                matches!(v.resolve(rel), Err(VaultError::OutsideVault(_))),
                "{rel:?} should be refused"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn refuses_links_that_leave_the_vault() {
        let (_dir, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), v.root().join("escape")).unwrap();
        assert!(matches!(
            v.resolve("escape/a.md"),
            Err(VaultError::OutsideVault(_))
        ));
        assert!(matches!(
            v.write("escape/a.md", "x"),
            Err(VaultError::OutsideVault(_))
        ));
    }

    #[cfg(windows)]
    #[test]
    fn refuses_junctions_that_leave_the_vault() {
        let (_dir, v) = vault();
        let outside = tempfile::tempdir().unwrap();
        let link = v.root().join("escape");
        // A directory junction needs no privilege, unlike a symbolic link.
        let status = std::process::Command::new("cmd")
            .args(["/C", "mklink", "/J"])
            .arg(&link)
            .arg(outside.path())
            .output()
            .unwrap();
        assert!(status.status.success(), "mklink /J failed");
        assert!(matches!(
            v.resolve("escape/a.md"),
            Err(VaultError::OutsideVault(_))
        ));
        assert!(matches!(
            v.write("escape/a.md", "x"),
            Err(VaultError::OutsideVault(_))
        ));
        assert!(!outside.path().join("a.md").exists());
    }

    #[test]
    fn write_then_read_round_trips_and_creates_folders() {
        let (_dir, v) = vault();
        v.write("서식/a.fd.md", "# A\n\n___@title\n").unwrap();
        assert_eq!(v.read("서식/a.fd.md").unwrap(), "# A\n\n___@title\n");
        v.write("서식/a.fd.md", "# A2\n").unwrap();
        assert_eq!(v.read("서식/a.fd.md").unwrap(), "# A2\n");
    }

    #[test]
    fn create_never_replaces() {
        let (_dir, v) = vault();
        v.create("문서/a.md", "first").unwrap();
        assert!(matches!(
            v.create("문서/a.md", "second"),
            Err(VaultError::AlreadyExists(_))
        ));
        assert_eq!(v.read("문서/a.md").unwrap(), "first");
    }

    #[test]
    fn read_of_missing_file_is_not_found() {
        let (_dir, v) = vault();
        assert!(matches!(
            v.read("문서/none.md"),
            Err(VaultError::NotFound(_))
        ));
    }

    #[test]
    fn list_filters_by_suffix_and_skips_folders() {
        let (_dir, v) = vault();
        assert!(v.list(TEMPLATES_DIR, TEMPLATE_SUFFIX).unwrap().is_empty());
        v.write("서식/b.fd.md", "b").unwrap();
        v.write("서식/a.fd.md", "a").unwrap();
        v.write("서식/notes.md", "n").unwrap();
        fs::create_dir_all(v.root().join("서식/sub.fd.md")).unwrap();
        let names: Vec<_> = v
            .list(TEMPLATES_DIR, TEMPLATE_SUFFIX)
            .unwrap()
            .into_iter()
            .map(|e| e.path)
            .collect();
        assert_eq!(names, ["서식/a.fd.md", "서식/b.fd.md"]);
    }

    #[test]
    fn appends_lines_creating_the_file_and_its_folders() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        vault
            .append_line(".lowline/events/a.jsonl", r#"{"n":1}"#)
            .unwrap();
        vault
            .append_line(".lowline/events/a.jsonl", r#"{"n":2}"#)
            .unwrap();
        let text = fs::read_to_string(dir.path().join(".lowline/events/a.jsonl")).unwrap();
        assert_eq!(text, "{\"n\":1}\n{\"n\":2}\n");
    }

    #[test]
    fn refuses_a_line_with_a_line_break_or_outside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let vault = Vault::open(dir.path()).unwrap();
        assert!(vault.append_line("log.jsonl", "a\nb").is_err());
        assert!(matches!(
            vault.append_line("../log.jsonl", "a"),
            Err(VaultError::OutsideVault(_))
        ));
    }
}
