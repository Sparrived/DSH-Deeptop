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

fn absolute_path(path: &Path, cwd: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    }
}

fn launch_cwd(path: &Path, directory_hint: bool) -> PathBuf {
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
    use super::{parse, source_for_args};
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
