use std::{
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use reqwest::Client;
use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::sync::oneshot;

const PROJECT_URL: &str = "https://github.com/Sparrived/DSH-Deeptop";
const RELEASES_API_URL: &str = "https://api.github.com/repos/Sparrived/DSH-Deeptop/releases/latest";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Clone)]
pub struct UpdateCheckManager {
    generation: Arc<AtomicU64>,
    cancel_sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

impl Default for UpdateCheckManager {
    fn default() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            cancel_sender: Arc::new(Mutex::new(None)),
        }
    }
}

impl UpdateCheckManager {
    fn begin(&self) -> (u64, oneshot::Receiver<()>) {
        self.cancel();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut current) = self.cancel_sender.lock() {
            *current = Some(sender);
        }
        (generation, receiver)
    }

    fn cancel(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut sender) = self.cancel_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(());
            }
        }
    }

    fn is_cancelled(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) != generation
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdateResult {
    current_version: String,
    latest_version: Option<String>,
    release_tag: Option<String>,
    release_name: Option<String>,
    release_url: Option<String>,
    update_available: bool,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    prerelease: bool,
    draft: bool,
}

fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

fn release_version(tag: &str) -> Option<Version> {
    Version::parse(tag.trim().trim_start_matches('v')).ok()
}

fn is_safe_external_url(url: &str) -> bool {
    let normalized = url.trim();
    !normalized.contains(['\r', '\n'])
        && (normalized == PROJECT_URL
            || normalized
                .strip_prefix(PROJECT_URL)
                .is_some_and(|suffix| suffix.starts_with('/')))
}

async fn fetch_latest_release() -> Result<GithubRelease, String> {
    let client = Client::builder()
        .timeout(UPDATE_CHECK_TIMEOUT)
        .user_agent(format!("Deeptop/{}/update-check", app_version()))
        .build()
        .map_err(|error| format!("创建更新检查连接失败：{error}"))?;
    let response = client
        .get(RELEASES_API_URL)
        .send()
        .await
        .map_err(|error| format!("无法连接 GitHub 更新服务：{error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub 更新服务返回错误：{error}"))?;
    response
        .json::<GithubRelease>()
        .await
        .map_err(|error| format!("读取 GitHub 发布信息失败：{error}"))
}

#[tauri::command]
pub async fn check_for_updates(
    updates: State<'_, UpdateCheckManager>,
) -> Result<NativeUpdateResult, String> {
    let (generation, mut cancelled) = updates.begin();
    let release = tokio::select! {
        result = fetch_latest_release() => result?,
        _ = &mut cancelled => return Err("更新检查已取消".to_string()),
    };
    if updates.is_cancelled(generation) {
        return Err("更新检查已取消".to_string());
    }
    if release.draft || release.prerelease {
        return Err("GitHub 最新发布不是稳定版本".to_string());
    }
    let Some(latest_version) = release_version(&release.tag_name) else {
        return Err(format!("GitHub 发布标签格式无效：{}", release.tag_name));
    };
    let current_version =
        Version::parse(app_version()).map_err(|error| format!("当前应用版本格式无效：{error}"))?;
    if !is_safe_external_url(&release.html_url) {
        return Err("GitHub 发布地址不受信任".to_string());
    }
    Ok(NativeUpdateResult {
        current_version: app_version().to_string(),
        latest_version: Some(latest_version.to_string()),
        release_tag: Some(release.tag_name),
        release_name: release.name,
        release_url: Some(release.html_url),
        update_available: latest_version > current_version,
    })
}

#[tauri::command]
pub fn cancel_update_check(updates: State<'_, UpdateCheckManager>) {
    updates.cancel();
}

#[tauri::command]
pub fn open_project_url(url: String) -> Result<(), String> {
    let value = url.trim();
    if !value.starts_with("https://") || !is_safe_external_url(value) {
        return Err("只允许打开 Deeptop GitHub 项目链接".to_string());
    }
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", value]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(value);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(value);
        command
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开外部链接：{error}"))
}

#[cfg(test)]
mod tests {
    use super::{is_safe_external_url, release_version, UpdateCheckManager};

    #[test]
    fn parses_release_tags_and_rejects_invalid_versions() {
        assert_eq!(release_version("v0.2.0").unwrap().to_string(), "0.2.0");
        assert!(release_version("latest").is_none());
    }

    #[test]
    fn only_allows_the_project_github_url() {
        assert!(is_safe_external_url(
            "https://github.com/Sparrived/DSH-Deeptop/releases/tag/v0.2.0"
        ));
        assert!(!is_safe_external_url("https://github.com/other/project"));
        assert!(!is_safe_external_url(
            "https://github.com/Sparrived/DSH-Deeptop.evil"
        ));
        assert!(!is_safe_external_url("javascript:alert(1)"));
    }

    #[test]
    fn cancelling_update_checks_invalidates_the_active_generation() {
        let manager = UpdateCheckManager::default();
        let (generation, _receiver) = manager.begin();
        assert!(!manager.is_cancelled(generation));
        manager.cancel();
        assert!(manager.is_cancelled(generation));
    }
}
