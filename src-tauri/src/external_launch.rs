use serde::Serialize;
use std::path::{Path, PathBuf};

const MAX_LAUNCH_PATHS: usize = 8;
pub const CONTEXT_MENU_MARKER: &str = "--deeptop-context-menu";
pub const CONTEXT_MENU_DIRECTORY_MARKER: &str = "--deeptop-directory";
pub const CONTEXT_MENU_FILE_MARKER: &str = "--deeptop-file";

pub fn source_for_args(args: &[String]) -> &'static str {
    if args.iter().any(|argument| {
        argument == CONTEXT_MENU_MARKER
            || argument == CONTEXT_MENU_DIRECTORY_MARKER
            || argument == CONTEXT_MENU_FILE_MARKER
    }) {
        "windows-context-menu"
    } else {
        "command-line"
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalLaunchRequest {
    pub paths: Vec<String>,
    pub cwd: String,
    pub source: String,
}

fn is_option(argument: &str) -> bool {
    argument.starts_with('-') && !argument.starts_with("./") && !argument.starts_with("../")
}

fn is_windows_drive_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':'
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    (is_windows_drive_path(path) && bytes.len() >= 3 && (bytes[2] == b'\\' || bytes[2] == b'/'))
        || path.starts_with(r"\\")
        || path.starts_with(r"//")
}

fn is_windows_style_path(path: &str) -> bool {
    is_windows_drive_path(path) || path.contains('\\') || path.starts_with(r"//")
}

fn is_windows_drive_relative_path(path: &str) -> bool {
    is_windows_drive_path(path)
        && path
            .as_bytes()
            .get(2)
            .map(|separator| *separator != b'\\' && *separator != b'/')
            .unwrap_or(true)
}

fn normalize_windows_path(path: &str) -> String {
    path.replace('/', "\\")
}

fn windows_unc_root(path: &str) -> Option<String> {
    if !path.starts_with(r"\\") {
        return None;
    }
    let mut components = path[2..]
        .split('\\')
        .filter(|component| !component.is_empty());
    let server = components.next()?;
    let share = components.next()?;
    Some(format!(r"\\{}\{}", server, share))
}

fn windows_join(cwd: &str, path: &str) -> String {
    let path = normalize_windows_path(path);
    if is_windows_absolute_path(&path) {
        return path;
    }
    let cwd = normalize_windows_path(cwd);
    if path.starts_with('\\') {
        if is_windows_drive_path(&cwd) {
            return format!("{}{}", &cwd[..2], path);
        }
        return path;
    }
    if cwd.ends_with('\\') {
        format!("{cwd}{path}")
    } else {
        format!("{cwd}\\{path}")
    }
}

fn windows_parent(path: &str) -> String {
    let path = normalize_windows_path(path);
    if let Some(root) = windows_unc_root(&path) {
        let trimmed = path.trim_end_matches('\\');
        if trimmed.len() <= root.len() {
            return root;
        }
        return trimmed
            .rfind('\\')
            .map(|index| {
                if index <= root.len() {
                    root.clone()
                } else {
                    trimmed[..index].to_string()
                }
            })
            .unwrap_or(root);
    }

    if is_windows_absolute_path(&path) && is_windows_drive_path(&path) {
        let root = format!("{}\\", &path[..2]);
        let trimmed = path.trim_end_matches('\\');
        if trimmed.len() <= root.len() {
            return root;
        }
        return trimmed
            .rfind('\\')
            .map(|index| {
                if index <= 2 {
                    root.clone()
                } else {
                    trimmed[..index].to_string()
                }
            })
            .unwrap_or(root);
    }

    let trimmed = path.trim_end_matches('\\');
    trimmed
        .rfind('\\')
        .map(|index| trimmed[..index].to_string())
        .unwrap_or_else(|| path.to_string())
}

fn absolute_path(path: &Path, cwd: &Path) -> PathBuf {
    let path_value = path.to_string_lossy();
    let cwd_value = cwd.to_string_lossy();
    if !cfg!(windows) && (is_windows_style_path(&path_value) || is_windows_style_path(&cwd_value)) {
        PathBuf::from(windows_join(&cwd_value, &path_value))
    } else if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

fn launch_cwd(path: &Path, directory_hint: bool) -> PathBuf {
    if !cfg!(windows) && is_windows_style_path(&path.to_string_lossy()) {
        if directory_hint {
            return path.to_path_buf();
        }
        return PathBuf::from(windows_parent(&path.to_string_lossy()));
    }
    if directory_hint || path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent().unwrap_or(path).to_path_buf()
    }
}

pub fn parse(args: &[String], cwd: &Path, source: &str) -> Option<ExternalLaunchRequest> {
    let mut paths: Vec<String> = Vec::new();
    let directory_hint = args
        .iter()
        .any(|argument| argument == CONTEXT_MENU_DIRECTORY_MARKER);
    for argument in args.iter().skip(1) {
        let trimmed = argument.trim().trim_matches('"');
        if trimmed.is_empty()
            || trimmed == "--prepare-bundled-runtime"
            || trimmed == CONTEXT_MENU_MARKER
            || trimmed == CONTEXT_MENU_DIRECTORY_MARKER
            || trimmed == CONTEXT_MENU_FILE_MARKER
            || is_windows_drive_relative_path(trimmed)
            || is_option(trimmed)
        {
            continue;
        }
        let candidate = absolute_path(Path::new(trimmed), cwd);
        let value = candidate.to_string_lossy().into_owned();
        if !paths.iter().any(|item| item.eq_ignore_ascii_case(&value)) {
            paths.push(value);
        }
        if paths.len() >= MAX_LAUNCH_PATHS {
            break;
        }
    }
    let first = paths.first().map(PathBuf::from)?;
    let cwd = launch_cwd(&first, directory_hint)
        .to_string_lossy()
        .into_owned();
    Some(ExternalLaunchRequest {
        paths,
        cwd,
        source: source.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        is_windows_drive_relative_path, parse, source_for_args, windows_join, windows_parent,
    };
    use std::path::Path;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn parses_directory_and_uses_it_as_cwd() {
        let request = parse(
            &args(&["Deeptop.exe", "--deeptop-directory", "C:\\Projects\\demo"]),
            Path::new("C:\\"),
            "test",
        )
        .unwrap();
        assert_eq!(request.paths, vec!["C:\\Projects\\demo"]);
        assert_eq!(request.cwd, "C:\\Projects\\demo");
    }

    #[test]
    fn parses_file_and_uses_parent_as_cwd() {
        let request = parse(
            &args(&["Deeptop.exe", "--deeptop-file", "README.md"]),
            Path::new("C:\\Projects\\demo"),
            "test",
        )
        .unwrap();
        assert_eq!(request.paths, vec!["C:\\Projects\\demo\\README.md"]);
        assert_eq!(request.cwd, "C:\\Projects\\demo");
    }

    #[test]
    fn skips_flags_and_deduplicates_paths() {
        let request = parse(
            &args(&["Deeptop.exe", "--prepare-bundled-runtime", "demo", "demo"]),
            Path::new("C:\\Projects"),
            "test",
        )
        .unwrap();
        assert_eq!(request.paths, vec!["C:\\Projects\\demo"]);
    }

    #[test]
    fn normalizes_windows_paths_and_preserves_roots() {
        assert_eq!(
            windows_join(r"C:\Projects", "demo/file.txt"),
            r"C:\Projects\demo\file.txt"
        );
        assert_eq!(
            windows_join(r"C:\Projects", r"C:\Other\file.txt"),
            r"C:\Other\file.txt"
        );
        assert_eq!(
            windows_join(r"C:\Projects", r"\root\file.txt"),
            r"C:\root\file.txt"
        );
        assert_eq!(
            windows_join(r"C:\Projects", r"\\server/share/file.txt"),
            r"\\server\share\file.txt"
        );

        assert_eq!(windows_parent(r"C:\"), r"C:\");
        assert_eq!(windows_parent(r"C:\Projects\demo\"), r"C:\Projects");
        assert_eq!(windows_parent(r"\\server\share"), r"\\server\share");
        assert_eq!(
            windows_parent(r"\\server\share\folder\file.txt"),
            r"\\server\share\folder"
        );
    }

    #[test]
    fn skips_windows_drive_relative_paths() {
        assert!(is_windows_drive_relative_path("C:relative\\file.txt"));
        assert!(parse(
            &args(&["Deeptop.exe", "C:relative\\file.txt"]),
            Path::new(r"C:\Projects"),
            "test",
        )
        .is_none());
    }

    #[test]
    fn identifies_context_menu_sources_without_exposing_registry_details() {
        assert_eq!(
            source_for_args(&args(&["Deeptop.exe", "--deeptop-file", "README.md"])),
            "windows-context-menu"
        );
        assert_eq!(
            source_for_args(&args(&["Deeptop.exe", "README.md"])),
            "command-line"
        );
    }

    #[test]
    fn returns_none_without_external_paths() {
        assert!(parse(
            &args(&["Deeptop.exe", "--prepare-bundled-runtime"]),
            Path::new("C:\\"),
            "test"
        )
        .is_none());
    }
}
