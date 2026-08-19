use std::{
    fs::{self, File},
    io::{Read, Write},
    path::PathBuf,
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
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

const PROJECT_URL: &str = "https://github.com/Sparrived/DSH-Deeptop";
const RELEASES_API_URL: &str = "https://api.github.com/repos/Sparrived/DSH-Deeptop/releases";
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(12);
const UPDATE_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const UPDATE_EVENT: &str = "app-update-progress";

#[derive(Clone)]
pub struct UpdateCheckManager {
    generation: Arc<AtomicU64>,
    cancel_sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    download_generation: Arc<AtomicU64>,
    download_cancel_sender: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    download_commit_lock: Arc<Mutex<()>>,
    download_context: Arc<Mutex<Option<(String, String)>>>,
    verified_update: Arc<Mutex<Option<VerifiedUpdate>>>,
}

impl Default for UpdateCheckManager {
    fn default() -> Self {
        Self {
            generation: Arc::new(AtomicU64::new(0)),
            cancel_sender: Arc::new(Mutex::new(None)),
            download_generation: Arc::new(AtomicU64::new(0)),
            download_cancel_sender: Arc::new(Mutex::new(None)),
            download_commit_lock: Arc::new(Mutex::new(())),
            download_context: Arc::new(Mutex::new(None)),
            verified_update: Arc::new(Mutex::new(None)),
        }
    }
}

impl UpdateCheckManager {
    fn begin(&self) -> (u64, oneshot::Receiver<()>) {
        self.cancel_check();
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut current) = self.cancel_sender.lock() {
            *current = Some(sender);
        }
        (generation, receiver)
    }

    fn cancel_check(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut sender) = self.cancel_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(());
            }
        }
    }

    fn begin_download(&self) -> (u64, oneshot::Receiver<()>) {
        self.cancel_download();
        if let Ok(mut context) = self.download_context.lock() {
            *context = None;
        }
        let generation = self.download_generation.fetch_add(1, Ordering::SeqCst) + 1;
        let (sender, receiver) = oneshot::channel();
        if let Ok(mut current) = self.download_cancel_sender.lock() {
            *current = Some(sender);
        }
        (generation, receiver)
    }

    fn cancel_download(&self) {
        let _commit_lock = self.download_commit_lock.lock().ok();
        self.download_generation.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut sender) = self.download_cancel_sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.send(());
            }
        }
        if let Ok(mut context) = self.download_context.lock() {
            *context = None;
        }
        if let Ok(mut verified) = self.verified_update.lock() {
            *verified = None;
        }
    }

    fn set_download_context(&self, release_tag: String, asset_name: String) {
        if let Ok(mut context) = self.download_context.lock() {
            *context = Some((release_tag, asset_name));
        }
    }

    fn download_context(&self) -> (Option<String>, Option<String>) {
        self.download_context
            .lock()
            .ok()
            .and_then(|context| context.clone())
            .map_or((None, None), |(release_tag, asset_name)| {
                (Some(release_tag), Some(asset_name))
            })
    }

    fn is_cancelled(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) != generation
    }

    fn is_download_cancelled(&self, generation: u64) -> bool {
        self.download_generation.load(Ordering::SeqCst) != generation
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UpdateChannel {
    Stable,
    Development,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeUpdateResult {
    current_version: String,
    channel: UpdateChannel,
    latest_version: Option<String>,
    release_tag: Option<String>,
    release_name: Option<String>,
    release_url: Option<String>,
    asset_name: Option<String>,
    asset_size: Option<u64>,
    sha256: Option<String>,
    install_supported: bool,
    update_available: bool,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    name: Option<String>,
    html_url: String,
    prerelease: bool,
    draft: bool,
    assets: Vec<GithubAsset>,
}

#[derive(Clone, Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

#[derive(Clone, Debug)]
struct SelectedRelease {
    release: GithubRelease,
    version: Version,
    asset: GithubAsset,
    sha256: String,
}

#[derive(Clone, Debug)]
struct VerifiedUpdate {
    release_tag: String,
    asset_name: String,
    path: PathBuf,
    sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateDownloadProgress {
    phase: String,
    release_tag: Option<String>,
    asset_name: Option<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
    percent: Option<u8>,
    path: Option<String>,
    sha256: Option<String>,
    message: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckForUpdatesArgs {
    channel: UpdateChannel,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadUpdateArgs {
    channel: UpdateChannel,
    release_tag: String,
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

async fn github_client(timeout: Duration, purpose: &str) -> Result<Client, String> {
    Client::builder()
        .timeout(timeout)
        .user_agent(format!("Deeptop/{}/{purpose}", app_version()))
        .build()
        .map_err(|error| format!("创建更新服务连接失败：{error}"))
}

async fn fetch_releases() -> Result<Vec<GithubRelease>, String> {
    let client = github_client(UPDATE_CHECK_TIMEOUT, "update-check").await?;
    client
        .get(format!("{RELEASES_API_URL}?per_page=30"))
        .send()
        .await
        .map_err(|error| format!("无法连接 GitHub 更新服务：{error}"))?
        .error_for_status()
        .map_err(|error| format!("GitHub 更新服务返回错误：{error}"))?
        .json::<Vec<GithubRelease>>()
        .await
        .map_err(|error| format!("读取 GitHub 发布信息失败：{error}"))
}

fn target_asset_suffix() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("windows-x64-setup.exe")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("macos-x64-dmg.dmg")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("macos-arm64-dmg.dmg")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("linux-x64-appimage.AppImage")
    } else {
        None
    }
}

fn install_supported() -> bool {
    target_asset_suffix().is_some()
}

fn safe_asset_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 240
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_'))
        && !name.contains("..")
}

fn safe_release_tag(tag: &str) -> bool {
    !tag.is_empty()
        && tag.len() <= 80
        && tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-' | b'_' | b'+'))
}

fn safe_github_download_url(url: &str, release_tag: &str, asset_name: &str) -> bool {
    let expected = format!(
        "https://github.com/Sparrived/DSH-Deeptop/releases/download/{release_tag}/{asset_name}"
    );
    url.trim() == expected
}

fn sha256_from_digest(digest: Option<&str>) -> Option<String> {
    let value = digest?.strip_prefix("sha256:")?;
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Some(value.to_ascii_lowercase())
    } else {
        None
    }
}

fn target_asset(release: &GithubRelease) -> Result<GithubAsset, String> {
    let suffix = target_asset_suffix().ok_or_else(|| "当前系统暂不支持自动安装更新".to_string())?;
    let asset = release
        .assets
        .iter()
        .find(|asset| asset.name.ends_with(suffix) && safe_asset_name(&asset.name))
        .cloned()
        .ok_or_else(|| format!("该版本没有当前平台的更新包：{suffix}"))?;
    if !safe_release_tag(&release.tag_name) {
        return Err("更新版本标签不受信任".to_string());
    }
    if !safe_github_download_url(&asset.browser_download_url, &release.tag_name, &asset.name) {
        return Err("更新包下载地址不受信任".to_string());
    }
    Ok(asset)
}

fn sha256_from_manifest(manifest: &str, asset_name: &str) -> Option<String> {
    manifest.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let digest = fields.next()?;
        let name = fields.next()?.trim_start_matches('*');
        if name == asset_name {
            sha256_from_digest(Some(&format!("sha256:{digest}")))
        } else {
            None
        }
    })
}

async fn resolve_asset_digest(
    release: &GithubRelease,
    asset: &GithubAsset,
) -> Result<String, String> {
    if let Some(digest) = sha256_from_digest(asset.digest.as_deref()) {
        return Ok(digest);
    }
    let manifest = release
        .assets
        .iter()
        .find(|candidate| candidate.name == "SHA256SUMS")
        .ok_or_else(|| format!("更新包缺少有效 SHA256：{}", asset.name))?;
    if !safe_github_download_url(
        &manifest.browser_download_url,
        &release.tag_name,
        &manifest.name,
    ) {
        return Err("SHA256 校验清单地址不受信任".to_string());
    }
    let client = github_client(UPDATE_CHECK_TIMEOUT, "update-checksum").await?;
    let body = client
        .get(&manifest.browser_download_url)
        .send()
        .await
        .map_err(|error| format!("无法读取更新校验清单：{error}"))?
        .error_for_status()
        .map_err(|error| format!("更新校验清单返回错误：{error}"))?
        .text()
        .await
        .map_err(|error| format!("读取更新校验清单失败：{error}"))?;
    sha256_from_manifest(&body, &asset.name)
        .ok_or_else(|| format!("更新包缺少有效 SHA256：{}", asset.name))
}

fn release_candidates(
    releases: Vec<GithubRelease>,
    channel: &UpdateChannel,
) -> Vec<(GithubRelease, Version)> {
    let mut candidates = releases
        .into_iter()
        .filter(|release| {
            !release.draft && release.prerelease == matches!(channel, UpdateChannel::Development)
        })
        .filter(|release| safe_release_tag(&release.tag_name))
        .filter_map(|release| release_version(&release.tag_name).map(|version| (release, version)))
        .collect::<Vec<_>>();
    candidates.sort_by(|left, right| right.1.cmp(&left.1));
    candidates
}

async fn select_release(
    releases: Vec<GithubRelease>,
    channel: &UpdateChannel,
) -> Result<Option<SelectedRelease>, String> {
    let candidates = release_candidates(releases, channel);
    let mut last_error = None;
    for (release, version) in candidates {
        let asset = match target_asset(&release) {
            Ok(asset) => asset,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        match resolve_asset_digest(&release, &asset).await {
            Ok(sha256) => {
                return Ok(Some(SelectedRelease {
                    release,
                    version,
                    asset,
                    sha256,
                }));
            }
            Err(error) => last_error = Some(error),
        }
    }
    if let Some(error) = last_error {
        Err(error)
    } else {
        Ok(None)
    }
}

fn update_result(
    channel: UpdateChannel,
    selected: Option<SelectedRelease>,
) -> Result<NativeUpdateResult, String> {
    let current_version =
        Version::parse(app_version()).map_err(|error| format!("当前应用版本格式无效：{error}"))?;
    let Some(selected) = selected else {
        return Ok(NativeUpdateResult {
            current_version: app_version().to_string(),
            channel,
            latest_version: None,
            release_tag: None,
            release_name: None,
            release_url: None,
            asset_name: None,
            asset_size: None,
            sha256: None,
            install_supported: install_supported(),
            update_available: false,
        });
    };
    if !is_safe_external_url(&selected.release.html_url) {
        return Err("GitHub 发布地址不受信任".to_string());
    }
    Ok(NativeUpdateResult {
        current_version: app_version().to_string(),
        channel,
        latest_version: Some(selected.version.to_string()),
        release_tag: Some(selected.release.tag_name),
        release_name: selected.release.name,
        release_url: Some(selected.release.html_url),
        asset_name: Some(selected.asset.name),
        asset_size: Some(selected.asset.size),
        sha256: Some(selected.sha256),
        install_supported: install_supported(),
        update_available: selected.version > current_version,
    })
}

#[tauri::command]
pub async fn check_for_updates(
    args: CheckForUpdatesArgs,
    updates: State<'_, UpdateCheckManager>,
) -> Result<NativeUpdateResult, String> {
    let (generation, mut cancelled) = updates.begin();
    let releases = tokio::select! {
        result = fetch_releases() => result?,
        _ = &mut cancelled => return Err("更新检查已取消".to_string()),
    };
    if updates.is_cancelled(generation) {
        return Err("更新检查已取消".to_string());
    }
    let selected = tokio::select! {
        result = select_release(releases, &args.channel) => result?,
        _ = &mut cancelled => return Err("更新检查已取消".to_string()),
    };
    update_result(args.channel, selected)
}

fn emit_progress(app: &AppHandle, progress: UpdateDownloadProgress) {
    let _ = app.emit(UPDATE_EVENT, progress);
}

fn update_cache_dir(app: &AppHandle, release_tag: &str) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|error| format!("无法定位更新缓存目录：{error}"))?
        .join("updates")
        .join(release_tag);
    fs::create_dir_all(&root).map_err(|error| format!("无法创建更新缓存目录：{error}"))?;
    Ok(root)
}

async fn select_release_for_download(
    channel: &UpdateChannel,
    release_tag: &str,
) -> Result<SelectedRelease, String> {
    if !safe_release_tag(release_tag) {
        return Err("更新版本标签无效".to_string());
    }
    let releases = fetch_releases().await?;
    let selected = select_release(releases, channel)
        .await?
        .ok_or_else(|| "没有找到对应更新发布".to_string())?;
    if selected.release.tag_name != release_tag {
        return Err("更新版本已变化，请重新检查更新".to_string());
    }
    Ok(selected)
}

async fn download_update_inner(
    app: AppHandle,
    args: DownloadUpdateArgs,
    updates: State<'_, UpdateCheckManager>,
) -> Result<(), String> {
    let (generation, mut cancelled) = updates.begin_download();
    let selected = tokio::select! {
        result = select_release_for_download(&args.channel, &args.release_tag) => result?,
        _ = &mut cancelled => return Err("更新下载已取消".to_string()),
    };
    if updates.is_download_cancelled(generation) {
        return Err("更新下载已取消".to_string());
    }
    updates.set_download_context(
        selected.release.tag_name.clone(),
        selected.asset.name.clone(),
    );
    let directory = update_cache_dir(&app, &selected.release.tag_name)?;
    let final_path = directory.join(&selected.asset.name);
    let partial_path = directory.join(format!("{}.part", selected.asset.name));
    let _ = fs::remove_file(&partial_path);
    let _ = fs::remove_file(&final_path);
    emit_progress(
        &app,
        UpdateDownloadProgress {
            phase: "downloading".to_string(),
            release_tag: Some(selected.release.tag_name.clone()),
            asset_name: Some(selected.asset.name.clone()),
            downloaded_bytes: Some(0),
            total_bytes: Some(selected.asset.size),
            percent: Some(0),
            path: None,
            sha256: None,
            message: None,
        },
    );
    let client = github_client(UPDATE_DOWNLOAD_TIMEOUT, "update-download").await?;
    let response = tokio::select! {
        result = client.get(&selected.asset.browser_download_url).send() => result.map_err(|error| format!("无法下载更新包：{error}"))?,
        _ = &mut cancelled => return Err("更新下载已取消".to_string()),
    }
    .error_for_status()
    .map_err(|error| format!("更新包下载失败：{error}"))?;
    let response_size = response.content_length();
    if response_size.is_some_and(|size| size != selected.asset.size) {
        return Err("更新包大小与发布信息不一致".to_string());
    }
    let total = response_size.or(Some(selected.asset.size));
    let mut stream = response.bytes_stream();
    let mut file =
        File::create(&partial_path).map_err(|error| format!("无法创建更新临时文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = tokio::select! {
        result = futures_util::StreamExt::next(&mut stream) => result,
        _ = &mut cancelled => {
            let _ = fs::remove_file(&partial_path);
            return Err("更新下载已取消".to_string());
        },
    } {
        let chunk = chunk.map_err(|error| {
            let _ = fs::remove_file(&partial_path);
            format!("读取更新包失败：{error}")
        })?;
        file.write_all(&chunk).map_err(|error| {
            let _ = fs::remove_file(&partial_path);
            format!("写入更新包失败：{error}")
        })?;
        hasher.update(&chunk);
        downloaded += chunk.len() as u64;
        if downloaded % ((256 * 1024) as u64) < chunk.len() as u64
            || total.is_some_and(|size| downloaded >= size)
        {
            let percent = total
                .and_then(|size| (size > 0).then_some(((downloaded.min(size) * 100) / size) as u8));
            emit_progress(
                &app,
                UpdateDownloadProgress {
                    phase: "downloading".to_string(),
                    release_tag: Some(selected.release.tag_name.clone()),
                    asset_name: Some(selected.asset.name.clone()),
                    downloaded_bytes: Some(downloaded),
                    total_bytes: total,
                    percent,
                    path: None,
                    sha256: None,
                    message: None,
                },
            );
        }
    }
    file.flush()
        .map_err(|error| format!("保存更新包失败：{error}"))?;
    drop(file);
    let _commit_lock = updates
        .download_commit_lock
        .lock()
        .map_err(|_| "更新下载状态锁定失败".to_string())?;
    if updates.is_download_cancelled(generation) {
        let _ = fs::remove_file(&partial_path);
        return Err("更新下载已取消".to_string());
    }
    if downloaded != selected.asset.size {
        let _ = fs::remove_file(&partial_path);
        return Err("更新包下载不完整，大小校验失败".to_string());
    }
    emit_progress(
        &app,
        UpdateDownloadProgress {
            phase: "verifying".to_string(),
            release_tag: Some(selected.release.tag_name.clone()),
            asset_name: Some(selected.asset.name.clone()),
            downloaded_bytes: Some(downloaded),
            total_bytes: total,
            percent: Some(100),
            path: None,
            sha256: None,
            message: None,
        },
    );
    let actual = format!("{:x}", hasher.finalize());
    if actual != selected.sha256 {
        let _ = fs::remove_file(&partial_path);
        return Err("更新包 SHA256 校验失败，已删除不完整文件".to_string());
    }
    if updates.is_download_cancelled(generation) {
        let _ = fs::remove_file(&partial_path);
        return Err("更新下载已取消".to_string());
    }
    fs::rename(&partial_path, &final_path)
        .map_err(|error| format!("保存已校验更新包失败：{error}"))?;
    if updates.is_download_cancelled(generation) {
        let _ = fs::remove_file(&final_path);
        return Err("更新下载已取消".to_string());
    }
    if let Ok(mut verified) = updates.verified_update.lock() {
        *verified = Some(VerifiedUpdate {
            release_tag: selected.release.tag_name.clone(),
            asset_name: selected.asset.name.clone(),
            path: final_path.clone(),
            sha256: actual.clone(),
        });
    }
    emit_progress(
        &app,
        UpdateDownloadProgress {
            phase: "ready".to_string(),
            release_tag: Some(selected.release.tag_name),
            asset_name: Some(selected.asset.name),
            downloaded_bytes: Some(downloaded),
            total_bytes: total,
            percent: Some(100),
            path: Some(final_path.to_string_lossy().into_owned()),
            sha256: Some(actual),
            message: None,
        },
    );
    Ok(())
}

#[tauri::command]
pub async fn download_update(
    app: AppHandle,
    args: DownloadUpdateArgs,
    updates: State<'_, UpdateCheckManager>,
) -> Result<(), String> {
    let requested_release_tag = args.release_tag.clone();
    match download_update_inner(app.clone(), args, updates.clone()).await {
        Ok(()) => Ok(()),
        Err(error) => {
            let (context_release_tag, context_asset_name) = updates.download_context();
            emit_progress(
                &app,
                UpdateDownloadProgress {
                    phase: if error.contains("取消") {
                        "cancelled"
                    } else {
                        "failed"
                    }
                    .to_string(),
                    release_tag: context_release_tag.or(Some(requested_release_tag)),
                    asset_name: context_asset_name,
                    downloaded_bytes: None,
                    total_bytes: None,
                    percent: None,
                    path: None,
                    sha256: None,
                    message: Some(error.clone()),
                },
            );
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_update_download(updates: State<'_, UpdateCheckManager>) {
    updates.cancel_download();
}

#[tauri::command]
pub fn launch_update_installer(
    app: AppHandle,
    updates: State<'_, UpdateCheckManager>,
) -> Result<(), String> {
    let verified = updates
        .verified_update
        .lock()
        .map_err(|_| "读取已校验更新包失败".to_string())?
        .clone()
        .ok_or_else(|| "请先下载并校验更新包".to_string())?;
    if !verified.path.is_file() {
        return Err("已校验更新包不存在，请重新下载".to_string());
    }
    let mut file =
        File::open(&verified.path).map_err(|error| format!("读取已校验更新包失败：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("复核更新包失败：{error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != verified.sha256 {
        if let Ok(mut current) = updates.verified_update.lock() {
            *current = None;
        }
        return Err("更新包在启动前校验失败，请重新下载".to_string());
    }
    emit_progress(
        &app,
        UpdateDownloadProgress {
            phase: "launching".to_string(),
            release_tag: Some(verified.release_tag),
            asset_name: Some(verified.asset_name.clone()),
            downloaded_bytes: None,
            total_bytes: None,
            percent: None,
            path: None,
            sha256: Some(verified.sha256),
            message: None,
        },
    );
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        Command::new(&verified.path)
            .creation_flags(0x08000000)
            .spawn()
            .map_err(|error| format!("无法启动 Windows 安装程序：{error}"))?;
        app.exit(0);
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    {
        let output = Command::new("hdiutil")
            .args(["attach", "-nobrowse", "-readonly"])
            .arg(&verified.path)
            .output()
            .map_err(|error| format!("无法挂载 macOS 更新磁盘映像：{error}"))?;
        if !output.status.success() {
            return Err("macOS 更新磁盘映像挂载失败".to_string());
        }
        let output_text = String::from_utf8_lossy(&output.stdout);
        let mount_point = output_text
            .lines()
            .filter_map(|line| line.split('\t').last())
            .find(|value| value.starts_with("/Volumes/"));
        let Some(mount_point) = mount_point else {
            return Err("未找到 macOS 更新磁盘映像挂载目录".to_string());
        };
        Command::new("open")
            .arg(mount_point)
            .spawn()
            .map_err(|error| format!("无法打开 macOS 更新磁盘映像：{error}"))?;
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&verified.path)
            .map_err(|error| format!("读取 Linux 更新包权限失败：{error}"))?
            .permissions();
        permissions.set_mode(permissions.mode() | 0o755);
        fs::set_permissions(&verified.path, permissions)
            .map_err(|error| format!("设置 Linux 更新包可执行权限失败：{error}"))?;
        Command::new(&verified.path)
            .spawn()
            .map_err(|error| format!("无法启动 Linux AppImage：{error}"))?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    {
        let _ = app;
        Err("当前平台暂不支持启动更新程序".to_string())
    }
}

#[tauri::command]
pub fn cancel_update_check(updates: State<'_, UpdateCheckManager>) {
    updates.cancel_check();
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
    use super::{
        is_safe_external_url, release_candidates, release_version, safe_asset_name,
        safe_github_download_url, safe_release_tag, sha256_from_digest, sha256_from_manifest,
        GithubRelease, UpdateChannel, UpdateCheckManager,
    };

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
        manager.cancel_check();
        assert!(manager.is_cancelled(generation));
    }

    #[test]
    fn filters_stable_and_development_release_channels() {
        let release = |tag_name: &str, prerelease: bool| GithubRelease {
            tag_name: tag_name.to_string(),
            name: None,
            html_url: format!("https://github.com/Sparrived/DSH-Deeptop/releases/tag/{tag_name}"),
            prerelease,
            draft: false,
            assets: Vec::new(),
        };
        let releases = vec![
            release("v1.0.0", false),
            release("v1.1.0-dev.1", true),
            release("v0.9.0", false),
        ];
        assert_eq!(
            release_candidates(releases.clone(), &UpdateChannel::Stable)[0]
                .0
                .tag_name,
            "v1.0.0"
        );
        assert_eq!(
            release_candidates(releases, &UpdateChannel::Development)[0]
                .0
                .tag_name,
            "v1.1.0-dev.1"
        );
    }

    #[test]
    fn validates_update_asset_names_and_sha256_sources() {
        assert!(safe_release_tag("v1.0.0-dev.1"));
        assert!(!safe_release_tag("../v1.0.0"));
        assert!(safe_github_download_url(
            "https://github.com/Sparrived/DSH-Deeptop/releases/download/v1.0.0/update.exe",
            "v1.0.0",
            "update.exe"
        ));
        assert!(!safe_github_download_url(
            "https://github.com/Sparrived/DSH-Deeptop/releases/download/v1.0.0/update.exe?download=1",
            "v1.0.0",
            "update.exe"
        ));
        assert!(safe_asset_name("Deeptop-v1.0.0-windows-x64-setup.exe"));
        assert!(!safe_asset_name("../update.exe"));
        assert_eq!(
            sha256_from_digest(Some(&format!("sha256:{}", "A".repeat(64)))),
            Some("a".repeat(64))
        );
        assert_eq!(sha256_from_digest(Some("sha256:not-a-digest")), None);
        let digest = "b".repeat(64);
        assert_eq!(
            sha256_from_manifest(&format!("{digest}  update.exe\n"), "update.exe"),
            Some(digest)
        );
        assert_eq!(sha256_from_manifest("bad-line", "update.exe"), None);
    }
}
