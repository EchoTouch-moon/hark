use crate::error::{CoreError, ErrorCode, Result};
use crate::limits::MAX_RELATIVE_PATH_CHARS;

const SENSITIVE_EXACT: &[&str] = &[
    ".ssh",
    ".gnupg",
    ".aws",
    ".kube",
    ".docker",
    ".netrc",
    ".npmrc",
    ".pypirc",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    "credentials.json",
    "secrets.json",
];

const ARTIFACT_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    "coverage",
    "__pycache__",
    ".venv",
    "venv",
    "vendor",
    ".git",
    ".hg",
    ".svn",
    "pods",
    "deriveddata",
];

const MANIFESTS: &[&str] = &[
    "package.json",
    "cargo.toml",
    "pyproject.toml",
    "go.mod",
    "go.work",
    "pnpm-workspace.yaml",
    "composer.json",
    "gemfile",
    "nx.json",
    "turbo.json",
    "lerna.json",
    "pom.xml",
];

const KEY_FILES: &[&str] = &[
    "readme.md",
    "readme.txt",
    "readme",
    "package.json",
    "cargo.toml",
    "pyproject.toml",
    "go.mod",
    "agents.md",
    "architecture.md",
];

pub fn is_sensitive_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    SENSITIVE_EXACT.contains(&n.as_str())
        || n.starts_with(".env")
        || n.ends_with(".pem")
        || n.ends_with(".key")
        || n.ends_with(".p12")
        || n.ends_with(".pfx")
        || n.ends_with(".kdbx")
        || n.ends_with(".keychain")
        || n.ends_with(".keychain-db")
}

pub fn is_artifact_dir(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    ARTIFACT_DIRS.contains(&n.as_str())
}

pub fn is_manifest_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    MANIFESTS.contains(&n.as_str())
}

pub fn is_key_file(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    KEY_FILES.contains(&n.as_str())
}

pub fn is_monorepo_marker_name(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    matches!(
        n.as_str(),
        "pnpm-workspace.yaml" | "go.work" | "nx.json" | "turbo.json" | "lerna.json"
    )
}

/// Relative path only. Rejects absolute paths, separators, `.` and `..`.
pub fn split_relative(path: &str) -> Result<Vec<String>> {
    if path.len() > MAX_RELATIVE_PATH_CHARS {
        return Err(CoreError::new(
            ErrorCode::InvalidPath,
            "relative path too long",
        ));
    }
    if path.is_empty() || path == "." {
        return Ok(Vec::new());
    }
    if path.starts_with('/') || path.starts_with('\\') || path.contains('\0') || path.contains('\\')
    {
        return Err(CoreError::new(
            ErrorCode::PathEscape,
            "absolute or backslash path is not a workspace-relative path",
        ));
    }
    let mut out = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return Err(CoreError::new(
                ErrorCode::PathEscape,
                "relative path contains an empty, current, or parent component",
            ));
        }
        if part.contains('\0') {
            return Err(CoreError::new(ErrorCode::InvalidPath, "NUL in path"));
        }
        out.push(part.to_string());
    }
    Ok(out)
}

pub fn join_relative(parts: &[String]) -> String {
    parts.join("/")
}

pub fn blocked_component(name: &str) -> Option<ErrorCode> {
    if is_sensitive_name(name) {
        Some(ErrorCode::SensitivePath)
    } else if is_artifact_dir(name) {
        Some(ErrorCode::ArtifactPath)
    } else {
        None
    }
}

pub fn looks_like_secret_text(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    lower.contains("begin openssh private key")
        || lower.contains("begin private key")
        || lower.contains("begin rsa private key")
        || lower.contains("api_key")
        || lower.contains("api-key")
        || lower.contains("secret")
        || lower.contains("sk-")
        || lower.contains("bearer ")
}

pub fn validate_provider_token(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 64 {
        return Err(CoreError::new(
            ErrorCode::ModelReceiptRejected,
            "provider/model must be 1..=64 chars",
        ));
    }
    if looks_like_secret_text(value)
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | ':' | '/' | '-'))
    {
        return Err(CoreError::new(
            ErrorCode::SecretMaterialRejected,
            "provider/model looks like a secret or has illegal characters",
        ));
    }
    Ok(())
}

pub fn private_key_bytes(bytes: &[u8]) -> bool {
    let head = bytes.iter().take(80).copied().collect::<Vec<_>>();
    let Ok(text) = std::str::from_utf8(&head) else {
        return false;
    };
    let lower = text.to_ascii_lowercase();
    lower.contains("begin openssh private key")
        || lower.contains("begin private key")
        || lower.contains("begin rsa private key")
}
