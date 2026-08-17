#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::{HashMap, VecDeque},
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::Duration,
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use notify_rust::{Notification as DesktopNotification, NotificationResponse};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

mod terminal;

mod registry {
    use std::{
        env,
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant},
    };

    const DEFAULT: &str = "https://registry.npmjs.org";
    const MIRROR: &str = "https://registry.npmmirror.com";
    const TENCENT_MIRROR: &str = "https://mirrors.cloud.tencent.com/npm";
    const HUAWEI_MIRROR: &str = "https://repo.huaweicloud.com/repository/npm";
    const PACKAGE: &str = "@deepseek-ai/dsh@latest";
    // npm may spend a few seconds initializing its cache on a fresh machine.
    // Keep this separate from the install timeout, but do not reject a usable
    // registry merely because the first npm process is cold.
    const TIMEOUT: Duration = Duration::from_secs(20);

    #[derive(Clone)]
    pub struct Probe {
        pub registry: String,
        pub elapsed_ms: u128,
        pub ok: bool,
    }
    pub struct Selection {
        pub registry: String,
        pub probes: Vec<Probe>,
        pub all_failed: bool,
    }

    fn normalize(value: &str) -> Option<String> {
        let value = value.trim().trim_end_matches('/');
        let offset = if value.starts_with("https://") {
            8
        } else if value.starts_with("http://") {
            7
        } else {
            return None;
        };
        if value.is_empty()
            || value.chars().any(char::is_whitespace)
            || value.contains(['@', '?', '#', '\\'])
        {
            return None;
        }
        let authority = value[offset..].split('/').next().unwrap_or_default();
        if authority.is_empty() || authority.starts_with(':') || authority.ends_with(':') {
            return None;
        }
        Some(value.to_string())
    }

    fn candidates() -> Vec<String> {
        let configured = env::var("DSH_REGISTRY")
            .or_else(|_| env::var("npm_config_registry"))
            .or_else(|_| env::var("NPM_CONFIG_REGISTRY"))
            .ok()
            .and_then(|value| normalize(&value));
        [
            configured,
            Some(MIRROR.to_string()),
            Some(TENCENT_MIRROR.to_string()),
            Some(HUAWEI_MIRROR.to_string()),
            Some(DEFAULT.to_string()),
        ]
        .into_iter()
        .flatten()
        .fold(Vec::new(), |mut values, value| {
            if !values.contains(&value) {
                values.push(value);
            }
            values
        })
    }

    fn kill(pid: u32) {
        #[cfg(windows)]
        {
            let mut command = Command::new("taskkill");
            command.args(["/PID", &pid.to_string(), "/T", "/F"]);
            super::configure_hidden_process(&mut command);
            let _ = command.status();
        }
        #[cfg(unix)]
        {
            for signal in ["-TERM", "-KILL"] {
                let mut command = Command::new("kill");
                command.args([signal, &format!("-{pid}")]);
                let _ = command.status();
            }
        }
    }

    fn probe(factory: fn() -> Result<Command, String>, registry: String) -> Probe {
        let started = Instant::now();
        let mut command = match factory() {
            Ok(command) => command,
            Err(_) => {
                return Probe {
                    registry,
                    elapsed_ms: 0,
                    ok: false,
                };
            }
        };
        command
            .args([
                "view",
                PACKAGE,
                "version",
                "--registry",
                &registry,
                "--fetch-timeout",
                "8000",
                "--fetch-retries",
                "0",
                "--prefer-online",
                "--offline=false",
                "--loglevel",
                "error",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(_) => {
                return Probe {
                    registry,
                    elapsed_ms: started.elapsed().as_millis(),
                    ok: false,
                };
            }
        };
        let pid = child.id();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) if started.elapsed() >= TIMEOUT => {
                    kill(pid);
                    let _ = child.wait();
                    return Probe {
                        registry,
                        elapsed_ms: started.elapsed().as_millis(),
                        ok: false,
                    };
                }
                Ok(None) => thread::sleep(Duration::from_millis(50)),
                Err(_) => {
                    kill(pid);
                    let _ = child.wait();
                    return Probe {
                        registry,
                        elapsed_ms: started.elapsed().as_millis(),
                        ok: false,
                    };
                }
            }
        };
        Probe {
            registry,
            elapsed_ms: started.elapsed().as_millis(),
            ok: status.success(),
        }
    }

    pub fn select(factory: fn() -> Result<Command, String>) -> Selection {
        let mut probes = thread::scope(|scope| {
            candidates()
                .into_iter()
                .enumerate()
                .map(|(index, registry)| scope.spawn(move || (index, probe(factory, registry))))
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| {
                    handle.join().unwrap_or_else(|_| {
                        (
                            usize::MAX,
                            Probe {
                                registry: DEFAULT.to_string(),
                                elapsed_ms: 0,
                                ok: false,
                            },
                        )
                    })
                })
                .collect::<Vec<_>>()
        });
        probes.sort_by_key(|(index, _)| *index);
        let probes = probes
            .into_iter()
            .map(|(_, probe)| probe)
            .collect::<Vec<_>>();
        let selected = probes
            .iter()
            .filter(|probe| probe.ok)
            .min_by_key(|probe| probe.elapsed_ms)
            .map(|probe| probe.registry.clone())
            .unwrap_or_else(|| DEFAULT.to_string());
        Selection {
            all_failed: !probes.iter().any(|probe| probe.ok),
            registry: selected,
            probes,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::normalize;

        #[test]
        fn accepts_safe_registry_urls() {
            assert_eq!(
                normalize(" https://registry.example.test/ "),
                Some("https://registry.example.test".to_string())
            );
            assert_eq!(
                normalize("https://registry.example.test/npm/"),
                Some("https://registry.example.test/npm".to_string())
            );
        }

        #[test]
        fn rejects_credentials_and_controls() {
            for value in [
                "https://user:password@registry.example.test",
                "https://registry.example.test?token=secret",
                "https://registry.example.test#fragment",
                "https://",
                "file:///tmp/npm",
            ] {
                assert_eq!(normalize(value), None, "{value}");
            }
        }
    }
}

const DSH_PROFILE: &str = "desktop";
const DSH_PACKAGE: &str = "@deepseek-ai/dsh@latest";
const NODEJS_DOWNLOAD_URL: &str = "https://nodejs.org/en/download";
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(45);
const DSH_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
/// Max consecutive unexpected DSH exits we auto-restart before requiring manual
/// action. Guards against a crash loop (e.g. a corrupted profile) that would
/// otherwise restart DSH forever.
const MAX_AUTO_RESTARTS: u32 = 3;
/// Base delay for the first auto-restart; each consecutive crash doubles it.
const AUTO_RESTART_BASE_DELAY: Duration = Duration::from_millis(1000);
const DSH_PACKAGE_JSON: &str = "{\n  \"name\": \"deeptop-dsh\",\n  \"private\": true\n}\n";
const BRIDGE_PACKAGE_JSON: &str = include_str!("../../deeptop-bridge/package.json");
const BRIDGE_PATCH: &str = include_str!("../../deeptop-bridge/cordis.patch.yml");
const BRIDGE_ENTRY: &str = include_str!("../../deeptop-bridge/index.mjs");
const BRIDGE_RUNTIME: &str = include_str!("../../deeptop-bridge/bridge.mjs");
const BRIDGE_ROUTES: &str = include_str!("../../deeptop-bridge/routes.mjs");
const BRIDGE_SESSION_REPAIR: &str = include_str!("../../deeptop-bridge/session-repair.mjs");
const BRIDGE_MESSAGE_ANNOTATIONS: &str =
    include_str!("../../deeptop-bridge/message-annotations.mjs");
const BRIDGE_SKILL_INSTALLER: &str = include_str!("../../deeptop-bridge/skill-installer.mjs");
const BRIDGE_SKILL_INSTALL_PLUGIN: &str =
    include_str!("../../deeptop-bridge/skill-install-plugin.mjs");
const BRIDGE_PLUGIN_CONFIG: &str = include_str!("../../deeptop-bridge/plugin-config.mjs");
const PROFILE_TEMPLATE: &str = include_str!("../../deeptop-bridge/desktop-profile.json");
const PROFILE_PATCH_TEMPLATE: &str = include_str!("../../deeptop-bridge/profile.patch.yml");
const PROFILE_PNPM_WORKSPACE: &str =
    "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";
const MAX_PENDING_OPEN_SESSIONS: usize = 16;
const DSH_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);
/// Max in-memory runtime log entries kept for export and recent diagnostics.
const MAX_LOG_ENTRIES: usize = 3000;
/// Keep the initial log-viewer payload small enough for the WebView to render quickly.
const MAX_LOG_VIEW_ENTRIES: usize = 500;
/// Bound one entry so a large DSH response cannot freeze log retrieval/rendering.
const MAX_LOG_TEXT_BYTES: usize = 16 * 1024;
/// Rotate the persistent log file after it grows past this size.
const MAX_LOG_FILE_BYTES: u64 = 4 * 1024 * 1024;
/// Bound the asynchronous writer queue so a log storm cannot block the runtime.
const LOG_WRITE_QUEUE_CAPACITY: usize = 1024;

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetACP"]
    fn get_acp() -> u32;
    #[link_name = "GetOEMCP"]
    fn get_oem_cp() -> u32;
    #[link_name = "MultiByteToWideChar"]
    fn multi_byte_to_wide_char(
        code_page: u32,
        flags: u32,
        input: *const u8,
        input_len: i32,
        output: *mut u16,
        output_len: i32,
    ) -> i32;
}

#[cfg(windows)]
fn decode_windows_code_page(bytes: &[u8], code_page: u32) -> Option<String> {
    let input_len = i32::try_from(bytes.len()).ok()?;
    if input_len == 0 {
        return Some(String::new());
    }
    let output_len = unsafe {
        multi_byte_to_wide_char(
            code_page,
            0,
            bytes.as_ptr(),
            input_len,
            std::ptr::null_mut(),
            0,
        )
    };
    if output_len <= 0 {
        return None;
    }
    let mut wide = vec![0u16; output_len as usize];
    let written = unsafe {
        multi_byte_to_wide_char(
            code_page,
            0,
            bytes.as_ptr(),
            input_len,
            wide.as_mut_ptr(),
            output_len,
        )
    };
    (written > 0).then(|| String::from_utf16_lossy(&wide[..written as usize]))
}

fn decode_process_line(bytes: &[u8]) -> String {
    if let Ok(line) = std::str::from_utf8(bytes) {
        return line.to_owned();
    }
    #[cfg(windows)]
    {
        let code_pages = unsafe { [get_acp(), get_oem_cp()] };
        for code_page in code_pages {
            if let Some(line) = decode_windows_code_page(bytes, code_page) {
                return line;
            }
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

// Child-process output may use the Windows ANSI code page instead of UTF-8.
fn lossy_lines<R: Read>(reader: R) -> impl Iterator<Item = std::io::Result<String>> {
    let mut reader = BufReader::new(reader);
    let mut finished = false;
    std::iter::from_fn(move || {
        if finished {
            return None;
        }
        let mut bytes = Vec::new();
        match reader.read_until(b'\n', &mut bytes) {
            Ok(0) => {
                finished = true;
                None
            }
            Ok(_) => {
                if bytes.last() == Some(&b'\n') {
                    bytes.pop();
                }
                if bytes.last() == Some(&b'\r') {
                    bytes.pop();
                }
                Some(Ok(decode_process_line(&bytes)))
            }
            Err(error) => {
                finished = true;
                Some(Err(error))
            }
        }
    })
}

#[cfg(test)]
mod output_tests {
    use super::lossy_lines;

    #[test]
    fn reads_invalid_utf8_as_lossy_lines() {
        let lines = lossy_lines(&b"ready\r\nbad \xFF\npartial"[..])
            .map(Result::unwrap)
            .collect::<Vec<_>>();

        assert_eq!(lines[0], "ready");
        assert!(lines[1].starts_with("bad "));
        assert_eq!(lines[2], "partial");
    }

    #[cfg(windows)]
    #[test]
    fn decodes_cp936_process_output() {
        assert_eq!(
            super::decode_windows_code_page(&[0xB2, 0xBB], 936),
            Some("不".to_string())
        );
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DshSource {
    LocalPrefix,
    GlobalPrefix,
    PathExecutable,
    NpmCache,
}

impl DshSource {
    fn label(self) -> &'static str {
        match self {
            Self::LocalPrefix => "Deeptop 本地 npm prefix",
            Self::GlobalPrefix => "npm 全局安装",
            Self::PathExecutable => "PATH 中的 dsh 命令",
            Self::NpmCache => "npm/npx 缓存",
        }
    }
}

struct DshLaunch {
    source: DshSource,
    command: Command,
    label: String,
}

/// Persist logs on a dedicated thread so runtime events and log snapshots never
/// wait for filesystem metadata, rotation, or append I/O. A full queue drops
/// only the persistent copy; the in-memory viewer remains available.
#[derive(Clone)]
struct LogWriter {
    sender: mpsc::SyncSender<String>,
}

impl LogWriter {
    fn new() -> Self {
        let (sender, receiver): (mpsc::SyncSender<String>, mpsc::Receiver<String>) =
            mpsc::sync_channel(LOG_WRITE_QUEUE_CAPACITY);
        thread::spawn(move || {
            while let Ok(line) = receiver.recv() {
                append_log_file(&persistent_log_path(), &line);
            }
        });
        Self { sender }
    }

    fn enqueue(&self, entry: &DshRuntimeLog) {
        let _ = self.sender.try_send(format_log_line(entry));
    }
}

impl Default for LogWriter {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Default)]
struct LogStore {
    entries: VecDeque<DshRuntimeLog>,
}

impl LogStore {
    fn push(&mut self, entry: DshRuntimeLog) {
        self.entries.push_back(entry);
        while self.entries.len() > MAX_LOG_ENTRIES {
            self.entries.pop_front();
        }
    }

    fn snapshot(&self) -> Vec<DshRuntimeLog> {
        self.entries.iter().cloned().collect()
    }

    fn recent_snapshot(&self, limit: usize) -> Vec<DshRuntimeLog> {
        self.entries
            .iter()
            .rev()
            .take(limit)
            .cloned()
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimePhase {
    Idle,
    Checking,
    Installing,
    Starting,
    Ready,
    Failed,
}

struct BridgeState {
    phase: RuntimePhase,
    message: String,
    package_available: bool,
    registry_testing: bool,
    selected_registry: Option<String>,
    generation: u64,
    pid: Option<u32>,
    install_pid: Option<u32>,
    stdin: Option<Arc<Mutex<std::process::ChildStdin>>>,
    pending: HashMap<String, mpsc::Sender<Result<Value, String>>>,
    /// Consecutive unexpected DSH exits not yet recovered by a successful boot.
    crash_count: u32,
    /// An auto-restart has been scheduled for the current crash; prevents double
    /// scheduling while the delayed restart thread is still waiting.
    auto_restart_pending: bool,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            phase: RuntimePhase::Idle,
            message: "等待 DSH 启动".to_string(),
            package_available: false,
            registry_testing: false,
            selected_registry: None,
            generation: 0,
            pid: None,
            install_pid: None,
            stdin: None,
            pending: HashMap::new(),
            crash_count: 0,
            auto_restart_pending: false,
        }
    }
}

#[derive(Clone, Default)]
struct BridgeManager {
    state: Arc<Mutex<BridgeState>>,
    next_request_id: Arc<AtomicU64>,
    pending_open_sessions: Arc<Mutex<VecDeque<String>>>,
    logs: Arc<Mutex<LogStore>>,
    log_writer: LogWriter,
}

impl BridgeManager {
    fn enqueue_open_session(&self, session_id: String) {
        let session_id = session_id.trim().to_string();
        if session_id.is_empty() {
            return;
        }
        let Ok(mut pending) = self.pending_open_sessions.lock() else {
            return;
        };
        pending.retain(|item| item != &session_id);
        pending.push_back(session_id);
        while pending.len() > MAX_PENDING_OPEN_SESSIONS {
            pending.pop_front();
        }
    }

    fn list_pending_open_sessions(&self) -> Vec<String> {
        self.pending_open_sessions
            .lock()
            .map(|pending| pending.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn acknowledge_pending_open_session(&self, session_id: &str) {
        if let Ok(mut pending) = self.pending_open_sessions.lock() {
            pending.retain(|item| item != session_id);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DshStatus {
    dsh_home: String,
    runtime_directory: String,
    package_name: String,
    runtime_available: bool,
    runtime_starting: bool,
    installing: bool,
    registry_testing: bool,
    selected_registry: Option<String>,
    node_available: bool,
    npm_available: bool,
    package_available: bool,
    message: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DshRuntimeLog {
    time: u64,
    phase: String,
    stream: String,
    text: String,
}

fn absolute_path(path: PathBuf) -> PathBuf {
    if path.is_absolute() {
        path
    } else {
        env::current_dir()
            .map(|directory| directory.join(&path))
            .unwrap_or(path)
    }
}

fn dsh_home() -> PathBuf {
    let configured =
        env::var_os("DSH_HOME").filter(|value| !value.to_string_lossy().trim().is_empty());
    let home = if cfg!(windows) {
        env::var_os("USERPROFILE")
    } else {
        env::var_os("HOME")
    };
    absolute_path(
        configured
            .map(PathBuf::from)
            .or_else(|| home.map(PathBuf::from).map(|path| path.join(".dsh")))
            .unwrap_or_else(|| PathBuf::from(".dsh")),
    )
}

fn logs_directory() -> PathBuf {
    dsh_home().join("logs")
}

fn persistent_log_path() -> PathBuf {
    logs_directory().join("deeptop.log")
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

/// Convert epoch seconds (UTC) into a `YYYY-MM-DD HH:MM:SS` string using the
/// civil-from-days algorithm so log files stay readable without a date crate.
fn format_utc_datetime(epoch_seconds: i64) -> String {
    let days = epoch_seconds.div_euclid(86_400);
    let seconds_of_day = epoch_seconds.rem_euclid(86_400);
    let hour = seconds_of_day / 3600;
    let minute = (seconds_of_day % 3600) / 60;
    let second = seconds_of_day % 60;
    let z = days + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}")
}

fn format_log_line(entry: &DshRuntimeLog) -> String {
    format!(
        "[{}.{:03}] [{}/{}] {}",
        format_utc_datetime((entry.time / 1000) as i64),
        entry.time % 1000,
        entry.phase,
        entry.stream,
        entry.text
    )
}

/// Keep large DSH responses from making log snapshots and the viewer expensive.
fn bound_log_text(text: String) -> String {
    if text.len() <= MAX_LOG_TEXT_BYTES {
        return text;
    }
    let mut end = MAX_LOG_TEXT_BYTES;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…（日志已截断，原始 {} 字节）", &text[..end], text.len())
}

/// Best-effort append of one formatted line to the persistent log file.
/// Logging must never break the runtime, so every failure is ignored.
fn append_log_file(path: &Path, line: &str) {
    if fs::metadata(path).map(|meta| meta.len()).unwrap_or(0) > MAX_LOG_FILE_BYTES {
        let rotated = path.with_extension("log.1");
        let _ = fs::rename(path, rotated);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}

fn write_text(path: &Path, content: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法确定文件目录：{}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建 {}：{error}", parent.display()))?;
    if fs::read_to_string(path).ok().as_deref() == Some(content) {
        return Ok(());
    }
    fs::write(path, content).map_err(|error| format!("无法写入 {}：{error}", path.display()))
}

fn write_if_missing(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    write_text(path, content)
}

fn ensure_desktop_profile_manifest(path: &Path) -> Result<(), String> {
    let mut manifest: Value = if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("无法读取 desktop Profile：{error}"))?;
        serde_json::from_str(&raw)
            .map_err(|error| format!("desktop Profile 的 package.json 无效：{error}"))?
    } else {
        serde_json::from_str(PROFILE_TEMPLATE).expect("embedded desktop profile must be valid JSON")
    };

    let root = manifest
        .as_object_mut()
        .ok_or_else(|| "desktop Profile 的 package.json 必须是 JSON 对象".to_string())?;
    root.entry("name".to_string())
        .or_insert_with(|| Value::String("dsh-profile-desktop".to_string()));
    root.entry("private".to_string())
        .or_insert(Value::Bool(true));
    root.entry("dependencies".to_string())
        .or_insert_with(|| json!({}));

    let dsh = root
        .entry("dsh".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "desktop Profile 的 dsh 字段必须是对象".to_string())?;
    let profile = dsh
        .entry("profile".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or_else(|| "desktop Profile 的 dsh.profile 字段必须是对象".to_string())?;
    let bundles = profile
        .entry("bundles".to_string())
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "desktop Profile 的 dsh.profile.bundles 字段必须是数组".to_string())?;

    // Migrate the old bridge name; loading both bundles duplicates every service entry.
    let mut user_bundles = Vec::new();
    for bundle in bundles.drain(..) {
        match bundle.as_str() {
            Some("@deepseek-ai/dsh-base")
            | Some("deeptop-bridge")
            | Some("@dsh-desktop/bridge") => {}
            Some(_) => user_bundles.push(bundle),
            None => return Err("desktop Profile 的 bundles 只能包含包名字符串".to_string()),
        }
    }
    bundles.push(Value::String("@deepseek-ai/dsh-base".to_string()));
    bundles.push(Value::String("deeptop-bridge".to_string()));
    bundles.append(&mut user_bundles);

    let content = format!(
        "{}\n",
        serde_json::to_string_pretty(&manifest)
            .map_err(|error| format!("无法序列化 desktop Profile：{error}"))?
    );
    write_text(path, &content)
}

fn materialize_desktop_profile() -> Result<(), String> {
    let profiles = dsh_home().join("profiles");
    let profile_dir = profiles.join(DSH_PROFILE);
    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("无法创建 desktop Profile：{error}"))?;
    ensure_desktop_profile_manifest(&profile_dir.join("package.json"))?;
    write_if_missing(
        &profile_dir.join("cordis.patch.yml"),
        PROFILE_PATCH_TEMPLATE,
    )?;
    write_if_missing(
        &profile_dir.join("pnpm-workspace.yaml"),
        PROFILE_PNPM_WORKSPACE,
    )?;

    let bridge_dir = profiles.join("node_modules").join("deeptop-bridge");
    write_text(&bridge_dir.join("package.json"), BRIDGE_PACKAGE_JSON)?;
    write_text(&bridge_dir.join("cordis.patch.yml"), BRIDGE_PATCH)?;
    write_text(&bridge_dir.join("index.mjs"), BRIDGE_ENTRY)?;
    write_text(&bridge_dir.join("bridge.mjs"), BRIDGE_RUNTIME)?;
    write_text(&bridge_dir.join("routes.mjs"), BRIDGE_ROUTES)?;
    write_text(
        &bridge_dir.join("session-repair.mjs"),
        BRIDGE_SESSION_REPAIR,
    )?;
    write_text(
        &bridge_dir.join("message-annotations.mjs"),
        BRIDGE_MESSAGE_ANNOTATIONS,
    )?;
    write_text(
        &bridge_dir.join("skill-installer.mjs"),
        BRIDGE_SKILL_INSTALLER,
    )?;
    write_text(
        &bridge_dir.join("skill-install-plugin.mjs"),
        BRIDGE_SKILL_INSTALL_PLUGIN,
    )?;
    write_text(&bridge_dir.join("plugin-config.mjs"), BRIDGE_PLUGIN_CONFIG)?;
    Ok(())
}

fn executable_from_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

fn node_executable() -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    executable_from_path(name).ok_or_else(|| "未找到 Node.js，请先安装 Node.js 后重试".to_string())
}

fn npm_executable() -> Result<PathBuf, String> {
    let name = if cfg!(windows) { "npm.cmd" } else { "npm" };
    executable_from_path(name)
        .or_else(|| {
            node_executable().ok().and_then(|node| {
                node.parent()
                    .map(|directory| directory.join(name))
                    .filter(|path| path.is_file())
            })
        })
        .ok_or_else(|| "未找到 npm，请确认 Node.js 安装完整后重试".to_string())
}

fn npm_available() -> bool {
    npm_command().is_ok()
}

fn npm_command() -> Result<Command, String> {
    let mut command = if cfg!(windows) {
        let npm = npm_executable()?;
        let node = npm
            .parent()
            .map(|directory| directory.join("node.exe"))
            .filter(|path| path.is_file())
            .or_else(|| executable_from_path("node.exe"))
            .ok_or_else(|| "未找到与 npm 对应的 node.exe".to_string())?;
        let npm_cli = npm
            .parent()
            .map(|directory| directory.join("node_modules/npm/bin/npm-cli.js"))
            .filter(|path| path.is_file())
            .ok_or_else(|| "未找到 npm 的 npm-cli.js".to_string())?;
        let mut command = Command::new(node);
        command.arg(npm_cli);
        command
    } else {
        Command::new(npm_executable()?)
    };
    command
        .env("NO_COLOR", "1")
        .env("CI", "1")
        .env("NPM_CONFIG_YES", "true")
        .env("NPM_CONFIG_AUDIT", "false")
        .env("NPM_CONFIG_FUND", "false")
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false")
        // Do not inherit npm's temporary prefix/cache/lifecycle environment when
        // Deeptop itself was started from an npm script. Use the user's normal
        // global install and npm cache locations instead.
        .env_remove("NPM_CONFIG_CACHE")
        .env_remove("npm_config_cache")
        .env_remove("NPM_CONFIG_GLOBALCONFIG")
        .env_remove("npm_config_globalconfig")
        // A user's .npmrc may set offline=true. Network phases must override it;
        // the launch command below still passes an explicit --offline flag.
        .env("NPM_CONFIG_OFFLINE", "false")
        .env("npm_config_offline", "false")
        .env_remove("NPM_CONFIG_GLOBAL_PREFIX")
        .env_remove("npm_config_global_prefix")
        .env_remove("NPM_CONFIG_PREFIX")
        .env_remove("npm_config_prefix")
        .env_remove("NPM_CONFIG_LOCAL_PREFIX")
        .env_remove("npm_config_local_prefix")
        .env_remove("NPM_CONFIG_PACKAGE")
        .env_remove("npm_config_package")
        .env_remove("npm_command")
        .env_remove("npm_execpath")
        .env_remove("npm_lifecycle_event")
        .env_remove("npm_lifecycle_script")
        .env_remove("npm_package_json")
        .env_remove("npm_node_execpath")
        .env("NPM_CONFIG_PREFER_OFFLINE", "false")
        .env("npm_config_prefer_offline", "false")
        .env("NPM_CONFIG_MAXSOCKETS", "50")
        .env("NPM_CONFIG_PROGRESS", "false");
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    #[cfg(unix)]
    configure_process_group(&mut command);
    Ok(command)
}

fn run_npm_with_timeout(mut command: Command, timeout: Duration) -> Result<Output, String> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法执行 npm：{error}"))?;
    let pid = child.id();
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 npm 标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 npm 错误输出".to_string())?;
    let (sender, receiver) = mpsc::channel();
    let stdout_sender = sender.clone();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut bytes);
        let _ = stdout_sender.send((true, bytes));
    });
    let stderr_sender = sender.clone();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut bytes);
        let _ = stderr_sender.send((false, bytes));
    });
    drop(sender);
    let deadline = std::time::Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if std::time::Instant::now() >= deadline => {
                terminate_process_tree(pid);
                let _ = child.wait();
                return Err("npm 命令超时".to_string());
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(error) => {
                terminate_process_tree(pid);
                let _ = child.wait();
                return Err(format!("等待 npm 命令结束失败：{error}"));
            }
        }
    };
    let mut stdout = Vec::new();
    let mut stderr = Vec::new();
    let mut streams_received = 0;
    while streams_received < 2 {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok((is_stdout, bytes)) => {
                if is_stdout {
                    stdout = bytes;
                } else {
                    stderr = bytes;
                }
                streams_received += 1;
            }
            Err(mpsc::RecvTimeoutError::Timeout | mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn dsh_package_manifest_at(root: &Path) -> PathBuf {
    root.join("node_modules")
        .join("@deepseek-ai")
        .join("dsh")
        .join("package.json")
}

fn is_dsh_package_manifest(content: &str) -> bool {
    serde_json::from_str::<Value>(content)
        .ok()
        .and_then(|package| {
            package
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .as_deref()
        == Some("@deepseek-ai/dsh")
}

fn dsh_package_available_at(root: &Path) -> bool {
    let manifest = dsh_package_manifest_at(root);
    let Ok(content) = fs::read_to_string(manifest) else {
        return false;
    };
    is_dsh_package_manifest(&content)
}

fn dsh_package_manifest_in_node_modules(root: &Path) -> PathBuf {
    root.join("@deepseek-ai").join("dsh").join("package.json")
}

fn dsh_package_available_in_node_modules(root: &Path) -> bool {
    let manifest = dsh_package_manifest_in_node_modules(root);
    let Ok(content) = fs::read_to_string(manifest) else {
        return false;
    };
    is_dsh_package_manifest(&content)
}

fn npm_global_value(args: &[&str]) -> Option<PathBuf> {
    let mut command = npm_command().ok()?;
    command.args(args).arg("--offline=false");
    let output = run_npm_with_timeout(command, DSH_DISCOVERY_TIMEOUT).ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn npm_global_root() -> Option<PathBuf> {
    npm_global_value(&["root", "--global"]).filter(|path| path.is_dir())
}

fn npm_global_prefix() -> Option<PathBuf> {
    npm_global_value(&["prefix", "--global"]).filter(|path| path.is_dir())
}

fn npm_cached_dsh_root() -> Option<PathBuf> {
    let cache = npm_global_value(&["config", "get", "cache"])?;
    let npx_root = cache.join("_npx");
    fs::read_dir(npx_root)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|path| path.is_dir() && dsh_package_available_at(path))
}

fn dsh_executable_from_path() -> Option<PathBuf> {
    if cfg!(windows) {
        executable_from_path("dsh.cmd")
            .or_else(|| executable_from_path("dsh.exe"))
            .or_else(|| executable_from_path("dsh"))
    } else {
        executable_from_path("dsh")
    }
}

fn dsh_executable_from_global_prefix() -> Option<PathBuf> {
    let prefix = npm_global_prefix()?;
    let candidates = if cfg!(windows) {
        vec![
            prefix.join("dsh.cmd"),
            prefix.join("dsh.exe"),
            prefix.join("dsh"),
        ]
    } else {
        vec![prefix.join("bin").join("dsh"), prefix.join("dsh")]
    };
    candidates.into_iter().find(|path| path.is_file())
}

fn npm_dsh_launch(
    source: DshSource,
    prefix: Option<&Path>,
    global: bool,
) -> Result<DshLaunch, String> {
    let mut command = npm_command()?;
    command.arg("exec");
    if global {
        command.arg("--global");
    }
    let prefix_value = prefix.map(|path| path.to_string_lossy().into_owned());
    if let Some(prefix) = prefix_value.as_deref() {
        command.args(["--prefix", prefix]);
    }
    command.args(["--offline", "--", "dsh", "--profile", DSH_PROFILE]);
    command
        .current_dir(dsh_home())
        .env("DSH_HOME", dsh_home())
        .env_remove("DSH_CWD");
    Ok(DshLaunch {
        source,
        command,
        label: source.label().to_string(),
    })
}

fn path_dsh_launch(executable: PathBuf) -> DshLaunch {
    let mut command = if cfg!(windows)
        && executable.extension().and_then(|value| value.to_str()) == Some("cmd")
    {
        let command_line = format!("\"{}\" --profile {}", executable.display(), DSH_PROFILE);
        let mut command = Command::new("cmd");
        command.args(["/D", "/S", "/C"]);
        #[cfg(windows)]
        {
            // cmd /C needs an outer quote pair around a quoted .cmd path.
            command.raw_arg(format!("\"{command_line}\""));
        }
        #[cfg(not(windows))]
        command.arg(command_line);
        command
    } else {
        let mut command = Command::new(&executable);
        command.args(["--profile", DSH_PROFILE]);
        command
    };
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
        .current_dir(dsh_home())
        .env("DSH_HOME", dsh_home())
        .env_remove("DSH_CWD");
    DshLaunch {
        source: DshSource::PathExecutable,
        command,
        label: format!("PATH 命令：{}", executable.display()),
    }
}

fn resolve_dsh_launch() -> Result<Option<DshLaunch>, String> {
    let home = dsh_home();
    if let Some(executable) = dsh_executable_from_path() {
        return Ok(Some(path_dsh_launch(executable)));
    }
    if let Some(root) = npm_global_root() {
        if dsh_package_available_in_node_modules(&root) {
            if let Some(executable) = dsh_executable_from_global_prefix() {
                return Ok(Some(path_dsh_launch(executable)));
            }
            return Ok(Some(npm_dsh_launch(DshSource::GlobalPrefix, None, true)?));
        }
    }
    if dsh_package_available_at(&home) {
        return Ok(Some(npm_dsh_launch(
            DshSource::LocalPrefix,
            Some(&home),
            false,
        )?));
    }
    if let Some(cache_root) = npm_cached_dsh_root() {
        return Ok(Some(npm_dsh_launch(
            DshSource::NpmCache,
            Some(&cache_root),
            false,
        )?));
    }
    let mut probe = npm_command()?;
    probe
        .args([
            "exec",
            "--offline",
            "--package=@deepseek-ai/dsh",
            "--",
            "dsh",
            "--version",
        ])
        .current_dir(&home);
    if run_npm_with_timeout(probe, DSH_DISCOVERY_TIMEOUT)
        .map(|output| output.status.success())
        .unwrap_or(false)
    {
        return Ok(Some(npm_dsh_launch(DshSource::NpmCache, None, false)?));
    }
    Ok(None)
}

fn local_dsh_launch() -> Result<DshLaunch, String> {
    npm_dsh_launch(DshSource::LocalPrefix, Some(&dsh_home()), false)
}

fn install_dsh(
    manager: &BridgeManager,
    app: &AppHandle,
    generation: u64,
    registry: &str,
) -> Result<(), String> {
    let home = dsh_home();
    fs::create_dir_all(&home).map_err(|error| format!("无法创建 DSH 目录：{error}"))?;
    write_if_missing(&home.join("package.json"), DSH_PACKAGE_JSON)?;
    let prefix = home.to_string_lossy().into_owned();
    let mut command = npm_command()?;
    let command_label = format!(
        "npm install --prefix {} --registry {} --no-audit --no-fund {}",
        prefix, registry, DSH_PACKAGE
    );
    manager.emit_runtime_log(app, generation, "install", "command", command_label);
    command
        .args([
            "install",
            "--prefix",
            &prefix,
            "--registry",
            registry,
            "--no-audit",
            "--no-fund",
            "--no-update-notifier",
            "--prefer-online",
            "--offline=false",
            "--fetch-retries=1",
            "--fetch-retry-mintimeout=1000",
            "--fetch-retry-maxtimeout=5000",
            "--fetch-timeout=30000",
            "--progress=false",
            DSH_PACKAGE,
        ])
        .current_dir(&home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| format!("无法执行 DSH 安装：{error}"))?;
    let pid = child.id();
    let active = manager
        .state
        .lock()
        .map(|mut state| {
            if state.generation != generation || state.phase != RuntimePhase::Installing {
                return false;
            }
            state.install_pid = Some(pid);
            true
        })
        .unwrap_or(false);
    if !active {
        terminate_process_tree(pid);
        let _ = child.wait();
        return Err("DSH 安装已取消".to_string());
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法获取 DSH 安装标准输出".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法获取 DSH 安装错误输出".to_string())?;
    let (line_sender, line_receiver) = mpsc::channel::<(String, String)>();
    let stdout_sender = line_sender.clone();
    thread::spawn(move || {
        for line in lossy_lines(stdout).flatten() {
            let _ = stdout_sender.send(("stdout".to_string(), line));
        }
    });
    let stderr_sender = line_sender.clone();
    thread::spawn(move || {
        for line in lossy_lines(stderr).flatten() {
            let _ = stderr_sender.send(("stderr".to_string(), line));
        }
    });
    drop(line_sender);
    let (exit_sender, exit_receiver) = mpsc::channel();
    thread::spawn(move || {
        let _ = exit_sender.send(child.wait());
    });
    let deadline = std::time::Instant::now() + DSH_INSTALL_TIMEOUT;
    let mut stderr_lines = Vec::new();
    let status = loop {
        while let Ok((stream, line)) = line_receiver.try_recv() {
            if stream == "stderr" && !line.trim().is_empty() {
                stderr_lines.push(line.clone());
                if stderr_lines.len() > 12 {
                    stderr_lines.remove(0);
                }
            }
            manager.emit_runtime_log(app, generation, "install", &stream, line);
        }
        match exit_receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(status)) => {
                while let Ok((stream, line)) = line_receiver.try_recv() {
                    if stream == "stderr" && !line.trim().is_empty() {
                        stderr_lines.push(line.clone());
                    }
                    manager.emit_runtime_log(app, generation, "install", &stream, line);
                }
                break status;
            }
            Ok(Err(error)) => {
                if let Ok(mut state) = manager.state.lock() {
                    if state.generation == generation {
                        state.install_pid = None;
                    }
                }
                return Err(format!("等待 DSH 安装结束失败：{error}"));
            }
            Err(mpsc::RecvTimeoutError::Timeout) if std::time::Instant::now() >= deadline => {
                terminate_process_tree(pid);
                if let Ok(mut state) = manager.state.lock() {
                    if state.generation == generation {
                        state.install_pid = None;
                    }
                }
                return Err("DSH 安装超时，请检查 npm 网络连接后重试。".to_string());
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if !manager.is_current(generation) {
                    terminate_process_tree(pid);
                    return Err("DSH 安装已取消".to_string());
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("DSH 安装进程已断开".to_string());
            }
        }
    };
    manager.emit_runtime_log(
        app,
        generation,
        "install",
        "diagnostic",
        format!("npm 安装进程结束，退出码 {}", status.code().unwrap_or(-1)),
    );
    if let Ok(mut state) = manager.state.lock() {
        if state.generation == generation {
            state.install_pid = None;
        }
    }
    if !status.success() {
        let detail = stderr_lines
            .iter()
            .rev()
            .take(3)
            .rev()
            .cloned()
            .collect::<Vec<_>>()
            .join(" ");
        return Err(if detail.is_empty() {
            format!("DSH 安装失败（退出码 {}）", status.code().unwrap_or(-1))
        } else {
            format!("DSH 安装失败：{detail}")
        });
    }
    if !manager.is_current(generation) {
        return Err("DSH 安装已取消".to_string());
    }
    if dsh_package_available_at(&home) {
        Ok(())
    } else {
        Err(format!(
            "DSH 安装校验失败：未找到 {}",
            dsh_package_manifest_at(&home).display()
        ))
    }
}

#[cfg(windows)]
fn configure_hidden_process(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

fn terminate_process_tree(pid: u32) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        configure_hidden_process(&mut command);
        let _ = command.status();
    }
    #[cfg(unix)]
    {
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .status();
    }
}

fn pending_error(state: &mut BridgeState, message: String) {
    let pending = std::mem::take(&mut state.pending);
    for (_, sender) in pending {
        let _ = sender.send(Err(message.clone()));
    }
}

impl BridgeManager {
    fn status(&self) -> DshStatus {
        let state = self.state.lock();
        let (runtime_available, runtime_starting, installing, message) = match state {
            Ok(state) => (
                state.phase == RuntimePhase::Ready,
                matches!(
                    state.phase,
                    RuntimePhase::Checking | RuntimePhase::Installing | RuntimePhase::Starting
                ),
                state.phase == RuntimePhase::Installing,
                state.message.clone(),
            ),
            Err(_) => (false, false, false, "DSH 启动状态不可用".to_string()),
        };
        let (registry_testing, selected_registry) = self
            .state
            .lock()
            .map(|state| (state.registry_testing, state.selected_registry.clone()))
            .unwrap_or((false, None));
        DshStatus {
            dsh_home: dsh_home().to_string_lossy().into_owned(),
            runtime_directory: dsh_home().to_string_lossy().into_owned(),
            package_name: DSH_PACKAGE.to_string(),
            runtime_available,
            runtime_starting,
            installing,
            registry_testing,
            selected_registry,
            node_available: node_executable().is_ok(),
            npm_available: npm_available(),
            package_available: self
                .state
                .lock()
                .map(|state| state.package_available)
                .unwrap_or(false),
            message,
        }
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit("dsh-runtime-status", self.status());
    }

    fn ensure_started(&self, app: &AppHandle) {
        let should_start = self
            .state
            .lock()
            .map(|state| matches!(state.phase, RuntimePhase::Idle | RuntimePhase::Failed))
            .unwrap_or(false);
        if should_start {
            self.start(app.clone());
        }
    }

    fn start(&self, app: AppHandle) {
        let generation = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if matches!(
                state.phase,
                RuntimePhase::Checking
                    | RuntimePhase::Installing
                    | RuntimePhase::Starting
                    | RuntimePhase::Ready
            ) {
                return;
            }
            state.generation += 1;
            state.phase = RuntimePhase::Checking;
            state.message = "正在检查 DSH 安装...".to_string();
            state.auto_restart_pending = false;
            state.generation
        };
        self.emit_status(&app);
        let manager = self.clone();
        thread::spawn(move || manager.prepare_and_launch(app, generation));
    }

    fn stop(&self, message: &str) {
        let (pid, install_pid) = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            state.generation += 1;
            state.phase = RuntimePhase::Idle;
            state.message = message.to_string();
            state.registry_testing = false;
            state.stdin = None;
            state.crash_count = 0;
            state.auto_restart_pending = false;
            let pid = state.pid.take();
            let install_pid = state.install_pid.take();
            pending_error(&mut state, "DSH 桌面宿主已停止".to_string());
            (pid, install_pid)
        };
        if let Some(pid) = pid.or(install_pid) {
            terminate_process_tree(pid);
        }
    }

    fn restart(&self, app: AppHandle) {
        self.stop("正在重新启动 DSH...");
        self.emit_status(&app);
        self.start(app);
    }

    fn prepare_and_launch(&self, app: AppHandle, generation: u64) {
        let result = (|| -> Result<DshLaunch, String> {
            materialize_desktop_profile()?;
            let launch = if let Some(launch) = resolve_dsh_launch()? {
                self.emit_runtime_log(
                    &app,
                    generation,
                    "start",
                    "diagnostic",
                    format!("复用 {} 启动 DSH", launch.source.label()),
                );
                launch
            } else {
                node_executable()?;
                npm_executable()?;
                let changed = self
                    .state
                    .lock()
                    .map(|mut state| {
                        if state.generation != generation {
                            return false;
                        }
                        state.phase = RuntimePhase::Installing;
                        state.registry_testing = true;
                        state.message = "未检测到可用的 DSH，正在测试 npm 下载速度...".to_string();
                        true
                    })
                    .unwrap_or(false);
                if changed {
                    self.emit_status(&app);
                }
                let selection = registry::select(npm_command);
                for probe in &selection.probes {
                    self.emit_runtime_log(
                        &app,
                        generation,
                        "registry",
                        "diagnostic",
                        if probe.ok {
                            format!(
                                "registry {} 可用，响应耗时 {} ms",
                                probe.registry, probe.elapsed_ms
                            )
                        } else {
                            format!(
                                "registry {} 不可用或响应超时（{} ms）",
                                probe.registry, probe.elapsed_ms
                            )
                        },
                    );
                }
                if selection.all_failed {
                    self.emit_runtime_log(
                        &app,
                        generation,
                        "registry",
                        "diagnostic",
                        "所有 npm registry 测速均失败，回退到 npm 官方源安装 DSH".to_string(),
                    );
                }
                if let Ok(mut state) = self.state.lock() {
                    if state.generation == generation {
                        state.registry_testing = false;
                        state.selected_registry = Some(selection.registry.clone());
                        state.message = format!("使用 {} 安装 DSH...", selection.registry);
                    }
                }
                self.emit_status(&app);
                install_dsh(self, &app, generation, &selection.registry)?;
                local_dsh_launch()?
            };
            if !self.is_current(generation) {
                return Err("DSH 启动已取消".to_string());
            }
            if let Ok(mut state) = self.state.lock() {
                state.registry_testing = false;
                state.package_available = true;
            }
            Ok(launch)
        })();

        let launch = match result {
            Ok(launch) => launch,
            Err(message) => {
                self.fail_start(&app, generation, message);
                return;
            }
        };
        let changed = self
            .state
            .lock()
            .map(|mut state| {
                if state.generation != generation
                    || state.phase != RuntimePhase::Installing
                        && state.phase != RuntimePhase::Checking
                {
                    return false;
                }
                state.phase = RuntimePhase::Starting;
                state.message = "正在启动 DSH...".to_string();
                true
            })
            .unwrap_or(false);
        if changed {
            self.emit_status(&app);
        }
        self.launch(app, generation, launch);
    }

    fn launch(&self, app: AppHandle, generation: u64, launch: DshLaunch) {
        let result = (|| -> Result<_, String> {
            let DshLaunch {
                source,
                label,
                mut command,
            } = launch;
            self.emit_runtime_log(
                &app,
                generation,
                "start",
                "command",
                format!("{}：{}", source.label(), label),
            );
            command
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            let mut child = command
                .spawn()
                .map_err(|error| format!("无法启动 DSH：{error}"))?;
            let pid = child.id();
            let stdin = child
                .stdin
                .take()
                .ok_or_else(|| "无法获取 DSH 标准输入".to_string())?;
            let stdout = child
                .stdout
                .take()
                .ok_or_else(|| "无法获取 DSH 标准输出".to_string())?;
            let stderr = child
                .stderr
                .take()
                .ok_or_else(|| "无法获取 DSH 错误输出".to_string())?;
            Ok((child, pid, stdin, stdout, stderr))
        })();

        let (mut child, pid, stdin, stdout, stderr) = match result {
            Ok(parts) => parts,
            Err(message) => {
                self.fail_start(&app, generation, message);
                return;
            }
        };

        let active = self
            .state
            .lock()
            .map(|mut state| {
                if state.generation != generation || state.phase != RuntimePhase::Starting {
                    return false;
                }
                state.pid = Some(pid);
                state.stdin = Some(Arc::new(Mutex::new(stdin)));
                true
            })
            .unwrap_or(false);
        if !active {
            terminate_process_tree(pid);
            let _ = child.wait();
            return;
        }

        let stdout_manager = self.clone();
        let stdout_app = app.clone();
        thread::spawn(move || {
            for line in lossy_lines(stdout) {
                match line {
                    Ok(line) => stdout_manager.handle_stdout(&stdout_app, generation, line),
                    Err(error) => stdout_manager.emit_diagnostic(
                        &stdout_app,
                        generation,
                        format!("读取 DSH 输出失败：{error}"),
                    ),
                }
            }
        });

        let stderr_manager = self.clone();
        let stderr_app = app.clone();
        thread::spawn(move || {
            for line in lossy_lines(stderr) {
                match line {
                    Ok(line) if !line.trim().is_empty() => stderr_manager.emit_runtime_log(
                        &stderr_app,
                        generation,
                        "runtime",
                        "stderr",
                        line,
                    ),
                    Ok(_) => {}
                    Err(error) => stderr_manager.emit_runtime_log(
                        &stderr_app,
                        generation,
                        "runtime",
                        "stderr",
                        format!("读取 DSH 错误输出失败：{error}"),
                    ),
                }
            }
        });

        let wait_manager = self.clone();
        thread::spawn(move || {
            let result = child.wait();
            wait_manager.process_finished(&app, generation, pid, result);
        });
    }

    fn fail_start(&self, app: &AppHandle, generation: u64, message: String) {
        let changed = self
            .state
            .lock()
            .map(|mut state| {
                if state.generation != generation {
                    return false;
                }
                state.phase = RuntimePhase::Failed;
                state.message = message;
                pending_error(&mut state, "DSH 未能启动".to_string());
                true
            })
            .unwrap_or(false);
        if changed {
            self.emit_status(app);
        }
    }

    fn is_current(&self, generation: u64) -> bool {
        self.state
            .lock()
            .map(|state| state.generation == generation)
            .unwrap_or(false)
    }

    fn emit_runtime_log(
        &self,
        app: &AppHandle,
        generation: u64,
        phase: &str,
        stream: &str,
        text: impl Into<String>,
    ) {
        let text = bound_log_text(text.into());
        let entry = DshRuntimeLog {
            time: now_millis(),
            phase: phase.to_string(),
            stream: stream.to_string(),
            text: text.clone(),
        };
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(entry.clone());
        }
        self.persist_log(&entry);
        if !self.is_current(generation) {
            return;
        }
        let _ = app.emit("dsh-runtime-log", entry);
        if stream == "diagnostic" || stream == "stderr" {
            let _ = app.emit("dsh-diagnostic", text);
        }
    }

    fn emit_diagnostic(&self, app: &AppHandle, generation: u64, message: String) {
        self.emit_runtime_log(app, generation, "runtime", "diagnostic", message);
    }

    fn persist_log(&self, entry: &DshRuntimeLog) {
        self.log_writer.enqueue(entry);
    }

    fn log_snapshot(&self) -> Vec<DshRuntimeLog> {
        self.logs
            .lock()
            .map(|logs| logs.snapshot())
            .unwrap_or_default()
    }

    fn recent_log_snapshot(&self) -> Vec<DshRuntimeLog> {
        self.logs
            .lock()
            .map(|logs| logs.recent_snapshot(MAX_LOG_VIEW_ENTRIES))
            .unwrap_or_default()
    }

    /// Record a frontend-originated event (window error, unhandled rejection or
    /// console.error with its stack trace) into the shared log store.
    fn log_frontend(&self, stream: String, text: String) {
        let entry = DshRuntimeLog {
            time: now_millis(),
            phase: "frontend".to_string(),
            stream,
            text: bound_log_text(text),
        };
        if let Ok(mut logs) = self.logs.lock() {
            logs.push(entry.clone());
        }
        self.persist_log(&entry);
    }

    /// 生成格式化后的日志导出文本（不再写盘；由前端通过原生“另存为”对话框落盘）。
    fn log_export_content(&self) -> String {
        let entries = self.log_snapshot();
        let mut content = format!(
            "Deeptop log export\nTime: {}\nDSH home: {}\nPlatform: {}\nEntries: {}\n\n",
            format_utc_datetime((now_millis() / 1000) as i64),
            dsh_home().display(),
            env::consts::OS,
            entries.len(),
        );
        for entry in &entries {
            content.push_str(&format_log_line(entry));
            content.push('\n');
        }
        content
    }

    fn handle_stdout(&self, app: &AppHandle, generation: u64, line: String) {
        self.emit_runtime_log(app, generation, "runtime", "stdout", line.clone());
        let frame: Value = match serde_json::from_str(&line) {
            Ok(frame) => frame,
            Err(_) => {
                return;
            }
        };
        let frame_type = frame
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        match frame_type {
            "ready" => {
                let changed = self
                    .state
                    .lock()
                    .map(|mut state| {
                        if state.generation != generation || state.phase != RuntimePhase::Starting {
                            return false;
                        }
                        state.phase = RuntimePhase::Ready;
                        state.message = "DSH 已就绪".to_string();
                        state.crash_count = 0;
                        true
                    })
                    .unwrap_or(false);
                if changed {
                    self.emit_status(app);
                }
            }
            "response" => {
                let Some(id) = frame.get("id").and_then(Value::as_str) else {
                    self.emit_diagnostic(
                        app,
                        generation,
                        "DSH bridge 返回了缺少 id 的响应".to_string(),
                    );
                    return;
                };
                let response = if let Some(error) = frame.get("error").and_then(Value::as_str) {
                    Err(error.to_string())
                } else if let Some(response) = frame.get("response") {
                    Ok(response.clone())
                } else {
                    Err("DSH bridge 响应缺少结果".to_string())
                };
                let sender = self.state.lock().ok().and_then(|mut state| {
                    if state.generation != generation {
                        return None;
                    }
                    state.pending.remove(id)
                });
                if let Some(sender) = sender {
                    let _ = sender.send(response);
                }
            }
            "event" => {
                if self.is_current(generation) {
                    let _ = app.emit("deeptop-bridge-event", frame);
                }
            }
            "diagnostic" => {
                let message = frame
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("DSH bridge 诊断信息")
                    .to_string();
                self.emit_diagnostic(app, generation, message);
            }
            "fatal" => {
                let message = frame
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("DSH desktop bridge 已退出")
                    .to_string();
                self.fail_start(app, generation, message);
            }
            "protocol-error" => {
                let message = frame
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("DSH bridge 协议错误")
                    .to_string();
                self.emit_diagnostic(app, generation, message);
            }
            _ => self.emit_diagnostic(app, generation, line),
        }
    }

    fn process_finished(
        &self,
        app: &AppHandle,
        generation: u64,
        pid: u32,
        result: std::io::Result<std::process::ExitStatus>,
    ) {
        let (changed, restart_delay) = self
            .state
            .lock()
            .map(|mut state| {
                if state.generation != generation || state.pid != Some(pid) {
                    return (false, None);
                }
                state.pid = None;
                state.stdin = None;
                if state.phase != RuntimePhase::Failed {
                    state.phase = RuntimePhase::Failed;
                    state.message = match result {
                        Ok(status) => {
                            format!("DSH 桌面宿主已退出（{}）", status.code().unwrap_or(-1))
                        }
                        Err(error) => format!("等待 DSH 结束失败：{error}"),
                    };
                }
                let message = state.message.clone();
                pending_error(&mut state, message);
                // Auto-recover from an unexpected exit: schedule a bounded restart
                // with a short backoff. `stop()` (manual restart) and a successful
                // boot reset the counter, so this only loops when DSH keeps dying
                // without reaching Ready (guards against a crash loop).
                let restart_delay =
                    if !state.auto_restart_pending && state.crash_count < MAX_AUTO_RESTARTS {
                        state.crash_count += 1;
                        state.auto_restart_pending = true;
                        let count = state.crash_count;
                        let delay = AUTO_RESTART_BASE_DELAY
                            .saturating_mul(1u32 << count.saturating_sub(1).min(8));
                        Some(delay)
                    } else {
                        None
                    };
                (true, restart_delay)
            })
            .unwrap_or((false, None));
        if changed {
            self.emit_status(app);
        }
        if let Some(delay) = restart_delay {
            let manager = self.clone();
            let app = app.clone();
            let message = format!(
                "检测到 DSH 意外退出，将在 {} 秒后自动重启",
                delay.as_secs_f32().round().max(1.0)
            );
            self.emit_runtime_log(&app, generation, "runtime", "diagnostic", message);
            thread::spawn(move || {
                thread::sleep(delay);
                if let Ok(mut state) = manager.state.lock() {
                    state.auto_restart_pending = false;
                }
                manager.ensure_started(&app);
            });
        }
    }

    fn request(&self, method: String, payload: Value) -> Result<Value, String> {
        let request_id = format!(
            "desktop-{}",
            self.next_request_id.fetch_add(1, Ordering::Relaxed) + 1
        );
        let (sender, receiver) = mpsc::channel();
        let stdin = {
            let mut state = self
                .state
                .lock()
                .map_err(|_| "DSH 桌面宿主状态锁已损坏".to_string())?;
            if state.phase != RuntimePhase::Ready {
                return Err(state.message.clone());
            }
            let stdin = state
                .stdin
                .clone()
                .ok_or_else(|| "DSH 桌面宿主没有可用的输入通道".to_string())?;
            state.pending.insert(request_id.clone(), sender);
            stdin
        };

        let frame = json!({
            "id": request_id,
            "method": method,
            "payload": payload,
        });
        let encoded = format!(
            "{}\n",
            serde_json::to_string(&frame).map_err(|error| format!("无法编码 DSH 请求：{error}"))?
        );
        let write_result = stdin
            .lock()
            .map_err(|_| "DSH 输入通道锁已损坏".to_string())
            .and_then(|mut stdin| {
                stdin
                    .write_all(encoded.as_bytes())
                    .and_then(|_| stdin.flush())
                    .map_err(|error| format!("无法发送 DSH 请求：{error}"))
            });
        if let Err(error) = write_result {
            if let Ok(mut state) = self.state.lock() {
                state.pending.remove(&request_id);
            }
            return Err(error);
        }

        match receiver.recv_timeout(BRIDGE_TIMEOUT) {
            Ok(result) => result,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if let Ok(mut state) = self.state.lock() {
                    state.pending.remove(&request_id);
                }
                Err("等待 DSH 响应超时".to_string())
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err("DSH 响应通道已关闭".to_string()),
        }
    }
}

#[tauri::command]
fn check_dsh(app: AppHandle, runtime: State<'_, BridgeManager>) -> DshStatus {
    runtime.ensure_started(&app);
    runtime.status()
}

#[tauri::command]
fn refresh_dsh(app: AppHandle, runtime: State<'_, BridgeManager>) -> DshStatus {
    runtime.restart(app);
    runtime.status()
}

fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn validated_connection_url(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    let lower = normalized.to_ascii_lowercase();
    let scheme_length = if lower.starts_with("https://") {
        8
    } else if lower.starts_with("http://") {
        7
    } else {
        return Err("只允许打开 http 或 https 连接".to_string());
    };
    if normalized.is_empty()
        || normalized.chars().any(char::is_whitespace)
        || normalized.contains(['\r', '\n', '\\'])
    {
        return Err("连接地址无效".to_string());
    }
    let authority = normalized[scheme_length..]
        .split(['/', '?', '#'])
        .next()
        .unwrap_or_default();
    if authority.is_empty() || authority.starts_with(':') || authority.contains('@') {
        return Err("连接地址缺少有效主机".to_string());
    }
    Ok(normalized.to_string())
}

#[tauri::command]
fn open_connection_url(url: String) -> Result<(), String> {
    let value = validated_connection_url(&url)?;
    open_with_system_default(Path::new(&value)).map_err(|error| format!("打开连接失败：{error}"))
}

#[tauri::command]
fn open_nodejs_download() -> Result<(), String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd");
        command.args(["/C", "start", "", NODEJS_DOWNLOAD_URL]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(NODEJS_DOWNLOAD_URL);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(NODEJS_DOWNLOAD_URL);
        command
    };
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 Node.js 下载页面：{error}"))
}

fn publish_open_session(app: &AppHandle, runtime: &BridgeManager, session_id: String) {
    runtime.enqueue_open_session(session_id.clone());
    focus_main_window(app);
    let _ = app.emit("notification-click", json!({ "sessionId": session_id }));
}

#[tauri::command]
fn list_pending_open_sessions(runtime: State<'_, BridgeManager>) -> Vec<String> {
    runtime.list_pending_open_sessions()
}

#[tauri::command]
fn acknowledge_pending_open_session(runtime: State<'_, BridgeManager>, session_id: String) {
    runtime.acknowledge_pending_open_session(&session_id);
}

#[tauri::command]
fn send_system_notification(
    app: AppHandle,
    runtime: State<'_, BridgeManager>,
    title: String,
    body: String,
    session_id: Option<String>,
) -> Result<(), String> {
    let mut notification = DesktopNotification::new();
    notification.summary(&title).body(&body).auto_icon();
    #[cfg(windows)]
    if !tauri::is_dev() {
        notification.app_id("com.deeptop.desktop");
    }
    let handle = notification
        .show()
        .map_err(|error| format!("无法发送系统通知：{error}"))?;
    if let Some(session_id) = session_id.filter(|value| !value.trim().is_empty()) {
        let runtime_for_callback = runtime.inner().clone();
        thread::spawn(move || {
            let _ = handle.wait_for_response(move |response: &NotificationResponse| {
                if matches!(
                    response,
                    NotificationResponse::Default | NotificationResponse::Action(_)
                ) {
                    publish_open_session(&app, &runtime_for_callback, session_id);
                }
            });
        });
    }
    Ok(())
}

#[tauri::command]
fn bridge_request(
    runtime: State<'_, BridgeManager>,
    method: String,
    payload: Value,
) -> Result<Value, String> {
    runtime.request(method, payload)
}

#[tauri::command]
fn get_runtime_logs(runtime: State<'_, BridgeManager>) -> Vec<DshRuntimeLog> {
    runtime.recent_log_snapshot()
}

#[tauri::command]
fn log_frontend_event(runtime: State<'_, BridgeManager>, stream: String, text: String) {
    runtime.log_frontend(stream, text);
}

#[tauri::command]
fn export_runtime_logs(runtime: State<'_, BridgeManager>) -> String {
    runtime.log_export_content()
}

#[tauri::command]
fn open_logs_directory() -> Result<(), String> {
    let directory = logs_directory();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建日志目录 {}：{error}", directory.display()))?;
    let mut command = if cfg!(windows) {
        let mut command = Command::new("explorer");
        command.arg(&directory);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&directory);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&directory);
        command
    };
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开日志目录：{error}"))
}

/// 弹出原生“另存为”对话框，把导出内容（JSON 或 ZIP 字节）直接写入用户选择的
/// 位置，返回保存后的完整路径；用户取消时返回 None。对话框在后台线程打开，
/// 避免阻塞主窗口事件循环，也不走 WebView 的下载流程。
#[tauri::command]
async fn save_export_file(default_name: String, data: Vec<u8>) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("导出会话")
            .set_file_name(&default_name)
            .save_file()
    })
    .await
    .map_err(|error| format!("打开保存对话框失败：{error}"))?;
    let Some(path) = picked else {
        return Ok(None);
    };
    fs::write(&path, &data).map_err(|error| format!("写入 {} 失败：{error}", path.display()))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceFileEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitFile {
    path: String,
    status: String,
    code: String,
    index_status: String,
    worktree_status: String,
    is_renamed: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitStatus {
    is_repository: bool,
    root: Option<String>,
    branch: Option<String>,
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
    staged: u32,
    changed: u32,
    untracked: u32,
    conflicted: u32,
    files: Vec<WorkspaceGitFile>,
}

fn git_command(directory: &Path) -> Command {
    let mut command = Command::new("git");
    command.current_dir(directory);
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
}

fn git_output(directory: &Path, args: &[&str]) -> Result<Output, String> {
    git_command(directory)
        .args(args)
        .output()
        .map_err(|error| format!("无法运行 git：{error}"))
}

/// 读取工作区 Git 摘要。使用 porcelain v1 保障路径状态可稳定解析，失败时
/// 返回“不是仓库”而不是把 git 的诊断噪声暴露给文件看板。
#[tauri::command]
fn get_workspace_git_status(dir: String) -> Result<WorkspaceGitStatus, String> {
    let directory = PathBuf::from(&dir);
    if dir.trim().is_empty() {
        return Ok(WorkspaceGitStatus {
            is_repository: false,
            root: None,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            changed: 0,
            untracked: 0,
            conflicted: 0,
            files: Vec::new(),
        });
    }
    if !directory.is_dir() {
        return Ok(WorkspaceGitStatus {
            is_repository: false,
            root: None,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            changed: 0,
            untracked: 0,
            conflicted: 0,
            files: Vec::new(),
        });
    }
    let probe = match git_output(&directory, &["rev-parse", "--is-inside-work-tree"]) {
        Ok(output) => output,
        Err(_) => {
            return Ok(WorkspaceGitStatus {
                is_repository: false,
                root: None,
                branch: None,
                upstream: None,
                ahead: 0,
                behind: 0,
                staged: 0,
                changed: 0,
                untracked: 0,
                conflicted: 0,
                files: Vec::new(),
            });
        }
    };
    if !probe.status.success() || String::from_utf8_lossy(&probe.stdout).trim() != "true" {
        return Ok(WorkspaceGitStatus {
            is_repository: false,
            root: None,
            branch: None,
            upstream: None,
            ahead: 0,
            behind: 0,
            staged: 0,
            changed: 0,
            untracked: 0,
            conflicted: 0,
            files: Vec::new(),
        });
    }

    let repository_root = git_output(&directory, &["rev-parse", "--show-toplevel"])
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty());
    let branch_output = git_output(&directory, &["branch", "--show-current"])?;
    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();
    let branch = if branch.is_empty() {
        None
    } else {
        Some(branch)
    };
    let upstream_output = git_output(
        &directory,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            "@{upstream}",
        ],
    )
    .ok();
    let upstream = upstream_output
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty());
    let (ahead, behind) = if upstream.is_some() {
        git_output(
            &directory,
            &["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
        )
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let values = String::from_utf8_lossy(&output.stdout);
            let mut parts = values
                .split_whitespace()
                .filter_map(|part| part.parse::<u32>().ok());
            Some((parts.next()?, parts.next()?))
        })
        .unwrap_or((0, 0))
    } else {
        (0, 0)
    };
    let status_output = git_output(
        &directory,
        &["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    )?;
    if !status_output.status.success() {
        return Err(format!(
            "读取 Git 状态失败：{}",
            String::from_utf8_lossy(&status_output.stderr).trim()
        ));
    }
    let bytes = status_output.stdout;
    let mut files = Vec::new();
    let mut index = 0;
    while index < bytes.len() {
        if index + 3 > bytes.len() {
            break;
        }
        let x = bytes[index] as char;
        let y = bytes[index + 1] as char;
        if bytes[index + 2] != b' ' {
            break;
        }
        index += 3;
        let end = bytes[index..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|offset| index + offset)
            .unwrap_or(bytes.len());
        let raw_path = String::from_utf8_lossy(&bytes[index..end]).into_owned();
        index = end.saturating_add(1);
        let is_renamed = x == 'R' || y == 'R';
        let path = if is_renamed && index < bytes.len() {
            let new_end = bytes[index..]
                .iter()
                .position(|byte| *byte == 0)
                .map(|offset| index + offset)
                .unwrap_or(bytes.len());
            let new_path = String::from_utf8_lossy(&bytes[index..new_end]).into_owned();
            index = new_end.saturating_add(1);
            new_path
        } else {
            raw_path
        };
        let status = if x == '?' && y == '?' {
            "untracked"
        } else if x == 'U' || y == 'U' || (x == 'A' && y == 'A') || (x == 'D' && y == 'D') {
            "conflicted"
        } else if x != ' ' && y != ' ' {
            "staged-changed"
        } else if x != ' ' {
            "staged"
        } else {
            "changed"
        };
        files.push(WorkspaceGitFile {
            path,
            status: status.to_string(),
            code: format!("{x}{y}"),
            index_status: x.to_string(),
            worktree_status: y.to_string(),
            is_renamed,
        });
    }
    let staged = files
        .iter()
        .filter(|file| {
            file.index_status != " " && file.status != "untracked" && file.status != "conflicted"
        })
        .count() as u32;
    let changed = files
        .iter()
        .filter(|file| {
            file.worktree_status != " " && file.status != "untracked" && file.status != "conflicted"
        })
        .count() as u32;
    let untracked = files
        .iter()
        .filter(|file| file.status == "untracked")
        .count() as u32;
    let conflicted = files
        .iter()
        .filter(|file| file.status == "conflicted")
        .count() as u32;
    Ok(WorkspaceGitStatus {
        is_repository: true,
        root: repository_root,
        branch,
        upstream,
        ahead,
        behind,
        staged,
        changed,
        untracked,
        conflicted,
        files,
    })
}

/// 列出工作区目录下的条目（文件夹优先，其余按名称排序），供左侧文件看板使用。
#[tauri::command]
fn list_workspace_files(dir: String) -> Result<Vec<WorkspaceFileEntry>, String> {
    let directory = PathBuf::from(&dir);
    let entries = fs::read_dir(&directory)
        .map_err(|error| format!("无法读取目录 {}：{error}", directory.display()))?;
    let mut result = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败：{error}"))?;
        let file_type = entry
            .file_type()
            .map_err(|error| format!("读取文件类型失败：{error}"))?;
        let is_dir = file_type.is_dir();
        let metadata = entry.metadata().ok();
        let size = if is_dir {
            0
        } else {
            metadata.as_ref().map(|meta| meta.len()).unwrap_or(0)
        };
        let modified = metadata
            .as_ref()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis() as u64)
            .unwrap_or(0);
        result.push(WorkspaceFileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir,
            size,
            modified,
        });
    }
    result.sort_by(|left, right| {
        right
            .is_dir
            .cmp(&left.is_dir)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(result)
}

/// 用系统默认方式打开路径（Windows 上为资源管理器/默认应用，macOS 为 open，Linux 为 xdg-open）。
fn open_with_system_default(path: &Path) -> Result<(), String> {
    let mut command = if cfg!(windows) {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(path);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法打开 {}：{error}", path.display()))
}

/// 各平台上 VSCode `code` CLI 的常见安装位置，作为 PATH 解析失败的兜底。
fn known_vscode_cli_paths() -> Vec<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("Programs/Microsoft VS Code/bin/code.cmd"));
        }
        if let Some(program_files) = env::var_os("ProgramFiles") {
            candidates.push(PathBuf::from(program_files).join("Microsoft VS Code/bin/code.cmd"));
        }
        if let Some(program_files_x86) = env::var_os("ProgramFiles(x86)") {
            candidates
                .push(PathBuf::from(program_files_x86).join("Microsoft VS Code/bin/code.cmd"));
        }
    }
    #[cfg(target_os = "macos")]
    {
        candidates.push(PathBuf::from(
            "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code",
        ));
        candidates.push(PathBuf::from("/usr/local/bin/code"));
        candidates.push(PathBuf::from("/opt/homebrew/bin/code"));
    }
    #[cfg(target_os = "linux")]
    {
        candidates.push(PathBuf::from("/usr/bin/code"));
        candidates.push(PathBuf::from("/usr/local/bin/code"));
        candidates.push(PathBuf::from("/snap/bin/code"));
    }
    candidates
}

/// 尝试用 VSCode CLI 打开路径；成功返回 true。
fn try_launch_vscode(target: &Path) -> bool {
    #[cfg(windows)]
    {
        // Windows 上 `code` 是 .cmd 脚本，CreateProcess 无法直接执行，需经 cmd /C；
        // 通过退出码判断是否真的找到了 code。
        let mut command = Command::new("cmd");
        command.args(["/C", "code"]);
        command.arg(target);
        configure_hidden_process(&mut command);
        if command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    #[cfg(not(windows))]
    {
        let mut command = Command::new("code");
        command.arg(target);
        if command
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
        {
            return true;
        }
    }
    for candidate in known_vscode_cli_paths() {
        if candidate.exists() {
            let mut command = if cfg!(windows) {
                let mut command = Command::new("cmd");
                command.args(["/C", candidate.to_string_lossy().as_ref()]);
                command
            } else {
                Command::new(&candidate)
            };
            command.arg(target);
            #[cfg(windows)]
            configure_hidden_process(&mut command);
            if command
                .status()
                .map(|status| status.success())
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    false
}

/// 在 VSCode 中打开文件或文件夹；找不到 VSCode 时回退到系统默认打开方式。
#[tauri::command]
fn open_in_vscode(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    if !target.exists() {
        return Err(format!("路径不存在：{path}"));
    }
    if try_launch_vscode(&target) {
        return Ok(());
    }
    open_with_system_default(&target)
        .map_err(|error| format!("未找到 VSCode，改用系统打开也失败：{error}"))
}

/// 将文本写入系统剪贴板，避免依赖 WebView 的剪贴板权限策略。
#[tauri::command]
fn write_clipboard(text: String) -> Result<(), String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|error| format!("打开系统剪贴板失败：{error}"))?;
    clipboard
        .set_text(text)
        .map_err(|error| format!("写入系统剪贴板失败：{error}"))
}

/// 在系统文件管理器中显示该路径（选中状态）。
#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let mut command = if cfg!(windows) {
        let mut command = Command::new("explorer");
        command.arg(format!("/select,{}", target.to_string_lossy()));
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg("-R");
        command.arg(&target);
        command
    } else {
        let parent = target.parent().unwrap_or(&target);
        let mut command = Command::new("xdg-open");
        command.arg(parent);
        command
    };
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("无法在文件管理器中显示 {}：{error}", target.display()))
}

/// 删除工作区内的文件或文件夹（递归）。
#[tauri::command]
fn delete_workspace_path(path: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let metadata = fs::symlink_metadata(&target)
        .map_err(|error| format!("无法访问 {}：{error}", target.display()))?;
    if metadata.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("删除文件夹 {} 失败：{error}", target.display()))?;
    } else {
        fs::remove_file(&target)
            .map_err(|error| format!("删除文件 {} 失败：{error}", target.display()))?;
    }
    Ok(())
}

/// 在工作区目录下创建新文件夹，返回完整路径。
#[tauri::command]
fn create_workspace_folder(parent: String, name: String) -> Result<String, String> {
    const INVALID_CHARS: &[char] = &['/', '\\', ':', '*', '?', '"', '<', '>', '|'];
    let name = name.trim();
    if name.is_empty() {
        return Err("文件夹名称不能为空".to_string());
    }
    if name.chars().any(|ch| INVALID_CHARS.contains(&ch)) {
        return Err("文件夹名称包含非法字符".to_string());
    }
    let path = PathBuf::from(&parent).join(name);
    fs::create_dir_all(&path)
        .map_err(|error| format!("创建文件夹 {} 失败：{error}", path.display()))?;
    Ok(path.to_string_lossy().into_owned())
}

/// 深色主题的默认外部 CSS（随应用分发，首次启动写入主题目录）。
const MONOKAI_PRO_THEME_CSS: &str = include_str!("../resources/themes/monokai-pro.css");
const ONE_DARK_THEME_CSS: &str = include_str!("../resources/themes/one-dark.css");

/// 内置主题文件版本：内容变更时递增，已有安装会在下次启动时同步到新版本。
const THEME_FILES_VERSION: u32 = 2;

const MAX_THEME_CSS_BYTES: u64 = 512 * 1024;

fn themes_directory() -> PathBuf {
    dsh_home().join("themes")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThemeFilesInfo {
    themes_dir: String,
    monokai_pro: String,
    one_dark: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThemeCssContent {
    path: String,
    content: String,
}

/// 确保 <DSH 主目录>/themes 存在并写入默认主题文件。仅在文件缺失或内置版本
/// 更新（THEME_FILES_VERSION 递增）时覆盖，平时尊重用户对文件的编辑。
/// 返回各主题文件的完整路径，供前端作为「主题 CSS 路径」的默认值。
#[tauri::command]
fn ensure_theme_files() -> Result<ThemeFilesInfo, String> {
    let directory = themes_directory();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建主题目录 {}：{error}", directory.display()))?;
    let version_path = directory.join(".version");
    let current_version = fs::read_to_string(&version_path)
        .ok()
        .and_then(|value| value.trim().parse::<u32>().ok())
        .unwrap_or(0);
    if current_version < THEME_FILES_VERSION {
        let write = |name: &str, content: &str| -> Result<(), String> {
            let path = directory.join(name);
            fs::write(&path, content)
                .map_err(|error| format!("无法写入 {}：{error}", path.display()))
        };
        write("monokai-pro.css", MONOKAI_PRO_THEME_CSS)?;
        write("one-dark.css", ONE_DARK_THEME_CSS)?;
        let _ = fs::write(&version_path, THEME_FILES_VERSION.to_string());
    }
    Ok(ThemeFilesInfo {
        themes_dir: directory.to_string_lossy().into_owned(),
        monokai_pro: directory
            .join("monokai-pro.css")
            .to_string_lossy()
            .into_owned(),
        one_dark: directory
            .join("one-dark.css")
            .to_string_lossy()
            .into_owned(),
    })
}

/// 读取主题 CSS 文件内容（限制为 512 KB 以内的 .css 文本文件）。
#[tauri::command]
fn read_theme_css(path: String) -> Result<ThemeCssContent, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("主题 CSS 路径为空".to_string());
    }
    let file_path = PathBuf::from(trimmed);
    let is_css = file_path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("css"))
        == Some(true);
    if !is_css {
        return Err("主题文件必须是 .css 文件".to_string());
    }
    let metadata = fs::metadata(&file_path)
        .map_err(|error| format!("无法读取 {}：{error}", file_path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} 不是文件", file_path.display()));
    }
    if metadata.len() > MAX_THEME_CSS_BYTES {
        return Err("主题 CSS 过大，请选择 512 KB 以内的文件".to_string());
    }
    let content = fs::read_to_string(&file_path)
        .map_err(|error| format!("无法读取 {}：{error}", file_path.display()))?;
    if content.len() > 500_000 {
        return Err("主题 CSS 过大，请选择 512 KB 以内的文件".to_string());
    }
    Ok(ThemeCssContent {
        path: file_path.to_string_lossy().into_owned(),
        content,
    })
}

/// 弹出原生文件选择对话框，选择主题 CSS 文件；取消时返回 None。
#[tauri::command]
async fn pick_theme_css() -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择主题 CSS 文件")
            .add_filter("CSS 样式表", &["css"])
            .pick_file()
    })
    .await
    .map_err(|error| format!("打开文件选择对话框失败：{error}"))?;
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
}

/// 弹出原生文件选择对话框，选择桌面插件入口文件；取消时返回 None。
#[tauri::command]
async fn pick_plugin_entry() -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择桌面插件入口文件")
            .add_filter("JavaScript / TypeScript", &["js", "mjs", "cjs", "ts", "mts", "cts"])
            .pick_file()
    })
    .await
    .map_err(|error| format!("打开插件文件选择对话框失败：{error}"))?;
    Ok(picked.map(|path| path.to_string_lossy().into_owned()))
}

/// 在系统文件管理器中打开主题目录，方便用户直接编辑外部主题文件。
#[tauri::command]
fn open_themes_directory() -> Result<(), String> {
    let directory = themes_directory();
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建主题目录 {}：{error}", directory.display()))?;
    open_with_system_default(&directory)
}

#[cfg(test)]
mod tests {
    use super::{
        bound_log_text, format_log_line, format_utc_datetime, is_dsh_package_manifest,
        DshRuntimeLog, LogStore, MAX_LOG_ENTRIES, MAX_LOG_TEXT_BYTES,
    };

    #[test]
    fn accepts_the_dsh_package_manifest() {
        assert!(is_dsh_package_manifest(r#"{"name":"@deepseek-ai/dsh"}"#));
    }

    #[test]
    fn rejects_missing_or_invalid_dsh_package_manifests() {
        assert!(!is_dsh_package_manifest(r#"{"name":"other-package"}"#));
        assert!(!is_dsh_package_manifest("not json"));
    }

    #[test]
    fn formats_utc_timestamps_for_logs() {
        assert_eq!(format_utc_datetime(0), "1970-01-01 00:00:00");
        assert_eq!(format_utc_datetime(1_700_000_000), "2023-11-14 22:13:20");
        assert_eq!(format_utc_datetime(1_725_260_400), "2024-09-02 07:00:00");
    }

    #[test]
    fn bounds_large_log_text_without_splitting_utf8() {
        let text = "界".repeat(MAX_LOG_TEXT_BYTES);
        let bounded = bound_log_text(text.clone());
        assert!(bounded.len() <= MAX_LOG_TEXT_BYTES + 64);
        assert!(bounded.contains("日志已截断"));
        assert!(bounded.starts_with("界"));
    }

    #[test]
    fn keeps_recent_log_snapshot_bounded_and_ordered() {
        let mut store = LogStore::default();
        for index in 0..(MAX_LOG_ENTRIES + 3) {
            store.push(DshRuntimeLog {
                time: index as u64,
                phase: "test".to_string(),
                stream: "stdout".to_string(),
                text: index.to_string(),
            });
        }
        let recent = store.recent_snapshot(2);
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].time, (MAX_LOG_ENTRIES + 1) as u64);
        assert_eq!(recent[1].time, (MAX_LOG_ENTRIES + 2) as u64);
        assert_eq!(store.snapshot().len(), MAX_LOG_ENTRIES);
    }

    #[test]
    fn formats_log_lines_with_millis_and_stream() {
        let entry = DshRuntimeLog {
            time: 1_700_000_000_123,
            phase: "runtime".to_string(),
            stream: "stderr".to_string(),
            text: "boom".to_string(),
        };
        assert_eq!(
            format_log_line(&entry),
            "[2023-11-14 22:13:20.123] [runtime/stderr] boom"
        );
    }
    #[test]
    fn validates_connection_protocols_without_opening_processes() {
        assert_eq!(super::validated_connection_url(" https://example.com/docs ").unwrap(), "https://example.com/docs");
        assert!(super::validated_connection_url("javascript:alert(1)").is_err());
        assert!(super::validated_connection_url("https://").is_err());
    }
}

fn main() {
    tauri::Builder::default()
        // This plugin must be registered first so a second launch is forwarded
        // before any runtime or window setup can create another instance.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            focus_main_window(app);
            let _ = app.emit("single-instance", json!({ "args": args, "cwd": cwd }));
        }))
        .manage(BridgeManager::default())
        .manage(terminal::TerminalManager::default())
        .setup(|app| {
            let runtime = app.state::<BridgeManager>().inner().clone();
            runtime.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dsh,
            open_connection_url,
            refresh_dsh,
            open_nodejs_download,
            list_pending_open_sessions,
            acknowledge_pending_open_session,
            send_system_notification,
            bridge_request,
            get_runtime_logs,
            log_frontend_event,
            export_runtime_logs,
            open_logs_directory,
            save_export_file,
            terminal::list_terminals,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::close_terminal,
            list_workspace_files,
            get_workspace_git_status,
            open_in_vscode,
            write_clipboard,
            reveal_in_explorer,
            delete_workspace_path,
            create_workspace_folder,
            ensure_theme_files,
            read_theme_css,
            pick_theme_css,
            pick_plugin_entry,
            open_themes_directory,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Deeptop 失败");
}
