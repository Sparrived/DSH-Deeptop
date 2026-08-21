#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(windows)]
use std::sync::atomic::AtomicU32;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    env, fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use fs2::FileExt;
use notify_rust::{Notification as DesktopNotification, NotificationResponse};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{
    menu::{Menu, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
#[cfg(windows)]
use tauri::{
    tray::{MouseButton, MouseButtonState},
    LogicalSize, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};

mod about;
mod dock_position;
mod dock_settings;
mod external_launch;
mod terminal;
mod window_behavior;
mod windows_context_menu;

#[cfg(windows)]
mod windows_process_environment {
    use std::{
        ffi::c_void,
        mem::{size_of, MaybeUninit},
        path::PathBuf,
    };

    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, HANDLE},
        System::{
            Diagnostics::Debug::ReadProcessMemory,
            Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
        },
    };

    const PROCESS_BASIC_INFORMATION_CLASS: u32 = 0;
    const MAX_ENVIRONMENT_BYTES: usize = 1024 * 1024;

    #[repr(C)]
    struct ProcessBasicInformation {
        reserved1: *mut c_void,
        peb_base_address: *mut c_void,
        reserved2: [*mut c_void; 2],
        unique_process_id: usize,
        reserved3: *mut c_void,
    }

    struct ProcessHandle(HANDLE);

    impl Drop for ProcessHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
            }
        }
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQueryInformationProcess(
            process_handle: HANDLE,
            process_information_class: u32,
            process_information: *mut c_void,
            process_information_length: u32,
            return_length: *mut u32,
        ) -> i32;
    }

    fn address(base: usize, offset: usize) -> Result<*const c_void, String> {
        base.checked_add(offset)
            .map(|value| value as *const c_void)
            .ok_or_else(|| "读取 DSH 进程环境失败：远程地址溢出".to_string())
    }

    fn read_exact(handle: HANDLE, source: *const c_void, target: &mut [u8]) -> Result<(), String> {
        let mut bytes_read = 0usize;
        let success = unsafe {
            ReadProcessMemory(
                handle,
                source,
                target.as_mut_ptr().cast(),
                target.len(),
                &mut bytes_read,
            )
        };
        if success == 0 {
            return Err(format!(
                "读取 DSH 进程环境失败：ReadProcessMemory 错误 {}",
                unsafe { GetLastError() }
            ));
        }
        if bytes_read != target.len() {
            return Err("读取 DSH 进程环境失败：远程内存短读".to_string());
        }
        Ok(())
    }

    fn read_pointer(handle: HANDLE, source: *const c_void) -> Result<usize, String> {
        let mut bytes = vec![0u8; size_of::<usize>()];
        read_exact(handle, source, &mut bytes)?;
        Ok(bytes
            .iter()
            .enumerate()
            .fold(0usize, |value, (index, byte)| {
                value | (*byte as usize) << (index * 8)
            }))
    }

    fn parse_environment(bytes: &[u8]) -> Result<Option<PathBuf>, String> {
        if !bytes.len().is_multiple_of(2) {
            return Err("读取 DSH 进程环境失败：环境块不是 UTF-16 对齐数据".to_string());
        }
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        let mut dsh_home = None;
        let mut user_profile = None;
        for entry in units.split(|unit| *unit == 0) {
            if entry.is_empty() {
                break;
            }
            let entry = String::from_utf16(entry)
                .map_err(|_| "读取 DSH 进程环境失败：环境块包含无效 UTF-16".to_string())?;
            let Some((name, value)) = entry.split_once('=') else {
                continue;
            };
            let value = value.trim();
            if value.is_empty() {
                continue;
            }
            match name.to_ascii_uppercase().as_str() {
                "DSH_HOME" => dsh_home = Some(PathBuf::from(value)),
                "USERPROFILE" => user_profile = Some(PathBuf::from(value)),
                _ => {}
            }
        }
        Ok(dsh_home.or_else(|| user_profile.map(|path| path.join(".dsh"))))
    }

    pub fn dsh_home(pid: u32) -> Result<Option<PathBuf>, String> {
        let handle =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if handle.is_null() {
            return Err(format!(
                "无法读取 DSH 进程 {pid} 的环境：OpenProcess 错误 {}",
                unsafe { GetLastError() }
            ));
        }
        let handle = ProcessHandle(handle);
        let mut information = MaybeUninit::<ProcessBasicInformation>::zeroed();
        let mut return_length = 0u32;
        let status = unsafe {
            NtQueryInformationProcess(
                handle.0,
                PROCESS_BASIC_INFORMATION_CLASS,
                information.as_mut_ptr().cast(),
                size_of::<ProcessBasicInformation>() as u32,
                &mut return_length,
            )
        };
        if status < 0 {
            return Err(format!(
                "无法读取 DSH 进程 {pid} 的环境：NtQueryInformationProcess 状态 0x{status:08x}"
            ));
        }
        let information = unsafe { information.assume_init() };
        if information.peb_base_address.is_null() {
            return Err(format!("无法读取 DSH 进程 {pid} 的环境：PEB 不可用"));
        }
        let pointer_size = size_of::<usize>();
        let parameters_offset = if pointer_size == 8 { 0x20 } else { 0x10 };
        let environment_offset = if pointer_size == 8 { 0x80 } else { 0x48 };
        let parameters = read_pointer(
            handle.0,
            address(information.peb_base_address as usize, parameters_offset)?,
        )?;
        if parameters == 0 {
            return Err(format!("无法读取 DSH 进程 {pid} 的环境：进程参数不可用"));
        }
        let environment = read_pointer(handle.0, address(parameters, environment_offset)?)?;
        if environment == 0 {
            return Ok(None);
        }

        let mut bytes = Vec::new();
        while bytes.len() < MAX_ENVIRONMENT_BYTES {
            let chunk_size = 4096.min(MAX_ENVIRONMENT_BYTES - bytes.len());
            let start = bytes.len();
            bytes.resize(start + chunk_size, 0);
            read_exact(handle.0, address(environment, start)?, &mut bytes[start..])?;
            if bytes.windows(4).any(|window| window == [0, 0, 0, 0]) {
                return parse_environment(&bytes);
            }
        }
        Err(format!("无法读取 DSH 进程 {pid} 的环境：环境块超过限制"))
    }
}

const DSH_PROFILE: &str = "desktop";
const BUNDLED_DSH_PACKAGE: &str = "@deepseek-ai/dsh";
const BUNDLED_DSH_RUNTIME_DIR: &str = "dsh-runtime";
const BUNDLED_DSH_ARCHIVE: &str = "dsh-runtime.tar.gz";
const BUNDLED_DSH_MANIFEST: &str = "dsh-runtime-manifest.json";
const RUNTIME_ARCHIVE_MANIFEST: &str = "runtime-manifest.json";
const BUNDLED_DSH_ENTRY: &str = "node_modules/@deepseek-ai/dsh/lib/bin.js";
const RUNTIME_CACHE_MARKER: &str = ".complete";
const NODEJS_DOWNLOAD_URL: &str = "https://nodejs.org/en/download";
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(45);
/// Max consecutive unexpected DSH exits we auto-restart before requiring manual
/// action. Guards against a crash loop (e.g. a corrupted profile) that would
/// otherwise restart DSH forever.
const MAX_AUTO_RESTARTS: u32 = 3;
/// Base delay for the first auto-restart; each consecutive crash doubles it.
const AUTO_RESTART_BASE_DELAY: Duration = Duration::from_millis(1000);
const BUNDLED_DSH_VERSION: &str = "0.1.0-rc.8";
const BUNDLED_DSH_SOURCE_COMMIT: &str = "a95eedc6034c323ece64536609174645c235f124";
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
const MAX_PENDING_EXTERNAL_LAUNCHES: usize = 16;
const MAX_TRAY_SESSION_ITEMS: usize = 32;
const MAX_TRAY_SESSION_ID_CHARS: usize = 256;
const MAX_TRAY_SESSION_LABEL_CHARS: usize = 32;
const MAX_TRAY_TITLE_CHARS: usize = 20;
const MAX_TRAY_CONTEXT_CHARS: usize = 10;
#[cfg(windows)]
const TRAY_POPUP_WIDTH: u32 = 320;
#[cfg(windows)]
const TRAY_POPUP_OUTER_HEIGHT: u32 = 14;
#[cfg(windows)]
const TRAY_POPUP_SECTION_HEIGHT: u32 = 22;
#[cfg(windows)]
const TRAY_POPUP_SESSION_HEIGHT: u32 = 36;
#[cfg(windows)]
const TRAY_POPUP_MORE_HEIGHT: u32 = 36;
#[cfg(windows)]
const TRAY_POPUP_ACTIONS_HEIGHT: u32 = 115;
#[cfg(windows)]
const TRAY_POPUP_SCREEN_MARGIN: i32 = 8;
#[cfg(windows)]
const TRAY_POPUP_ANCHOR_GAP: i32 = 6;
#[cfg(windows)]
const TRAY_POPUP_BLUR_DELAY: Duration = Duration::from_millis(120);
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum TraySessionStatus {
    Idle,
    Running,
    Unread,
    Error,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TraySessionMenuItem {
    session_id: String,
    title: String,
    context: Option<String>,
    status: TraySessionStatus,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
struct TraySessionMenuSnapshot {
    unread: Vec<TraySessionMenuItem>,
    recent: Vec<TraySessionMenuItem>,
    more: Vec<TraySessionMenuItem>,
}

#[derive(Default)]
struct TrayMenuState {
    generation: AtomicU64,
    session_ids: Mutex<HashMap<String, String>>,
    snapshot: Mutex<TraySessionMenuSnapshot>,
    #[cfg(windows)]
    popup_visible: AtomicBool,
    #[cfg(windows)]
    popup_epoch: AtomicU64,
    #[cfg(windows)]
    popup_height: AtomicU32,
    #[cfg(windows)]
    popup_position: Mutex<Option<PhysicalPosition<i32>>>,
}

impl TrayMenuState {
    fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::Relaxed)
    }

    fn session_id(&self, menu_id: &str) -> Option<String> {
        self.session_ids.lock().ok()?.get(menu_id).cloned()
    }

    fn snapshot(&self) -> Result<TraySessionMenuSnapshot, String> {
        self.snapshot
            .lock()
            .map(|snapshot| snapshot.clone())
            .map_err(|_| "托盘会话快照不可用".to_string())
    }

    fn replace_snapshot(&self, snapshot: TraySessionMenuSnapshot) -> Result<(), String> {
        *self
            .snapshot
            .lock()
            .map_err(|_| "托盘会话快照不可用".to_string())? = snapshot;
        Ok(())
    }

    fn snapshot_matches(&self, candidate: &TraySessionMenuSnapshot) -> Result<bool, String> {
        self.snapshot
            .lock()
            .map(|snapshot| *snapshot == *candidate)
            .map_err(|_| "托盘会话快照不可用".to_string())
    }

    #[cfg(windows)]
    fn desired_popup_height(&self) -> Result<u32, String> {
        self.snapshot
            .lock()
            .map(|snapshot| tray_popup_height(&snapshot))
            .map_err(|_| "托盘会话快照不可用".to_string())
    }

    fn contains_session(&self, session_id: &str) -> Result<bool, String> {
        let snapshot = self
            .snapshot
            .lock()
            .map_err(|_| "托盘会话快照不可用".to_string())?;
        Ok(snapshot
            .unread
            .iter()
            .chain(snapshot.recent.iter())
            .chain(snapshot.more.iter())
            .any(|item| item.session_id.trim() == session_id))
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum TrayPopupAction {
    NewChat,
    ShowMain,
    Quit,
}

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
    /// DSH runtime packaged through Tauri resources. This is the only production
    /// source so a user's PATH, npm installation, and npm cache cannot replace it.
    BundledResource,
}

impl DshSource {
    fn label(self) -> &'static str {
        match self {
            Self::BundledResource => "随安装包内嵌的 DSH 运行时",
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
    Starting,
    Ready,
    Failed,
}

struct BridgeState {
    phase: RuntimePhase,
    message: String,
    package_available: bool,
    generation: u64,
    pid: Option<u32>,
    stdin: Option<Arc<Mutex<std::process::ChildStdin>>>,
    pending: HashMap<String, mpsc::Sender<Result<Value, String>>>,
    /// Consecutive unexpected DSH exits not yet recovered by a successful boot.
    crash_count: u32,
    /// An auto-restart has been scheduled for the current crash; prevents double
    /// scheduling while the delayed restart thread is still waiting.
    auto_restart_pending: bool,
    process_conflict: Option<DshProcessConflict>,
}

impl Default for BridgeState {
    fn default() -> Self {
        Self {
            phase: RuntimePhase::Idle,
            message: "等待 DSH 启动".to_string(),
            package_available: false,
            generation: 0,
            pid: None,
            stdin: None,
            pending: HashMap::new(),
            crash_count: 0,
            auto_restart_pending: false,
            process_conflict: None,
        }
    }
}

#[derive(Clone, Default)]
struct BridgeManager {
    state: Arc<Mutex<BridgeState>>,
    next_request_id: Arc<AtomicU64>,
    pending_open_sessions: Arc<Mutex<VecDeque<String>>>,
    pending_external_launches: Arc<Mutex<VecDeque<external_launch::ExternalLaunchRequest>>>,
    pending_window_close: Arc<AtomicBool>,
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

    fn enqueue_external_launch(&self, request: external_launch::ExternalLaunchRequest) {
        let Ok(mut pending) = self.pending_external_launches.lock() else {
            return;
        };
        pending.retain(|item| item.paths != request.paths);
        pending.push_back(request);
        while pending.len() > MAX_PENDING_EXTERNAL_LAUNCHES {
            pending.pop_front();
        }
    }

    fn list_external_launches(&self) -> Vec<external_launch::ExternalLaunchRequest> {
        self.pending_external_launches
            .lock()
            .map(|pending| pending.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn acknowledge_external_launch(&self, paths: &[String]) {
        if let Ok(mut pending) = self.pending_external_launches.lock() {
            pending.retain(|item| item.paths != paths);
        }
    }

    fn request_window_close(&self) -> bool {
        !self.pending_window_close.swap(true, Ordering::AcqRel)
    }

    fn clear_window_close(&self) {
        self.pending_window_close.store(false, Ordering::Release);
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DshProcessInfo {
    pid: u32,
    name: String,
    command_line: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DshProcessConflict {
    dsh_home: String,
    processes: Vec<DshProcessInfo>,
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
    process_conflict: Option<DshProcessConflict>,
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
    let template: Value = serde_json::from_str(PROFILE_TEMPLATE)
        .expect("embedded desktop profile must be valid JSON");
    let required_dependencies = template
        .get("dependencies")
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| "embedded desktop Profile 的 dependencies 必须是对象".to_string())?;
    let mut manifest: Value = if path.exists() {
        let raw = fs::read_to_string(path)
            .map_err(|error| format!("无法读取 desktop Profile：{error}"))?;
        serde_json::from_str(&raw)
            .map_err(|error| format!("desktop Profile 的 package.json 无效：{error}"))?
    } else {
        template
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
    let dependencies = root
        .get_mut("dependencies")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "desktop Profile 的 dependencies 必须是对象".to_string())?;
    for (name, version) in required_dependencies {
        dependencies.insert(name.clone(), version.clone());
    }

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

fn migrate_desktop_profile_patch(path: &Path) -> Result<(), String> {
    let Ok(content) = fs::read_to_string(path) else {
        return Ok(());
    };
    if !content.contains("dsh-session-log-export") {
        return Ok(());
    }
    let newline = if content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let lines = content.lines().collect::<Vec<_>>();
    let mut filtered = Vec::with_capacity(lines.len());
    let mut remove_name = false;
    for line in lines {
        if line.trim_start() == "- id: session-log-download" {
            remove_name = true;
            continue;
        }
        if remove_name && line.trim_start() == "name: '@deepseek-ai/dsh-session-log-export'" {
            remove_name = false;
            continue;
        }
        remove_name = false;
        filtered.push(line);
    }
    write_text(path, &format!("{}{newline}", filtered.join(newline)))
}

fn materialize_desktop_profile() -> Result<(), String> {
    let profiles = dsh_home().join("profiles");
    let profile_dir = profiles.join(DSH_PROFILE);
    fs::create_dir_all(&profile_dir)
        .map_err(|error| format!("无法创建 desktop Profile：{error}"))?;
    ensure_desktop_profile_manifest(&profile_dir.join("package.json"))?;
    let profile_patch = profile_dir.join("cordis.patch.yml");
    write_if_missing(&profile_patch, PROFILE_PATCH_TEMPLATE)?;
    migrate_desktop_profile_patch(&profile_patch)?;
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

#[cfg(all(windows, test))]
fn normalize_windows_resource_path_for_display(path: PathBuf) -> PathBuf {
    let value = path.to_string_lossy();
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = value.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn runtime_platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn runtime_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "other"
    }
}

fn runtime_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|error| format!("无法定位应用资源目录：{error}"))
}

fn runtime_manifest_matches_host(manifest: &Value) -> bool {
    manifest.get("platform").and_then(Value::as_str) == Some(runtime_platform())
        && manifest.get("arch").and_then(Value::as_str) == Some(runtime_arch())
}

fn runtime_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map(|path| path.join(BUNDLED_DSH_RUNTIME_DIR))
        .map_err(|error| format!("无法定位 DSH 运行时缓存目录：{error}"))?;
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建 DSH 运行时缓存目录 {}：{error}", root.display()))?;
    if is_runtime_reparse_point(&root) {
        return Err(format!(
            "拒绝使用重解析点作为 DSH 运行时缓存目录：{}",
            root.display()
        ));
    }
    Ok(root)
}

fn runtime_cache_key(manifest: &Value) -> Result<String, String> {
    let commit = manifest
        .get("sourceCommit")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 40
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        })
        .ok_or_else(|| "内嵌 DSH 清单缺少有效源码提交".to_string())?;
    let digest = runtime_manifest_tree_sha256(manifest)
        .ok_or_else(|| "内嵌 DSH 清单缺少有效运行时树摘要".to_string())?;
    Ok(format!(
        "{commit}-{}-{}-{}",
        runtime_platform(),
        runtime_arch(),
        &digest[..16]
    ))
}

fn lock_runtime_cache(cache_root: &Path) -> Result<fs::File, String> {
    let lock_path = cache_root.join(".lock");
    if is_runtime_reparse_point(&lock_path) {
        return Err(format!(
            "拒绝使用重解析点作为 DSH 运行时缓存锁：{}",
            lock_path.display()
        ));
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("无法打开 DSH 运行时缓存锁 {}：{error}", lock_path.display()))?;
    lock.lock_exclusive()
        .map_err(|error| format!("无法取得 DSH 运行时缓存锁：{error}"))?;
    Ok(lock)
}

fn cleanup_runtime_temporary_caches(cache_root: &Path, key: &str) {
    let prefix = format!(".{key}.tmp-");
    let Ok(entries) = fs::read_dir(cache_root) else {
        return;
    };
    for entry in entries.flatten() {
        if entry.file_name().to_string_lossy().starts_with(&prefix) {
            remove_runtime_path(&entry.path());
        }
    }
}

fn remove_runtime_path(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return;
    };
    if is_runtime_reparse_point(path) {
        if metadata.file_type().is_dir() {
            fs::remove_dir(path).ok();
        } else {
            fs::remove_file(path).ok();
        }
    } else if metadata.file_type().is_dir() {
        fs::remove_dir_all(path).ok();
    } else {
        fs::remove_file(path).ok();
    }
}

fn quarantine_invalid_runtime_cache(cache: &Path) {
    if fs::symlink_metadata(cache).is_err() {
        return;
    }
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let quarantine = cache.with_file_name(format!(
        "{}.invalid-{suffix}",
        cache
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("runtime")
    ));
    if fs::rename(cache, &quarantine).is_ok() {
        remove_runtime_path(&quarantine);
    } else {
        remove_runtime_path(cache);
    }
}

#[cfg(windows)]
fn is_runtime_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes() & 0x400 != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_runtime_reparse_point(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn is_safe_runtime_entry(name: &str) -> bool {
    !name.is_empty()
        && !name.contains('\\')
        && !name.starts_with('/')
        && !(name.len() >= 2 && name.as_bytes()[1] == b':')
        && !Path::new(name).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
}

fn update_tree_digest(hash: &mut Sha256, root: &Path, relative: &str) -> Result<(), String> {
    let mut entries = fs::read_dir(root)
        .map_err(|error| format!("无法读取 DSH 运行时缓存目录 {}：{error}", root.display()))?
        .map(|entry| {
            entry
                .map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    (name, entry)
                })
                .map_err(|error| format!("无法读取 DSH 运行时缓存条目：{error}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    for (name, entry) in entries {
        if relative.is_empty()
            && (name == "runtime-manifest.json"
                || name == RUNTIME_CACHE_MARKER
                || name == ".complete.tmp")
        {
            continue;
        }
        let child_relative = if relative.is_empty() {
            name.clone()
        } else {
            format!("{relative}/{name}")
        };
        let file_type = entry
            .file_type()
            .map_err(|error| format!("无法读取 DSH 运行时条目类型 {child_relative}：{error}"))?;
        if is_runtime_reparse_point(&entry.path())
            || file_type.is_symlink()
            || (!file_type.is_dir() && !file_type.is_file())
        {
            return Err(format!(
                "DSH 运行时缓存包含不支持的文件类型：{child_relative}"
            ));
        }
        if file_type.is_dir() {
            hash.update(format!("D\n{child_relative}\n").as_bytes());
            update_tree_digest(hash, &entry.path(), &child_relative)?;
        } else {
            hash.update(format!("F\n{child_relative}\n").as_bytes());
            let mut file = fs::File::open(entry.path())
                .map_err(|error| format!("无法读取 DSH 运行时文件 {child_relative}：{error}"))?;
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file.read(&mut buffer).map_err(|error| {
                    format!("无法读取 DSH 运行时文件 {child_relative}：{error}")
                })?;
                if count == 0 {
                    break;
                }
                hash.update(&buffer[..count]);
            }
        }
    }
    Ok(())
}

fn runtime_tree_sha256(root: &Path) -> Result<String, String> {
    let mut hash = Sha256::new();
    update_tree_digest(&mut hash, root, "")?;
    Ok(format!("{:x}", hash.finalize()))
}

fn runtime_manifest_tree_sha256(manifest: &Value) -> Option<&str> {
    manifest
        .get("treeSha256")
        .and_then(Value::as_str)
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        })
}

fn is_runtime_cache_ready(root: &Path, manifest: &Value) -> bool {
    // The completion marker is written only after a full tree verification during
    // materialization. Do not reread the entire 145 MB runtime on every startup.
    if is_runtime_reparse_point(root) {
        return false;
    }
    let Ok(key) = runtime_cache_key(manifest) else {
        return false;
    };
    fs::read_to_string(root.join(RUNTIME_CACHE_MARKER))
        .ok()
        .as_deref()
        == Some(key.as_str())
        && fs::read_to_string(root.join(RUNTIME_ARCHIVE_MANIFEST))
            .ok()
            .and_then(|content| serde_json::from_str::<Value>(&content).ok())
            .is_some_and(|cached| cached == *manifest)
        && root.join(BUNDLED_DSH_ENTRY).is_file()
        && dsh_package_available_at(root)
}

fn runtime_archive_target(destination: &Path, entry_path: &Path) -> Result<PathBuf, String> {
    let mut target = destination.to_path_buf();
    let mut has_name = false;
    for component in entry_path.components() {
        match component {
            Component::CurDir => {}
            Component::Normal(name) => {
                target.push(name);
                has_name = true;
            }
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!(
                    "拒绝不安全的 DSH 运行时归档路径：{}",
                    entry_path.display()
                ));
            }
        }
    }
    if !has_name {
        return Ok(destination.to_path_buf());
    }
    Ok(target)
}

fn extract_runtime_archive(archive_path: &Path, destination: &Path) -> Result<(), String> {
    let archive_file = fs::File::open(archive_path)
        .map_err(|error| format!("无法读取内嵌 DSH 运行时归档：{error}"))?;
    let decoder = flate2::read::GzDecoder::new(archive_file);
    let mut archive = tar::Archive::new(decoder);
    fs::create_dir_all(destination)
        .map_err(|error| format!("无法创建 DSH 运行时临时目录：{error}"))?;
    // Canonicalize the destination once. On Windows this yields the extended
    // path form, preserving extraction of deeply nested node_modules paths
    // without paying tar's canonicalization cost for every archive entry.
    let destination = destination
        .canonicalize()
        .map_err(|error| format!("无法定位 DSH 运行时临时目录：{error}"))?;
    let entries = archive
        .entries()
        .map_err(|error| format!("无法读取 DSH 运行时归档目录：{error}"))?;
    for entry in entries {
        let mut entry = entry.map_err(|error| format!("读取 DSH 运行时归档条目失败：{error}"))?;
        let entry_path = entry
            .path()
            .map_err(|error| format!("读取 DSH 运行时归档路径失败：{error}"))?;
        let entry_name = entry_path
            .to_str()
            .ok_or_else(|| "拒绝包含非 UTF-8 路径的 DSH 运行时归档".to_string())?;
        if !is_safe_runtime_entry(entry_name) {
            return Err(format!("拒绝不安全的 DSH 运行时归档路径：{entry_name}"));
        }
        let entry_type = entry.header().entry_type();
        if !(entry_type.is_dir() || entry_type.is_file()) {
            return Err(format!("拒绝 DSH 运行时归档中的特殊文件：{entry_name}"));
        }
        let target = runtime_archive_target(&destination, entry_path.as_ref())?;
        if !target.starts_with(&destination) {
            return Err(format!("拒绝超出 DSH 运行时缓存目录的路径：{entry_name}"));
        }
        if target.parent().is_some_and(is_runtime_reparse_point)
            || is_runtime_reparse_point(&target)
        {
            return Err(format!("拒绝写入重解析点路径：{}", target.display()));
        }
        if entry_type.is_dir() {
            fs::create_dir_all(&target).map_err(|error| {
                format!("解压 DSH 运行时目录失败 {}：{error}", target.display())
            })?;
        } else {
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("创建 DSH 运行时文件目录失败 {}：{error}", parent.display())
                })?;
            }
            // The archive has already been restricted to regular files and the
            // destination is a fresh private directory. Direct unpack avoids
            // tar's per-entry canonicalization, which otherwise makes a 20k+
            // file runtime appear permanently stuck on Windows.
            entry.unpack(&target).map_err(|error| {
                format!("解压 DSH 运行时文件失败 {}：{error}", target.display())
            })?;
        }
    }
    Ok(())
}

fn materialize_bundled_runtime(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = runtime_resource_dir(app)?;
    let archive_path = resource_dir.join(BUNDLED_DSH_ARCHIVE);
    let manifest_path = resource_dir.join(BUNDLED_DSH_MANIFEST);
    let manifest: Value = serde_json::from_str(
        &fs::read_to_string(&manifest_path)
            .map_err(|error| format!("无法读取内嵌 DSH 运行时清单：{error}"))?,
    )
    .map_err(|error| format!("内嵌 DSH 运行时清单无效：{error}"))?;
    if !is_bundled_runtime_manifest(&manifest) || !runtime_manifest_matches_host(&manifest) {
        return Err("内嵌 DSH 运行时版本、平台或入口清单不匹配，请重新安装 Deeptop".to_string());
    }
    if !archive_path.is_file() {
        return Err(format!(
            "内嵌 DSH 运行时归档缺失：{}",
            archive_path.display()
        ));
    }
    let cache_root = runtime_cache_root(app)?;
    fs::create_dir_all(&cache_root)
        .map_err(|error| format!("无法创建 DSH 运行时缓存目录：{error}"))?;
    let _cache_lock = lock_runtime_cache(&cache_root)?;
    let key = runtime_cache_key(&manifest)?;
    let cache = cache_root.join(&key);
    if is_runtime_cache_ready(&cache, &manifest) {
        return Ok(cache);
    }
    quarantine_invalid_runtime_cache(&cache);
    cleanup_runtime_temporary_caches(&cache_root, &key);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = cache_root.join(format!(".{key}.tmp-{}-{nonce}", std::process::id()));
    remove_runtime_path(&temporary);
    fs::create_dir_all(&temporary)
        .map_err(|error| format!("无法创建 DSH 运行时临时缓存：{error}"))?;
    let result = (|| {
        extract_runtime_archive(&archive_path, &temporary)?;
        // The manifest is bundled as a separate Tauri resource and was already
        // validated above. Materialize that authoritative copy explicitly after
        // extraction so a tar implementation/path quirk cannot leave the cache
        // without its completion metadata on Windows.
        let extracted_manifest_path = temporary.join(RUNTIME_ARCHIVE_MANIFEST);
        let serialized_manifest = serde_json::to_vec_pretty(&manifest)
            .map_err(|error| format!("无法编码内嵌 DSH 运行时清单：{error}"))?;
        fs::write(&extracted_manifest_path, serialized_manifest).map_err(|error| {
            format!(
                "无法写入解压后的 DSH 清单 {}：{error}",
                extracted_manifest_path.display()
            )
        })?;
        let extracted: Value = serde_json::from_str(
            &fs::read_to_string(&extracted_manifest_path).map_err(|error| {
                format!(
                    "解压后的 DSH 清单无法读取 {}：{error}",
                    extracted_manifest_path.display()
                )
            })?,
        )
        .map_err(|error| format!("解压后的 DSH 清单无效：{error}"))?;
        if extracted != manifest {
            return Err("解压后的 DSH 清单与资源清单不一致".to_string());
        }
        let validation_message = runtime_cache_validation_message(&temporary, &manifest);
        if !validation_message.is_empty() {
            return Err(format!("解压后的 DSH 运行时校验失败：{validation_message}"));
        }
        let marker = temporary.join(RUNTIME_CACHE_MARKER);
        let marker_temp = temporary.join(format!("{RUNTIME_CACHE_MARKER}.tmp"));
        let mut marker_file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&marker_temp)
            .map_err(|error| format!("无法创建 DSH 运行时完成标记：{error}"))?;
        marker_file
            .write_all(key.as_bytes())
            .and_then(|_| marker_file.sync_all())
            .map_err(|error| format!("无法落盘 DSH 运行时完成标记：{error}"))?;
        fs::rename(&marker_temp, &marker)
            .map_err(|error| format!("无法提交 DSH 运行时完成标记：{error}"))?;
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        remove_runtime_path(&temporary);
        return Err(error);
    }
    if is_runtime_cache_ready(&cache, &manifest) {
        remove_runtime_path(&temporary);
        return Ok(cache);
    }
    match fs::rename(&temporary, &cache) {
        Ok(()) => Ok(cache),
        Err(_error) if is_runtime_cache_ready(&cache, &manifest) => {
            remove_runtime_path(&temporary);
            Ok(cache)
        }
        Err(error) => {
            remove_runtime_path(&temporary);
            Err(format!("无法提交 DSH 运行时缓存：{error}"))
        }
    }
}

fn runtime_cache_validation_message(root: &Path, manifest: &Value) -> String {
    if is_runtime_reparse_point(root) {
        return format!("运行时缓存目录是重解析点：{}", root.display());
    }
    let expected_manifest = manifest;
    let cached_manifest = fs::read_to_string(root.join(RUNTIME_ARCHIVE_MANIFEST))
        .ok()
        .and_then(|content| serde_json::from_str::<Value>(&content).ok());
    if cached_manifest.as_ref() != Some(expected_manifest) {
        return format!(
            "运行时缓存清单不一致：{}",
            root.join(RUNTIME_ARCHIVE_MANIFEST).display()
        );
    }
    let entry = root.join(BUNDLED_DSH_ENTRY);
    if !entry.is_file() {
        return format!("运行时入口不存在：{}", entry.display());
    }
    let package_manifest = dsh_package_manifest_at(root);
    if !dsh_package_available_at(root) {
        return format!("DSH 包清单不存在或无效：{}", package_manifest.display());
    }
    let Some(expected_tree) = runtime_manifest_tree_sha256(manifest) else {
        return "运行时清单缺少有效树摘要".to_string();
    };
    match runtime_tree_sha256(root) {
        Ok(actual_tree) if actual_tree == expected_tree => String::new(),
        Ok(actual_tree) => format!("运行时树摘要不一致：期望 {expected_tree}，实际 {actual_tree}"),
        Err(error) => format!("读取运行时树失败：{error}"),
    }
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

/// Materialize the immutable Tauri archive into a versioned local cache.
/// Profile/session state remains in DSH_HOME; only this extracted code cache is
/// recreated when the bundled source commit changes.
fn bundled_dsh_runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    materialize_bundled_runtime(app)
}

fn bundled_dsh_package_label(runtime: &Path) -> Result<String, String> {
    let manifest = dsh_package_manifest_at(runtime);
    let raw = fs::read_to_string(&manifest)
        .map_err(|error| format!("无法读取内嵌 DSH 清单 {}：{error}", manifest.display()))?;
    let package: Value =
        serde_json::from_str(&raw).map_err(|error| format!("内嵌 DSH 清单无效：{error}"))?;
    let version = package
        .get("version")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "内嵌 DSH 清单缺少版本号".to_string())?;
    Ok(format!("{BUNDLED_DSH_PACKAGE}@{version}（内嵌）"))
}

/// Create a direct Node launch for the packaged DSH entry.  Do not invoke npm
/// or a dsh shell shim: those could select a user-installed package instead of
/// the resource shipped with this application.
fn bundled_dsh_launch(app: &AppHandle) -> Result<DshLaunch, String> {
    let runtime = bundled_dsh_runtime_root(app)?;
    let entry = runtime.join(BUNDLED_DSH_ENTRY);
    let mut command = Command::new(node_executable()?);
    command
        .arg(&entry)
        .args(["--profile", DSH_PROFILE])
        .current_dir(dsh_home())
        .env("DSH_HOME", dsh_home())
        .env_remove("DSH_CWD");
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    #[cfg(unix)]
    configure_process_group(&mut command);
    Ok(DshLaunch {
        source: DshSource::BundledResource,
        command,
        label: format!(
            "{}（{}）",
            bundled_dsh_package_label(&runtime)?,
            runtime.display()
        ),
    })
}

fn is_bundled_runtime_manifest(manifest: &Value) -> bool {
    manifest.get("format").and_then(Value::as_u64) == Some(1)
        && manifest.get("packageName").and_then(Value::as_str) == Some(BUNDLED_DSH_PACKAGE)
        && manifest.get("packageVersion").and_then(Value::as_str) == Some(BUNDLED_DSH_VERSION)
        && manifest.get("entry").and_then(Value::as_str) == Some(BUNDLED_DSH_ENTRY)
        && manifest
            .get("sourceCommit")
            .and_then(Value::as_str)
            .is_some_and(|value| value == BUNDLED_DSH_SOURCE_COMMIT)
        && runtime_manifest_matches_host(manifest)
        && runtime_manifest_tree_sha256(manifest).is_some()
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

fn process_command_line_matches_dsh(name: &str, command_line: &str) -> bool {
    let process_name = name.trim().to_ascii_lowercase();
    if process_name != "node" && process_name != "node.exe" {
        return false;
    }
    let lower = command_line.to_ascii_lowercase();
    let arguments: Vec<&str> = lower.split_whitespace().collect();
    let desktop_profile = arguments.iter().enumerate().any(|(index, argument)| {
        (*argument == "--profile" && arguments.get(index + 1) == Some(&"desktop"))
            || *argument == "--profile=desktop"
    });
    let normalized = lower.replace('\\', "/");
    let dsh_entry = normalized.contains("@deepseek-ai/dsh/")
        || normalized.contains("/dsh/lib/bin.js")
        || normalized.contains(" dsh/lib/bin.js");
    dsh_entry && desktop_profile
}

#[cfg(windows)]
fn process_dsh_home(pid: u32) -> Result<Option<PathBuf>, String> {
    windows_process_environment::dsh_home(pid)
}

#[cfg(target_os = "linux")]
fn process_dsh_home(pid: u32) -> Result<Option<PathBuf>, String> {
    let bytes = fs::read(format!("/proc/{pid}/environ"))
        .map_err(|error| format!("无法读取 DSH 进程 {pid} 的环境：{error}"))?;
    let mut dsh_home = None;
    let mut home = None;
    for entry in bytes.split(|byte| *byte == 0) {
        let Ok(entry) = std::str::from_utf8(entry) else {
            continue;
        };
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        if value.trim().is_empty() {
            continue;
        }
        match name {
            "DSH_HOME" => dsh_home = Some(PathBuf::from(value.trim())),
            "HOME" => home = Some(PathBuf::from(value.trim())),
            _ => {}
        }
    }
    Ok(dsh_home.or_else(|| home.map(|path| path.join(".dsh"))))
}

#[cfg(target_os = "macos")]
fn process_dsh_home(pid: u32) -> Result<Option<PathBuf>, String> {
    let output = Command::new("ps")
        .args(["eww", "-p", &pid.to_string(), "-o", "command="])
        .output()
        .map_err(|error| format!("无法读取 DSH 进程 {pid} 的环境：{error}"))?;
    if !output.status.success() {
        return Err(format!(
            "无法读取 DSH 进程 {pid} 的环境：{}",
            decode_process_line(&output.stderr)
        ));
    }
    let mut dsh_home = None;
    let mut home = None;
    for entry in decode_process_line(&output.stdout).split_whitespace() {
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        match name {
            "DSH_HOME" if !value.trim().is_empty() => dsh_home = Some(PathBuf::from(value.trim())),
            "HOME" if !value.trim().is_empty() => home = Some(PathBuf::from(value.trim())),
            _ => {}
        }
    }
    Ok(dsh_home.or_else(|| home.map(|path| path.join(".dsh"))))
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn process_dsh_home(_pid: u32) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

#[cfg(not(any(windows, unix)))]
fn process_dsh_home(_pid: u32) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

fn dsh_homes_match(candidate: &Path) -> bool {
    let expected = absolute_path(dsh_home());
    let candidate = absolute_path(candidate.to_path_buf());
    let expected = fs::canonicalize(&expected).unwrap_or(expected);
    let candidate = fs::canonicalize(&candidate).unwrap_or(candidate);
    if cfg!(windows) {
        expected
            .to_string_lossy()
            .replace('/', "\\")
            .trim_end_matches('\\')
            .eq_ignore_ascii_case(
                candidate
                    .to_string_lossy()
                    .replace('/', "\\")
                    .trim_end_matches('\\'),
            )
    } else {
        expected == candidate
    }
}

fn list_external_dsh_processes() -> Result<Vec<DshProcessInfo>, String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("powershell.exe");
        configure_hidden_process(&mut command);
        let output = command
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                r#"$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process | Where-Object { $_.Name -match '(?i)^node(?:\.exe)?$' -and $_.CommandLine -and $_.CommandLine -match '(?i)(dsh|@deepseek-ai)' -and $_.CommandLine -match '(?i)--profile\s+desktop' } | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress"#,
            ])
            .output()
            .map_err(|error| format!("无法检查 DSH 进程：{error}"))?;
        if !output.status.success() {
            return Err(format!(
                "检查 DSH 进程失败：{}",
                decode_process_line(&output.stderr)
            ));
        }
        let text = decode_process_line(&output.stdout);
        if text.trim().is_empty() {
            return Ok(Vec::new());
        }
        let value: Value = serde_json::from_str(text.trim())
            .map_err(|error| format!("解析 DSH 进程列表失败：{error}"))?;
        let values = match value {
            Value::Array(values) => values,
            other => vec![other],
        };
        let mut processes = Vec::new();
        for item in values {
            let Some(object) = item.as_object() else {
                continue;
            };
            let Some(pid) = object
                .get("ProcessId")
                .and_then(Value::as_u64)
                .and_then(|value| value.try_into().ok())
            else {
                continue;
            };
            let Some(name) = object.get("Name").and_then(Value::as_str) else {
                continue;
            };
            let Some(command_line) = object.get("CommandLine").and_then(Value::as_str) else {
                continue;
            };
            if process_command_line_matches_dsh(name, command_line)
                && process_dsh_home(pid)?.is_some_and(|home| dsh_homes_match(&home))
            {
                processes.push(DshProcessInfo {
                    pid,
                    name: name.to_string(),
                    command_line: command_line.to_string(),
                });
            }
        }
        Ok(processes)
    }

    #[cfg(unix)]
    {
        let output = Command::new("ps")
            .args(["-eo", "pid=,comm=,args="])
            .output()
            .map_err(|error| format!("无法检查 DSH 进程：{error}"))?;
        if !output.status.success() {
            return Err(format!(
                "检查 DSH 进程失败：{}",
                decode_process_line(&output.stderr)
            ));
        }
        let mut processes = Vec::new();
        for line in decode_process_line(&output.stdout).lines() {
            let trimmed = line.trim();
            let mut fields = trimmed.split_whitespace();
            let Some(pid) = fields.next().and_then(|value| value.parse().ok()) else {
                continue;
            };
            let Some(name) = fields.next() else {
                continue;
            };
            let command_line = fields.collect::<Vec<_>>().join(" ");
            if process_command_line_matches_dsh(name, &command_line)
                && process_dsh_home(pid)?.is_some_and(|home| dsh_homes_match(&home))
            {
                processes.push(DshProcessInfo {
                    pid,
                    name: name.to_string(),
                    command_line,
                });
            }
        }
        Ok(processes)
    }
}

fn current_dsh_process_conflict() -> Result<Option<DshProcessConflict>, String> {
    let processes = list_external_dsh_processes()?;
    if processes.is_empty() {
        Ok(None)
    } else {
        Ok(Some(DshProcessConflict {
            dsh_home: dsh_home().to_string_lossy().into_owned(),
            processes,
        }))
    }
}

fn terminate_process_tree(pid: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill");
        command.args(["/PID", &pid.to_string(), "/T", "/F"]);
        configure_hidden_process(&mut command);
        let output = command
            .output()
            .map_err(|error| format!("无法终止 DSH 进程 {pid}：{error}"))?;
        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "终止 DSH 进程 {pid} 失败：{}",
                decode_process_line(&output.stderr)
            ))
        }
    }
    #[cfg(unix)]
    {
        let group_status = Command::new("kill")
            .args(["-TERM", &format!("-{pid}")])
            .status()
            .map_err(|error| format!("无法终止 DSH 进程 {pid}：{error}"))?;
        if group_status.success() {
            return Ok(());
        }
        let process_status = Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .map_err(|error| format!("无法终止 DSH 进程 {pid}：{error}"))?;
        process_status
            .success()
            .then_some(())
            .ok_or_else(|| format!("终止 DSH 进程 {pid} 失败"))
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
        let (runtime_available, runtime_starting, message, package_available, process_conflict) =
            match state {
                Ok(state) => (
                    state.phase == RuntimePhase::Ready,
                    matches!(state.phase, RuntimePhase::Checking | RuntimePhase::Starting),
                    state.message.clone(),
                    state.package_available,
                    state.process_conflict.clone(),
                ),
                Err(_) => (false, false, "DSH 启动状态不可用".to_string(), false, None),
            };
        DshStatus {
            dsh_home: dsh_home().to_string_lossy().into_owned(),
            runtime_directory: dsh_home().to_string_lossy().into_owned(),
            package_name: format!("{BUNDLED_DSH_PACKAGE}@{BUNDLED_DSH_VERSION}（内嵌运行时）"),
            runtime_available,
            runtime_starting,
            installing: false,
            registry_testing: false,
            selected_registry: None,
            node_available: node_executable().is_ok(),
            npm_available: false,
            package_available,
            message,
            process_conflict,
        }
    }

    fn emit_status(&self, app: &AppHandle) {
        let _ = app.emit("dsh-runtime-status", self.status());
    }

    fn ensure_started(&self, app: &AppHandle) {
        let should_start = self
            .state
            .lock()
            .map(|state| {
                matches!(state.phase, RuntimePhase::Idle)
                    || (state.phase == RuntimePhase::Failed && state.process_conflict.is_none())
            })
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
                RuntimePhase::Checking | RuntimePhase::Starting | RuntimePhase::Ready
            ) {
                return;
            }
            state.generation += 1;
            state.phase = RuntimePhase::Checking;
            state.message = "正在检查 DeepSeek Harness 运行时...".to_string();
            state.auto_restart_pending = false;
            state.process_conflict = None;
            state.generation
        };
        self.emit_status(&app);
        let manager = self.clone();
        thread::spawn(move || manager.prepare_and_launch(app, generation));
    }

    fn stop(&self, message: &str) {
        let pid = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            state.generation += 1;
            state.phase = RuntimePhase::Idle;
            state.message = message.to_string();
            state.stdin = None;
            state.crash_count = 0;
            state.auto_restart_pending = false;
            let pid = state.pid.take();
            pending_error(&mut state, "DSH 桌面宿主已停止".to_string());
            pid
        };
        if let Some(pid) = pid {
            let _ = terminate_process_tree(pid);
        }
    }

    fn restart(&self, app: AppHandle) {
        self.stop("正在重新启动 DSH...");
        self.emit_status(&app);
        self.start(app);
    }

    fn prepare_and_launch(&self, app: AppHandle, generation: u64) {
        let result = (|| -> Result<DshLaunch, String> {
            if let Some(conflict) = current_dsh_process_conflict()? {
                if let Ok(mut state) = self.state.lock() {
                    state.process_conflict = Some(conflict);
                }
                return Err("检测到同一 DSH_HOME 正被其他 DSH 使用".to_string());
            }
            // Profile data remains user-owned in DSH_HOME. The DSH executable and
            // all of its dependencies are read exclusively from Tauri resources.
            materialize_desktop_profile()?;
            let launch = bundled_dsh_launch(&app)?;
            self.emit_runtime_log(
                &app,
                generation,
                "start",
                "diagnostic",
                format!("使用 {} 启动 DSH", launch.source.label()),
            );
            if !self.is_current(generation) {
                return Err("DSH 启动已取消".to_string());
            }
            if let Ok(mut state) = self.state.lock() {
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
                if state.generation != generation || state.phase != RuntimePhase::Checking {
                    return false;
                }
                state.phase = RuntimePhase::Starting;
                state.message = "正在启动DeepSeek Harness...".to_string();
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
            if let Some(conflict) = current_dsh_process_conflict()? {
                if let Ok(mut state) = self.state.lock() {
                    state.process_conflict = Some(conflict);
                }
                return Err("检测到同一 DSH_HOME 正被其他 DSH 使用".to_string());
            }
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
            let _ = terminate_process_tree(pid);
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
fn terminate_dsh_processes(
    pids: Vec<u32>,
    runtime: State<'_, BridgeManager>,
) -> Result<(), String> {
    if pids.is_empty() {
        return Err("没有可终止的 DSH 进程".to_string());
    }
    let candidates = list_external_dsh_processes()?;
    let candidate_pids: std::collections::HashSet<u32> =
        candidates.into_iter().map(|process| process.pid).collect();
    let mut unique_pids = Vec::new();
    for pid in pids {
        if !candidate_pids.contains(&pid) {
            return Err(format!("DSH 进程 {pid} 已退出或不是可识别的 DSH 进程"));
        }
        if !unique_pids.contains(&pid) {
            unique_pids.push(pid);
        }
    }
    for pid in unique_pids {
        terminate_process_tree(pid)?;
    }
    if let Ok(mut state) = runtime.state.lock() {
        state.process_conflict = None;
    }
    Ok(())
}

#[tauri::command]
fn get_windows_context_menu_status() -> windows_context_menu::ContextMenuStatus {
    windows_context_menu::status()
}

#[tauri::command]
fn set_windows_context_menu_enabled(
    enabled: bool,
) -> Result<windows_context_menu::ContextMenuStatus, String> {
    windows_context_menu::set_enabled(enabled)
}

#[tauri::command]
fn get_dock_position(
    app: AppHandle,
    id: String,
) -> Result<Option<dock_position::DockPosition>, String> {
    dock_position::get(app, id)
}

#[tauri::command]
fn set_dock_position(
    app: AppHandle,
    id: String,
    position: dock_position::DockPosition,
) -> Result<(), String> {
    dock_position::set(app, id, position)
}

#[tauri::command]
fn reset_dock_position(app: AppHandle, id: String) -> Result<(), String> {
    dock_position::reset(app, id)
}

#[tauri::command]
fn get_dock_settings(app: AppHandle) -> Result<dock_settings::DockSettings, String> {
    dock_settings::get(app)
}

#[tauri::command]
fn set_dock_settings(
    app: AppHandle,
    settings: dock_settings::DockSettings,
) -> Result<dock_settings::DockSettings, String> {
    dock_settings::set(app, settings)
}

#[tauri::command]
fn get_window_behavior_settings(
    app: AppHandle,
) -> Result<window_behavior::WindowBehaviorSettings, String> {
    window_behavior::get_window_behavior_settings(app)
}

#[tauri::command]
fn set_window_behavior_settings(
    app: AppHandle,
    settings: window_behavior::WindowBehaviorSettings,
) -> Result<window_behavior::WindowBehaviorSettings, String> {
    window_behavior::set_window_behavior_settings(app, settings)
}

#[tauri::command]
fn resolve_window_close(
    app: AppHandle,
    runtime: State<'_, BridgeManager>,
    behavior: window_behavior::CloseBehavior,
) -> Result<(), String> {
    let previous = match window_behavior::load(&app) {
        Ok(settings) => settings,
        Err(error) => {
            runtime.clear_window_close();
            return Err(error);
        }
    };
    let settings = window_behavior::WindowBehaviorSettings {
        minimize_to_tray: previous.minimize_to_tray,
        close_behavior: behavior.clone(),
    };
    if let Err(error) = window_behavior::save(&app, &settings) {
        runtime.clear_window_close();
        return Err(error);
    }
    runtime.clear_window_close();
    match behavior {
        window_behavior::CloseBehavior::HideToTray => {
            if let Err(error) = hide_main_window(&app) {
                let _ = window_behavior::save(&app, &previous);
                Err(error)
            } else {
                Ok(())
            }
        }
        window_behavior::CloseBehavior::Exit => {
            app.exit(0);
            Ok(())
        }
        window_behavior::CloseBehavior::Ask => {
            let _ = window_behavior::save(&app, &previous);
            Err("关闭行为不能设置为询问".to_string())
        }
    }
}

#[tauri::command]
fn list_pending_window_close(runtime: State<'_, BridgeManager>) -> bool {
    runtime.pending_window_close.load(Ordering::Acquire)
}

#[tauri::command]
fn cancel_window_close(runtime: State<'_, BridgeManager>) {
    runtime.clear_window_close();
}

fn hide_main_window(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到 Deeptop 主窗口".to_string())?;
    window
        .hide()
        .map_err(|error| format!("隐藏 Deeptop 窗口失败：{error}"))
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

fn publish_external_launch(
    app: &AppHandle,
    runtime: &BridgeManager,
    request: external_launch::ExternalLaunchRequest,
) {
    runtime.enqueue_external_launch(request.clone());
    focus_main_window(app);
    let _ = app.emit("external-launch", request);
}

fn validate_tray_session_menu(snapshot: &TraySessionMenuSnapshot) -> Result<(), String> {
    let items = snapshot
        .unread
        .iter()
        .chain(snapshot.recent.iter())
        .chain(snapshot.more.iter());
    let total = snapshot.unread.len() + snapshot.recent.len() + snapshot.more.len();
    if total > MAX_TRAY_SESSION_ITEMS {
        return Err(format!(
            "托盘会话条目过多，最多允许 {MAX_TRAY_SESSION_ITEMS} 条"
        ));
    }
    let mut session_ids = HashSet::with_capacity(total);
    for item in items {
        let session_id = item.session_id.trim();
        if session_id.is_empty()
            || session_id.chars().count() > MAX_TRAY_SESSION_ID_CHARS
            || session_id.chars().any(char::is_control)
        {
            return Err("托盘会话 ID 无效".to_string());
        }
        if !session_ids.insert(session_id) {
            return Err("托盘会话条目不能重复".to_string());
        }
    }
    Ok(())
}

fn tray_menu_text(value: &str, fallback: &str, max_chars: usize) -> String {
    let compact = value
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let source = if compact.is_empty() {
        fallback
    } else {
        &compact
    };
    let mut text = source.chars().take(max_chars).collect::<String>();
    if source.chars().count() > max_chars {
        text.pop();
        text.push('…');
    }
    text
}

fn tray_session_label(item: &TraySessionMenuItem) -> String {
    let marker = match item.status {
        TraySessionStatus::Idle => "",
        TraySessionStatus::Running => "◉ ",
        TraySessionStatus::Unread => "● ",
        TraySessionStatus::Error => "⚠ ",
    };
    let context = item
        .context
        .as_deref()
        .map(|value| tray_menu_text(value, "", MAX_TRAY_CONTEXT_CHARS))
        .filter(|value| !value.is_empty());
    let context_width = context
        .as_ref()
        .map(|value| " · ".chars().count() + value.chars().count())
        .unwrap_or_default();
    let title_width = MAX_TRAY_SESSION_LABEL_CHARS
        .saturating_sub(marker.chars().count() + context_width)
        .clamp(1, MAX_TRAY_TITLE_CHARS);
    let title = tray_menu_text(&item.title, "未命名会话", title_width);
    let label = match context {
        Some(context) => format!("{marker}{title} · {context}"),
        None => format!("{marker}{title}"),
    };
    debug_assert!(label.chars().count() <= MAX_TRAY_SESSION_LABEL_CHARS);
    label.replace('&', "&&")
}

fn build_tray_menu(
    app: &AppHandle,
    snapshot: &TraySessionMenuSnapshot,
    generation: u64,
) -> Result<(Menu<tauri::Wry>, HashMap<String, String>), String> {
    validate_tray_session_menu(snapshot)?;
    let menu = Menu::new(app).map_err(|error| format!("创建托盘菜单失败：{error}"))?;
    let mut session_ids = HashMap::new();
    let mut item_index = 0usize;

    if !snapshot.unread.is_empty() {
        let heading = MenuItemBuilder::new("未读")
            .enabled(false)
            .build(app)
            .map_err(|error| format!("创建托盘未读标题失败：{error}"))?;
        menu.append(&heading)
            .map_err(|error| format!("添加托盘未读标题失败：{error}"))?;
        for item in &snapshot.unread {
            let menu_id = format!("tray-session-{generation}-{item_index}");
            item_index += 1;
            let menu_item = MenuItemBuilder::with_id(menu_id.clone(), tray_session_label(item))
                .build(app)
                .map_err(|error| format!("创建托盘会话条目失败：{error}"))?;
            menu.append(&menu_item)
                .map_err(|error| format!("添加托盘会话条目失败：{error}"))?;
            session_ids.insert(menu_id, item.session_id.trim().to_string());
        }
    }

    if !snapshot.recent.is_empty() {
        let heading = MenuItemBuilder::new("最近")
            .enabled(false)
            .build(app)
            .map_err(|error| format!("创建托盘最近标题失败：{error}"))?;
        menu.append(&heading)
            .map_err(|error| format!("添加托盘最近标题失败：{error}"))?;
        for item in &snapshot.recent {
            let menu_id = format!("tray-session-{generation}-{item_index}");
            item_index += 1;
            let menu_item = MenuItemBuilder::with_id(menu_id.clone(), tray_session_label(item))
                .build(app)
                .map_err(|error| format!("创建托盘会话条目失败：{error}"))?;
            menu.append(&menu_item)
                .map_err(|error| format!("添加托盘会话条目失败：{error}"))?;
            session_ids.insert(menu_id, item.session_id.trim().to_string());
        }
    }

    if !snapshot.more.is_empty() {
        let more = SubmenuBuilder::with_id(app, "more-sessions", "更多")
            .build()
            .map_err(|error| format!("创建托盘更多菜单失败：{error}"))?;
        for item in &snapshot.more {
            let menu_id = format!("tray-session-{generation}-{item_index}");
            item_index += 1;
            let menu_item = MenuItemBuilder::with_id(menu_id.clone(), tray_session_label(item))
                .build(app)
                .map_err(|error| format!("创建托盘更多会话失败：{error}"))?;
            more.append(&menu_item)
                .map_err(|error| format!("添加托盘更多会话失败：{error}"))?;
            session_ids.insert(menu_id, item.session_id.trim().to_string());
        }
        menu.append(&more)
            .map_err(|error| format!("添加托盘更多菜单失败：{error}"))?;
    }

    if item_index > 0 {
        let separator = PredefinedMenuItem::separator(app)
            .map_err(|error| format!("创建托盘分隔线失败：{error}"))?;
        menu.append(&separator)
            .map_err(|error| format!("添加托盘分隔线失败：{error}"))?;
    }
    let new_chat = MenuItemBuilder::with_id("new-deeptop-chat", "新会话")
        .build(app)
        .map_err(|error| format!("创建托盘新会话入口失败：{error}"))?;
    let show = MenuItemBuilder::with_id("show-main-window", "打开 Deeptop")
        .build(app)
        .map_err(|error| format!("创建托盘窗口入口失败：{error}"))?;
    let separator = PredefinedMenuItem::separator(app)
        .map_err(|error| format!("创建托盘分隔线失败：{error}"))?;
    let quit = MenuItemBuilder::with_id("quit-deeptop", "退出 Deeptop")
        .build(app)
        .map_err(|error| format!("创建托盘退出入口失败：{error}"))?;
    menu.append(&new_chat)
        .and_then(|_| menu.append(&show))
        .and_then(|_| menu.append(&separator))
        .and_then(|_| menu.append(&quit))
        .map_err(|error| format!("添加托盘固定入口失败：{error}"))?;
    Ok((menu, session_ids))
}

#[cfg(windows)]
fn tray_popup_height(snapshot: &TraySessionMenuSnapshot) -> u32 {
    let section_count =
        usize::from(!snapshot.unread.is_empty()) + usize::from(!snapshot.recent.is_empty());
    let session_count = snapshot.unread.len() + snapshot.recent.len();
    TRAY_POPUP_OUTER_HEIGHT
        + section_count as u32 * TRAY_POPUP_SECTION_HEIGHT
        + session_count as u32 * TRAY_POPUP_SESSION_HEIGHT
        + u32::from(!snapshot.more.is_empty()) * TRAY_POPUP_MORE_HEIGHT
        + TRAY_POPUP_ACTIONS_HEIGHT
}

#[cfg(windows)]
#[allow(clippy::too_many_arguments)]
fn tray_popup_position(
    anchor_x: f64,
    anchor_y: f64,
    anchor_width: u32,
    anchor_height: u32,
    popup_width: u32,
    popup_height: u32,
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
) -> PhysicalPosition<i32> {
    let work_left = i64::from(work_x);
    let work_top = i64::from(work_y);
    let work_right = work_left + i64::from(work_width);
    let work_bottom = work_top + i64::from(work_height);
    let popup_width = i64::from(popup_width);
    let popup_height = i64::from(popup_height);
    let margin = i64::from(TRAY_POPUP_SCREEN_MARGIN);
    let gap = i64::from(TRAY_POPUP_ANCHOR_GAP);

    let ideal_x = (anchor_x + f64::from(anchor_width) / 2.0).round() as i64 - popup_width / 2;
    let min_x = work_left + margin;
    let max_x = (work_right - popup_width - margin).max(min_x);
    let x = ideal_x.clamp(min_x, max_x);

    let above = anchor_y.round() as i64 - popup_height - gap;
    let below = (anchor_y + f64::from(anchor_height)).round() as i64 + gap;
    let min_y = work_top + margin;
    let max_y = (work_bottom - popup_height - margin).max(min_y);
    let y = if above >= min_y { above } else { below }.clamp(min_y, max_y);

    PhysicalPosition::new(x as i32, y as i32)
}

#[cfg(windows)]
fn hide_tray_popup_window(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<TrayMenuState>();
    state.popup_visible.store(false, Ordering::Release);
    state.popup_epoch.fetch_add(1, Ordering::AcqRel);
    if let Some(window) = app.get_webview_window("tray-popup") {
        window
            .hide()
            .map_err(|error| format!("隐藏托盘弹窗失败：{error}"))?;
    }
    Ok(())
}

#[cfg(windows)]
fn resize_tray_popup_if_needed(
    popup: &tauri::WebviewWindow,
    state: &TrayMenuState,
    logical_height: u32,
) -> Result<(), String> {
    if state.popup_height.load(Ordering::Acquire) == logical_height {
        return Ok(());
    }
    popup
        .set_size(LogicalSize::new(
            f64::from(TRAY_POPUP_WIDTH),
            f64::from(logical_height),
        ))
        .map_err(|error| format!("调整托盘弹窗大小失败：{error}"))?;
    state.popup_height.store(logical_height, Ordering::Release);
    Ok(())
}

#[cfg(windows)]
fn position_tray_popup_if_needed(
    popup: &tauri::WebviewWindow,
    state: &TrayMenuState,
    position: PhysicalPosition<i32>,
) -> Result<(), String> {
    let mut current = state
        .popup_position
        .lock()
        .map_err(|_| "托盘弹窗位置缓存不可用".to_string())?;
    if current.as_ref() == Some(&position) {
        return Ok(());
    }
    popup
        .set_position(position)
        .map_err(|error| format!("定位托盘弹窗失败：{error}"))?;
    *current = Some(position);
    Ok(())
}

#[cfg(not(windows))]
fn hide_tray_popup_window(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(windows)]
fn show_tray_popup(
    app: &AppHandle,
    anchor_x: f64,
    anchor_y: f64,
    anchor_width: u32,
    anchor_height: u32,
) -> Result<(), String> {
    let state = app.state::<TrayMenuState>();
    let popup = app
        .get_webview_window("tray-popup")
        .ok_or_else(|| "找不到 Deeptop 托盘弹窗".to_string())?;
    let monitor = app
        .monitor_from_point(anchor_x, anchor_y)
        .map_err(|error| format!("无法定位托盘所在显示器：{error}"))?
        .or_else(|| app.primary_monitor().ok().flatten())
        .ok_or_else(|| "找不到可用显示器".to_string())?;
    let scale_factor = monitor.scale_factor();
    let logical_height = state.desired_popup_height()?;
    let popup_width = (f64::from(TRAY_POPUP_WIDTH) * scale_factor).round() as u32;
    let popup_height = (f64::from(logical_height) * scale_factor).round() as u32;
    let work_area = monitor.work_area();
    let position = tray_popup_position(
        anchor_x,
        anchor_y,
        anchor_width,
        anchor_height,
        popup_width,
        popup_height,
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
    );

    let result = (|| {
        resize_tray_popup_if_needed(&popup, state.inner(), logical_height)?;
        position_tray_popup_if_needed(&popup, state.inner(), position)?;
        popup
            .show()
            .map_err(|error| format!("显示托盘弹窗失败：{error}"))?;
        popup
            .set_focus()
            .map_err(|error| format!("聚焦托盘弹窗失败：{error}"))?;
        Ok(())
    })();

    if result.is_ok() {
        state.popup_epoch.fetch_add(1, Ordering::AcqRel);
        state.popup_visible.store(true, Ordering::Release);
    } else {
        state.popup_visible.store(false, Ordering::Release);
        let _ = popup.hide();
    }
    result
}

#[cfg(windows)]
fn setup_tray_popup(app: &AppHandle) -> Result<(), String> {
    let popup = WebviewWindowBuilder::new(
        app,
        "tray-popup",
        WebviewUrl::App("index.html?tray-popup=1".into()),
    )
    .title("Deeptop")
    .inner_size(
        f64::from(TRAY_POPUP_WIDTH),
        f64::from(TRAY_POPUP_OUTER_HEIGHT + TRAY_POPUP_ACTIONS_HEIGHT),
    )
    .resizable(false)
    .decorations(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(true)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|error| format!("创建主题托盘弹窗失败：{error}"))?;
    app.state::<TrayMenuState>().popup_height.store(
        TRAY_POPUP_OUTER_HEIGHT + TRAY_POPUP_ACTIONS_HEIGHT,
        Ordering::Release,
    );

    let popup_app = app.clone();
    popup.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Focused(false)) {
            return;
        }
        let epoch = popup_app
            .state::<TrayMenuState>()
            .popup_epoch
            .load(Ordering::Acquire);
        let delayed_app = popup_app.clone();
        thread::spawn(move || {
            thread::sleep(TRAY_POPUP_BLUR_DELAY);
            let main_thread_app = delayed_app.clone();
            let _ = delayed_app.run_on_main_thread(move || {
                let state = main_thread_app.state::<TrayMenuState>();
                if state.popup_epoch.load(Ordering::Acquire) != epoch
                    || !state.popup_visible.load(Ordering::Acquire)
                {
                    return;
                }
                let still_focused = main_thread_app
                    .get_webview_window("tray-popup")
                    .and_then(|window| window.is_focused().ok())
                    .unwrap_or(false);
                if !still_focused {
                    let _ = hide_tray_popup_window(&main_thread_app);
                }
            });
        });
    });
    Ok(())
}

#[tauri::command]
fn get_tray_popup_snapshot(
    state: State<'_, TrayMenuState>,
) -> Result<TraySessionMenuSnapshot, String> {
    state.snapshot()
}

#[tauri::command]
fn open_tray_popup_session(
    app: AppHandle,
    state: State<'_, TrayMenuState>,
    session_id: String,
) -> Result<(), String> {
    let session_id = session_id.trim();
    if session_id.is_empty()
        || session_id.chars().count() > MAX_TRAY_SESSION_ID_CHARS
        || session_id.chars().any(char::is_control)
        || !state.contains_session(session_id)?
    {
        return Err("托盘会话已失效，请重新打开菜单".to_string());
    }
    hide_tray_popup_window(&app)?;
    focus_main_window(&app);
    app.emit("tray-session-open", json!({ "sessionId": session_id }))
        .map_err(|error| format!("打开托盘会话失败：{error}"))
}

#[tauri::command]
fn run_tray_popup_action(app: AppHandle, action: TrayPopupAction) -> Result<(), String> {
    hide_tray_popup_window(&app)?;
    match action {
        TrayPopupAction::NewChat => {
            focus_main_window(&app);
            app.emit("tray-new-chat", ())
                .map_err(|error| format!("新建托盘会话失败：{error}"))?;
        }
        TrayPopupAction::ShowMain => focus_main_window(&app),
        TrayPopupAction::Quit => app.exit(0),
    }
    Ok(())
}

#[tauri::command]
fn dismiss_tray_popup(app: AppHandle) -> Result<(), String> {
    hide_tray_popup_window(&app)
}

#[tauri::command]
fn update_tray_session_menu(
    app: AppHandle,
    state: State<'_, TrayMenuState>,
    snapshot: TraySessionMenuSnapshot,
) -> Result<(), String> {
    if state.snapshot_matches(&snapshot)? {
        return Ok(());
    }
    let generation = state.next_generation();
    let (menu, session_ids) = build_tray_menu(&app, &snapshot, generation)?;
    let tray = app
        .tray_by_id("main-tray")
        .ok_or_else(|| "找不到 Deeptop 系统托盘".to_string())?;
    tray.set_menu(Some(menu))
        .map_err(|error| format!("更新系统托盘失败：{error}"))?;
    *state
        .session_ids
        .lock()
        .map_err(|_| "托盘会话索引不可用".to_string())? = session_ids;
    state.replace_snapshot(snapshot.clone())?;
    if let Some(window) = app.get_webview_window("tray-popup") {
        #[cfg(windows)]
        if !state.popup_visible.load(Ordering::Acquire) {
            let height = tray_popup_height(&snapshot);
            if let Err(error) = resize_tray_popup_if_needed(&window, state.inner(), height) {
                eprintln!("{error}；将在下次打开托盘时重试");
            }
        }
        let _ = window.emit("tray-popup-updated", snapshot);
    }
    Ok(())
}

fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let (menu, _) = build_tray_menu(app, &TraySessionMenuSnapshot::default(), 0)?;
    #[cfg(windows)]
    let themed_popup_ready = match setup_tray_popup(app) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("{error}；将使用系统原生托盘菜单");
            false
        }
    };
    #[cfg(not(windows))]
    let themed_popup_ready = false;
    let app_handle = app.clone();
    let tray_app = app.clone();
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "Deeptop 图标未配置".to_string())?;
    let tray = TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .menu(&menu)
        .tooltip("Deeptop")
        // The themed popup replaces the left-click menu on Windows, but the
        // native right-click menu remains the reliable fallback for tray access.
        .show_menu_on_left_click(!themed_popup_ready)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "new-deeptop-chat" => {
                focus_main_window(app);
                let _ = app.emit("tray-new-chat", ());
            }
            "show-main-window" => focus_main_window(app),
            "quit-deeptop" => app.exit(0),
            menu_id => {
                let state = app.state::<TrayMenuState>();
                if let Some(session_id) = state.session_id(menu_id) {
                    focus_main_window(app);
                    let _ = app.emit("tray-session-open", json!({ "sessionId": session_id }));
                }
            }
        })
        .on_tray_icon_event(move |_, event| match event {
            TrayIconEvent::DoubleClick { .. } => {
                let _ = hide_tray_popup_window(&app_handle);
                focus_main_window(&app_handle);
            }
            #[cfg(windows)]
            TrayIconEvent::Click {
                rect,
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } if themed_popup_ready => {
                let state = app_handle.state::<TrayMenuState>();
                let anchor_position = rect.position.to_physical::<f64>(1.0);
                let anchor_size = rect.size.to_physical::<u32>(1.0);
                if state.popup_visible.load(Ordering::Acquire) {
                    let _ = hide_tray_popup_window(&app_handle);
                } else if let Err(error) = show_tray_popup(
                    &app_handle,
                    anchor_position.x,
                    anchor_position.y,
                    anchor_size.width,
                    anchor_size.height,
                ) {
                    eprintln!("{error}；将使用系统原生托盘菜单");
                    if let Some(tray) = app_handle.tray_by_id("main-tray") {
                        let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
                    }
                }
            }
            _ => {}
        })
        .build(&tray_app)
        .map_err(|error| format!("创建系统托盘失败：{error}"))?;
    #[cfg(windows)]
    tray.with_inner_tray_icon(|inner| inner.set_show_menu_on_right_click(true))
        .map_err(|error| format!("启用系统托盘右键菜单失败：{error}"))?;
    let _tray = tray;
    Ok(())
}

fn install_window_behavior_handlers(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "找不到 Deeptop 主窗口".to_string())?;
    let app_handle = app.clone();
    let runtime = app.state::<BridgeManager>().inner().clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            let settings = window_behavior::load(&app_handle).unwrap_or_default();
            match settings.close_behavior {
                window_behavior::CloseBehavior::Ask => {
                    api.prevent_close();
                    if runtime.request_window_close() {
                        let _ = app_handle.emit("window-close-requested", ());
                    }
                }
                window_behavior::CloseBehavior::HideToTray => {
                    api.prevent_close();
                    let _ = hide_main_window(&app_handle);
                }
                window_behavior::CloseBehavior::Exit => {}
            }
        }
    });
    Ok(())
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
fn list_pending_external_launches(
    runtime: State<'_, BridgeManager>,
) -> Vec<external_launch::ExternalLaunchRequest> {
    runtime.list_external_launches()
}

#[tauri::command]
fn acknowledge_pending_external_launch(runtime: State<'_, BridgeManager>, paths: Vec<String>) {
    runtime.acknowledge_external_launch(&paths);
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

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitCommit {
    hash: String,
    short_hash: String,
    author: String,
    email: String,
    timestamp: i64,
    subject: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitFileStat {
    path: String,
    additions: u32,
    deletions: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitCommitDetail {
    hash: String,
    subject: String,
    author: String,
    email: String,
    timestamp: i64,
    body: String,
    files: Vec<WorkspaceGitFileStat>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitBranch {
    name: String,
    is_current: bool,
    is_remote: bool,
    upstream: Option<String>,
    short_oid: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitCommandResult {
    ok: bool,
    stdout: String,
    stderr: String,
    text: String,
}

impl GitCommandResult {
    fn from_output(stdout: String, stderr: String, ok: bool) -> Self {
        let combined = [stdout.trim().to_string(), stderr.trim().to_string()]
            .into_iter()
            .fold(String::new(), |mut acc, part| {
                if part.is_empty() {
                    return acc;
                }
                if !acc.is_empty() {
                    acc.push('\n');
                }
                acc.push_str(&part);
                acc
            });
        Self {
            ok,
            stdout,
            stderr,
            text: combined,
        }
    }
}

/// git 命令原始输出：只区分“能否启动”，退出码由调用方判定。
struct GitOutput {
    ok: bool,
    stdout: String,
    stderr: String,
}

fn git_raw_output(directory: &Path, args: &[&str]) -> Result<GitOutput, String> {
    let output = git_output(directory, args).map_err(|error| format!("无法运行 git：{error}"))?;
    Ok(GitOutput {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

/// 解析仓库根目录，之后所有变更命令都在根目录执行，
/// 保证 porcelain/路径参数始终相对仓库根目录一致。
fn git_repository_root(directory: &Path) -> Result<PathBuf, String> {
    let probe = git_raw_output(directory, &["rev-parse", "--show-toplevel"])?;
    let value = probe.stdout.trim().to_string();
    if !probe.ok || value.is_empty() {
        let detail = probe.stderr.trim();
        return Err(if detail.is_empty() {
            "当前工作区不是 Git 仓库".to_string()
        } else {
            format!("当前工作区不是 Git 仓库：{detail}")
        });
    }
    Ok(PathBuf::from(value))
}

/// 校验来自工作区的路径参数：它们应来自同一仓库的 status，仅需防御性排除
/// 会改变 git 解析语义的前导字符。
fn validate_git_paths(paths: &[String]) -> Result<(), String> {
    for path in paths {
        if path.is_empty() {
            return Err("文件路径为空".into());
        }
        if path.starts_with('-') || path.starts_with(":/") || path.contains('\0') {
            return Err(format!("非法文件路径：{path}"));
        }
        if path.split('/').any(|segment| segment == "..") {
            return Err(format!("非法文件路径：{path}"));
        }
    }
    Ok(())
}

/// 解析 porcelain v1 -z 输出为 (是否未跟踪, 路径) 列表。
fn parse_porcelain_paths(bytes: &[u8]) -> Vec<(bool, String)> {
    let mut result = Vec::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
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
        result.push((x == '?' && y == '?', path));
    }
    result
}

/// 读取某个文件的工作区/暂存区统一差异；超大 diff 会被截断以保护前台负载。
#[tauri::command]
fn git_file_diff(dir: String, path: String, staged: bool) -> Result<String, String> {
    validate_git_paths(&[path.clone()])?;
    let root = git_repository_root(Path::new(&dir))?;
    let mut args: Vec<&str> = vec!["--no-pager", "diff", "--no-color"];
    if staged {
        args.push("--cached");
    }
    args.push("--");
    args.push(&path);
    let output = git_raw_output(&root, &args)?;
    let mut text = output.stdout;
    const MAX_DIFF_BYTES: usize = 512 * 1024;
    if text.len() > MAX_DIFF_BYTES {
        text.truncate(MAX_DIFF_BYTES);
        text.push_str("\n…差异过大，已截断\n");
    }
    Ok(text)
}

/// 暂存指定文件（git add）。
#[tauri::command]
fn git_stage_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    validate_git_paths(&paths)?;
    let root = git_repository_root(Path::new(&dir))?;
    let mut args = vec!["add", "--"];
    args.extend(paths.iter().map(String::as_str));
    let output = git_raw_output(&root, &args)?;
    if output.ok {
        Ok(())
    } else {
        Err(output.stderr.trim().to_string())
    }
}

/// 取消暂存指定文件（git restore --staged，失败时回退 git reset --）。
#[tauri::command]
fn git_unstage_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    validate_git_paths(&paths)?;
    let root = git_repository_root(Path::new(&dir))?;
    let mut args = vec!["restore", "--staged", "--"];
    args.extend(paths.iter().map(String::as_str));
    let output = git_raw_output(&root, &args)?;
    if output.ok {
        return Ok(());
    }
    // 未出生分支等场景 restore --staged 不可用时回退 reset。
    let mut fallback = vec!["reset", "-q", "--"];
    fallback.extend(paths.iter().map(String::as_str));
    let retry = git_raw_output(&root, &fallback)?;
    if retry.ok {
        Ok(())
    } else {
        Err(format!("{}\n{}", output.stderr.trim(), retry.stderr.trim()))
    }
}

/// 放弃指定文件的全部改动：已暂存的恢复为未暂存，工作区改动还原到
/// 仓库内容，未跟踪文件删除。仓库无提交时退化为清空暂存并删除。
#[tauri::command]
fn git_discard_paths(dir: String, paths: Vec<String>) -> Result<(), String> {
    validate_git_paths(&paths)?;
    let root = git_repository_root(Path::new(&dir))?;
    let mut status_args = vec![
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--",
    ];
    status_args.extend(paths.iter().map(String::as_str));
    let status = git_raw_output(&root, &status_args)?;
    let mut tracked: Vec<String> = Vec::new();
    let mut untracked: Vec<String> = Vec::new();
    for (is_untracked, path) in parse_porcelain_paths(&status.stdout.into_bytes()) {
        if is_untracked {
            untracked.push(path);
        } else {
            tracked.push(path);
        }
    }
    let has_head = git_raw_output(&root, &["rev-parse", "--verify", "HEAD"])?.ok;
    if has_head && !tracked.is_empty() {
        let mut args = vec!["restore", "--source=HEAD", "--staged", "--worktree", "--"];
        args.extend(tracked.iter().map(String::as_str));
        let output = git_raw_output(&root, &args)?;
        if !output.ok {
            return Err(output.stderr.trim().to_string());
        }
    } else if !tracked.is_empty() {
        // 未出生分支：先清空暂存，再删除对应的新增/修改文件。
        let _ = git_raw_output(&root, &["reset", "-q", "--"]);
        let mut clean_args = vec!["clean", "-f", "-d", "--"];
        clean_args.extend(tracked.iter().map(String::as_str));
        let clean = git_raw_output(&root, &clean_args)?;
        if !clean.ok {
            return Err(clean.stderr.trim().to_string());
        }
    }
    if !untracked.is_empty() {
        let mut clean_args = vec!["clean", "-f", "-d", "--"];
        clean_args.extend(untracked.iter().map(String::as_str));
        let clean = git_raw_output(&root, &clean_args)?;
        if !clean.ok {
            return Err(clean.stderr.trim().to_string());
        }
    }
    Ok(())
}

/// 暂存所有更改（git add -A）。
#[tauri::command]
fn git_stage_all(dir: String) -> Result<(), String> {
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["add", "-A"])?;
    if output.ok {
        Ok(())
    } else {
        Err(output.stderr.trim().to_string())
    }
}

/// 取消所有暂存（git reset）。
#[tauri::command]
fn git_unstage_all(dir: String) -> Result<(), String> {
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["reset", "-q"])?;
    if output.ok {
        Ok(())
    } else {
        Err(output.stderr.trim().to_string())
    }
}

/// 提交暂存区内容；提交信息为空或超长时拒绝。
#[tauri::command]
fn git_commit(dir: String, message: String) -> Result<GitCommandResult, String> {
    let message = message.trim();
    if message.is_empty() {
        return Err("提交信息不能为空".into());
    }
    if message.chars().count() > 4096 {
        return Err("提交信息过长（最多 4096 字符）".into());
    }
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["--no-pager", "commit", "-m", message])?;
    Ok(GitCommandResult::from_output(
        output.stdout,
        output.stderr,
        output.ok,
    ))
}

/// 读取最近提交历史（含作者、时间、主题）。
#[tauri::command]
fn git_log(dir: String, limit: u32) -> Result<Vec<WorkspaceGitCommit>, String> {
    let limit = limit.clamp(1, 200);
    let root = git_repository_root(Path::new(&dir))?;
    let format = "%H\x1f%h\x1f%an\x1f%ae\x1f%at\x1f%s\x1e";
    let output = git_raw_output(
        &root,
        &[
            "--no-pager",
            "log",
            &format!("-n{limit}"),
            &format!("--format={format}"),
        ],
    )?;
    if !output.ok {
        let text = format!("{}\n{}", output.stdout, output.stderr);
        if text.contains("does not have any commits") {
            return Ok(Vec::new());
        }
        return Err(text.trim().to_string());
    }
    let mut commits = Vec::new();
    for record in output.stdout.split('\x1e') {
        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 6 {
            continue;
        }
        commits.push(WorkspaceGitCommit {
            hash: fields[0].to_string(),
            short_hash: fields[1].to_string(),
            author: fields[2].to_string(),
            email: fields[3].to_string(),
            timestamp: fields[4].parse::<i64>().unwrap_or(0),
            subject: fields[5].to_string(),
        });
    }
    Ok(commits)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceGitGraphLine {
    graph: String,
    hash: String,
    short_hash: String,
    timestamp: i64,
    refs: Vec<String>,
    subject: String,
}

/// 读取带图谱前缀的提交行（git log --graph --all），供历史页渲染提交树。
/// 每一行按 \x1f 分隔字段，头部为“图列前缀 + 完整哈希”，行与行按 \x1e 分隔。
#[tauri::command]
fn git_graph(dir: String, limit: u32) -> Result<Vec<WorkspaceGitGraphLine>, String> {
    let limit = limit.clamp(1, 200);
    let root = git_repository_root(Path::new(&dir))?;
    let format = "%H\x1f%h\x1f%at\x1f%D\x1f%s\x1e";
    let output = git_raw_output(
        &root,
        &[
            "--no-pager",
            "log",
            "--graph",
            "--no-color",
            "--all",
            &format!("-n{limit}"),
            &format!("--format={format}"),
        ],
    )?;
    if !output.ok {
        let text = format!("{}\n{}", output.stdout, output.stderr);
        if text.contains("does not have any commits") {
            return Ok(Vec::new());
        }
        return Err(text.trim().to_string());
    }
    let mut lines = Vec::new();
    for record in output.stdout.split('\x1e') {
        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 5 {
            continue;
        }
        // 图列前缀只含制表符/空格等非十六进制字符，完整哈希从首个十六进制位开始。
        let head = fields[0];
        let hash_start = head
            .char_indices()
            .find(|(_, ch)| ch.is_ascii_hexdigit())
            .map(|(index, _)| index)
            .unwrap_or(head.len());
        let graph = head[..hash_start].trim_end().to_string();
        let hash = head[hash_start..].trim().to_string();
        if hash.len() != 40 {
            continue;
        }
        lines.push(WorkspaceGitGraphLine {
            graph,
            hash,
            short_hash: fields[1].to_string(),
            timestamp: fields[2].parse::<i64>().unwrap_or(0),
            refs: fields[3]
                .split(',')
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect(),
            subject: fields[4].to_string(),
        });
    }
    Ok(lines)
}

fn validate_git_oid(value: &str) -> Result<&str, String> {
    let value = value.trim();
    if value.is_empty() || value.len() > 40 || !value.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("无效的提交标识".into());
    }
    Ok(value)
}

/// 读取单个提交的完整信息与变更统计（numstat）。
#[tauri::command]
fn git_commit_detail(dir: String, hash: String) -> Result<WorkspaceGitCommitDetail, String> {
    let hash = validate_git_oid(&hash)?;
    let root = git_repository_root(Path::new(&dir))?;
    let format = "%H\x00%an\x00%ae\x00%at\x00%s\x00%b\x00";
    let header = git_raw_output(
        &root,
        &[
            "--no-pager",
            "show",
            "-s",
            &format!("--format={format}"),
            hash,
        ],
    )?;
    if !header.ok {
        let text = format!("{}\n{}", header.stdout, header.stderr);
        return Err(text.trim().to_string());
    }
    let parts: Vec<&str> = header.stdout.split('\0').collect();
    if parts.len() < 6 || parts[0].is_empty() {
        return Err("无法解析提交信息".into());
    }
    let stat_output = git_raw_output(
        &root,
        &[
            "--no-pager",
            "show",
            "--numstat",
            "--format=",
            "--no-renames",
            hash,
        ],
    )?;
    let mut files = Vec::new();
    for line in stat_output.stdout.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut pieces = line.splitn(3, '\t');
        let (Some(additions_raw), Some(deletions_raw), Some(path)) =
            (pieces.next(), pieces.next(), pieces.next())
        else {
            continue;
        };
        files.push(WorkspaceGitFileStat {
            path: path.to_string(),
            additions: additions_raw.parse::<u32>().unwrap_or(0),
            deletions: deletions_raw.parse::<u32>().unwrap_or(0),
        });
    }
    Ok(WorkspaceGitCommitDetail {
        hash: parts[0].to_string(),
        subject: parts[4].to_string(),
        author: parts[1].to_string(),
        email: parts[2].to_string(),
        timestamp: parts[3].parse::<i64>().unwrap_or(0),
        body: parts[5].to_string(),
        files,
    })
}

/// 列出本地与远程分支，当前分支优先。
#[tauri::command]
fn git_branches(dir: String) -> Result<Vec<WorkspaceGitBranch>, String> {
    let root = git_repository_root(Path::new(&dir))?;
    let format = "%(HEAD)%1f%(refname)%1f%(upstream:short)%1f%(objectname:short)%1e";
    let output = git_raw_output(
        &root,
        &[
            "--no-pager",
            "for-each-ref",
            &format!("--format={format}"),
            "refs/heads",
            "refs/remotes",
        ],
    )?;
    if !output.ok {
        return Err(output.stderr.trim().to_string());
    }
    let mut branches = Vec::new();
    for record in output.stdout.split('\x1e') {
        let fields: Vec<&str> = record.split('\x1f').collect();
        if fields.len() < 4 {
            continue;
        }
        let head = fields[0].trim();
        let refname = fields[1];
        let is_remote = refname.starts_with("refs/remotes/");
        let name = if is_remote {
            refname.trim_start_matches("refs/remotes/").to_string()
        } else {
            refname.trim_start_matches("refs/heads/").to_string()
        };
        branches.push(WorkspaceGitBranch {
            name,
            is_current: head == "*",
            is_remote,
            upstream: {
                let upstream = fields[2].trim();
                if upstream.is_empty() {
                    None
                } else {
                    Some(upstream.to_string())
                }
            },
            short_oid: fields[3].to_string(),
        });
    }
    branches.sort_by_key(|branch| {
        (
            branch.is_remote,
            !branch.is_current,
            branch.name.to_lowercase(),
        )
    });
    Ok(branches)
}

fn validate_branch_name(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("分支名称不能为空".into());
    }
    if name.starts_with('-')
        || name.ends_with('/')
        || name.contains("..")
        || name.contains("//")
        || name.contains(" ")
        || name.contains('\0')
        || name.contains("~^:?*[\\")
    {
        return Err("分支名称包含非法字符".into());
    }
    Ok(name)
}

/// 切换到已有分支（git switch）。
#[tauri::command]
fn git_checkout_branch(dir: String, name: String) -> Result<GitCommandResult, String> {
    let name = validate_branch_name(&name)?;
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["--no-pager", "switch", name])?;
    Ok(GitCommandResult::from_output(
        output.stdout,
        output.stderr,
        output.ok,
    ))
}

/// 基于当前分支创建并切换到新分支（git switch -c）。
#[tauri::command]
fn git_create_branch(dir: String, name: String) -> Result<GitCommandResult, String> {
    let name = validate_branch_name(&name)?;
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["--no-pager", "switch", "-c", name])?;
    Ok(GitCommandResult::from_output(
        output.stdout,
        output.stderr,
        output.ok,
    ))
}

/// 强制删除本地分支；当前分支与远程分支不允许删除。
#[tauri::command]
fn git_delete_branch(dir: String, name: String) -> Result<GitCommandResult, String> {
    let name = validate_branch_name(&name)?;
    let root = git_repository_root(Path::new(&dir))?;
    let current = git_raw_output(&root, &["branch", "--show-current"])?;
    let current = current.stdout.trim().to_string();
    if !current.is_empty() && current == name {
        return Ok(GitCommandResult::from_output(
            String::new(),
            "不能删除当前分支，请先切换到其他分支".to_string(),
            false,
        ));
    }
    let output = git_raw_output(&root, &["branch", "-D", name])?;
    Ok(GitCommandResult::from_output(
        output.stdout,
        output.stderr,
        output.ok,
    ))
}

/// 拉取当前分支的上游更新；结果含 git 完整输出，冲突时失败告知。
#[tauri::command]
fn git_pull(dir: String) -> Result<GitCommandResult, String> {
    let root = git_repository_root(Path::new(&dir))?;
    let output = git_raw_output(&root, &["--no-pager", "pull"])?;
    Ok(GitCommandResult::from_output(
        output.stdout,
        output.stderr,
        output.ok,
    ))
}

/// 推送当前分支；未设置上游时自动带 -u 推送到 origin 并建立跟踪。
#[tauri::command]
fn git_push(dir: String) -> Result<GitCommandResult, String> {
    let root = git_repository_root(Path::new(&dir))?;
    let first = git_raw_output(&root, &["--no-pager", "push"])?;
    if first.ok {
        return Ok(GitCommandResult::from_output(
            first.stdout,
            first.stderr,
            true,
        ));
    }
    let combined = format!("{}\n{}", first.stdout, first.stderr);
    let needs_upstream = combined.contains("no upstream")
        || combined.contains("has no upstream branch")
        || combined.contains("No configured push destination")
        || combined.contains("does not match the name of your current branch");
    if !needs_upstream {
        return Ok(GitCommandResult::from_output(
            first.stdout,
            first.stderr,
            false,
        ));
    }
    let branch = git_raw_output(&root, &["branch", "--show-current"])?;
    let branch = branch.stdout.trim().to_string();
    if branch.is_empty() {
        return Ok(GitCommandResult::from_output(
            first.stdout,
            first.stderr,
            false,
        ));
    }
    let retry = git_raw_output(&root, &["--no-pager", "push", "-u", "origin", &branch])?;
    Ok(GitCommandResult::from_output(
        retry.stdout,
        retry.stderr,
        retry.ok,
    ))
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

/// 判断路径是否解析为一个普通文件；不存在、目录和其他文件系统对象均返回 false。
#[tauri::command]
fn is_file_path(path: String) -> bool {
    fs::metadata(PathBuf::from(path))
        .map(|metadata| metadata.is_file())
        .unwrap_or(false)
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
            .add_filter(
                "JavaScript / TypeScript",
                &["js", "mjs", "cjs", "ts", "mts", "cts"],
            )
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
        bound_log_text, dsh_home, dsh_homes_match, extract_runtime_archive, format_log_line,
        format_utc_datetime, is_bundled_runtime_manifest, is_dsh_package_manifest, is_file_path,
        is_safe_runtime_entry, process_command_line_matches_dsh, runtime_arch,
        runtime_cache_validation_message, runtime_platform, runtime_tree_sha256, tray_menu_text,
        tray_session_label, validate_tray_session_menu, validated_connection_url, DshRuntimeLog,
        LogStore, TraySessionMenuItem, TraySessionMenuSnapshot, TraySessionStatus, MAX_LOG_ENTRIES,
        MAX_LOG_TEXT_BYTES, RUNTIME_CACHE_MARKER,
    };

    #[cfg(windows)]
    use super::{
        normalize_windows_resource_path_for_display, process_dsh_home, tray_popup_height,
        tray_popup_position,
    };

    #[cfg(windows)]
    #[test]
    fn normalizes_windows_extended_resource_paths_for_display_only() {
        assert_eq!(
            normalize_windows_resource_path_for_display(std::path::PathBuf::from(
                r"\\?\C:\Deeptop\resources"
            )),
            std::path::PathBuf::from(r"C:\Deeptop\resources")
        );
        assert_eq!(
            normalize_windows_resource_path_for_display(std::path::PathBuf::from(
                r"\\?\UNC\server\share\resources"
            )),
            std::path::PathBuf::from(r"\\server\share\resources")
        );
    }

    #[test]
    fn recognizes_only_node_dsh_desktop_processes() {
        assert!(process_command_line_matches_dsh(
            "node.exe",
            "node.exe C:\\tools\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js --profile desktop"
        ));
        assert!(!process_command_line_matches_dsh(
            "pwsh.exe",
            "pwsh -Command dsh --profile desktop"
        ));
        assert!(!process_command_line_matches_dsh(
            "node.exe",
            "node.exe C:\\tools\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js --profile headless"
        ));
        assert!(!process_command_line_matches_dsh(
            "node.exe",
            "node.exe C:\\tools\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js --profile desktoply"
        ));
    }

    #[test]
    fn matches_only_the_configured_dsh_home() {
        let home = dsh_home();
        assert!(dsh_homes_match(&home));
        assert!(!dsh_homes_match(&home.join("different-dsh-home")));
    }

    #[cfg(windows)]
    #[test]
    fn reads_the_current_process_dsh_home_from_its_environment() {
        let home = process_dsh_home(std::process::id())
            .expect("current process environment should be readable")
            .expect("current process should have a home directory");
        assert!(dsh_homes_match(&home));
    }

    #[test]
    fn identifies_regular_files_without_treating_directories_as_files() {
        let root = std::env::temp_dir().join(format!(
            "deeptop-file-path-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let file = root.join("note.txt");
        std::fs::create_dir_all(&root).expect("create file path test directory");
        std::fs::write(&file, "text").expect("write file path test file");

        assert!(is_file_path(file.to_string_lossy().into_owned()));
        assert!(!is_file_path(root.to_string_lossy().into_owned()));
        assert!(!is_file_path(
            root.join("missing.txt").to_string_lossy().into_owned()
        ));

        std::fs::remove_dir_all(root).expect("remove file path test directory");
    }

    #[test]
    fn accepts_safe_runtime_archive_entries_and_rejects_escapes() {
        assert!(is_safe_runtime_entry(
            "node_modules/@deepseek-ai/dsh/lib/bin.js"
        ));
        assert!(!is_safe_runtime_entry("../escape"));
        assert!(!is_safe_runtime_entry("/absolute"));
        assert!(!is_safe_runtime_entry("C:/escape"));
        assert!(!is_safe_runtime_entry(r"node_modules\\escape"));
    }

    #[test]
    fn extracts_dot_prefixed_archive_entries_into_destination_root() {
        let root = std::env::temp_dir().join(format!(
            "deeptop-runtime-archive-test-{}",
            std::process::id()
        ));
        let archive_path = root.with_extension("tar.gz");
        let destination = root.join("extracted");
        let source = root.join("source");
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&archive_path);
        std::fs::create_dir_all(&source).expect("create archive source");
        std::fs::create_dir_all(&destination).expect("create extraction destination");
        std::fs::write(source.join("runtime-manifest.json"), "{\"format\":1}\n")
            .expect("write archive manifest");
        std::fs::write(source.join("payload.txt"), "payload").expect("write archive payload");
        let archive_file = std::fs::File::create(&archive_path).expect("create archive");
        let encoder = flate2::write::GzEncoder::new(archive_file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        builder
            .append_dir_all(".", &source)
            .expect("append archive source");
        builder
            .into_inner()
            .expect("finish tar")
            .finish()
            .expect("finish gzip");

        extract_runtime_archive(&archive_path, &destination).expect("extract archive");
        assert_eq!(
            std::fs::read_to_string(destination.join("runtime-manifest.json"))
                .expect("read extracted manifest"),
            "{\"format\":1}\n"
        );
        assert_eq!(
            std::fs::read_to_string(destination.join("payload.txt")).expect("read payload"),
            "payload"
        );
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_file(&archive_path);
    }

    #[test]
    fn extracts_the_bundled_runtime_archive_manifest_and_entry() {
        let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("dsh-runtime.tar.gz");
        assert!(archive.is_file(), "bundled runtime archive is missing");
        let root = std::env::temp_dir().join(format!(
            "deeptop-bundled-runtime-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);
        extract_runtime_archive(&archive, &root).expect("extract bundled runtime archive");
        let manifest: serde_json::Value = serde_json::from_str(
            &std::fs::read_to_string(root.join("runtime-manifest.json"))
                .expect("read extracted runtime manifest"),
        )
        .expect("parse extracted runtime manifest");
        assert_eq!(
            runtime_tree_sha256(&root).expect("hash extracted runtime"),
            manifest["treeSha256"]
                .as_str()
                .expect("manifest tree digest")
        );
        assert_eq!(
            runtime_cache_validation_message(&root, &manifest),
            "",
            "extracted runtime should satisfy the cache validator"
        );
        assert!(root.join("runtime-manifest.json").is_file());
        assert!(root
            .join("node_modules/@deepseek-ai/dsh/lib/bin.js")
            .is_file());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn runtime_tree_digest_changes_when_runtime_content_changes() {
        let root =
            std::env::temp_dir().join(format!("deeptop-runtime-tree-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("nested")).expect("create digest test directory");
        std::fs::write(root.join("nested/file.js"), "one").expect("write digest test file");
        let first = runtime_tree_sha256(&root).expect("hash first tree");
        std::fs::write(root.join("nested/file.js"), "two").expect("rewrite digest test file");
        let second = runtime_tree_sha256(&root).expect("hash second tree");
        assert_ne!(first, second);
        std::fs::write(root.join("runtime-manifest.json"), "ignored").expect("write manifest");
        std::fs::write(root.join(RUNTIME_CACHE_MARKER), "ignored").expect("write marker");
        assert_eq!(
            second,
            runtime_tree_sha256(&root).expect("hash metadata tree")
        );
        std::fs::remove_dir_all(root).expect("remove digest test directory");
    }

    #[test]
    fn accepts_the_dsh_package_manifest() {
        assert!(is_dsh_package_manifest(r#"{"name":"@deepseek-ai/dsh"}"#));
    }

    #[test]
    fn accepts_only_the_pinned_bundled_runtime_manifest() {
        let manifest = serde_json::json!({
            "format": 1,
            "packageName": "@deepseek-ai/dsh",
            "packageVersion": "0.1.0-rc.8",
            "entry": "node_modules/@deepseek-ai/dsh/lib/bin.js",
            "sourceCommit": "a95eedc6034c323ece64536609174645c235f124",
            "platform": runtime_platform(),
            "arch": runtime_arch(),
            "treeSha256": "0123456789012345678901234567890123456789012345678901234567890123",
        });
        assert!(is_bundled_runtime_manifest(&manifest));
        assert!(!is_bundled_runtime_manifest(&serde_json::json!({
            "format": 1,
            "packageName": "@deepseek-ai/dsh",
            "packageVersion": "latest",
            "entry": "node_modules/@deepseek-ai/dsh/lib/bin.js",
        })));
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
        assert_eq!(
            validated_connection_url(" https://models.dev ").unwrap(),
            "https://models.dev"
        );
        assert_eq!(
            validated_connection_url(" https://example.com/docs ").unwrap(),
            "https://example.com/docs"
        );
        assert_eq!(
            validated_connection_url("http://example.com/docs").unwrap(),
            "http://example.com/docs"
        );
        assert!(validated_connection_url("javascript:alert(1)").is_err());
        assert!(validated_connection_url("file:///tmp/demo").is_err());
        assert!(validated_connection_url("https://").is_err());
        assert!(validated_connection_url("https://user@example.com").is_err());
        assert!(validated_connection_url("https://example.com/with\\slash").is_err());
    }

    #[test]
    fn validates_and_formats_tray_session_items() {
        let item = TraySessionMenuItem {
            session_id: "session-1".to_string(),
            title: "设计 & 检查\n托盘".to_string(),
            context: Some("DSH & Deeptop".to_string()),
            status: TraySessionStatus::Unread,
        };
        let snapshot = TraySessionMenuSnapshot {
            unread: vec![item.clone()],
            recent: vec![],
            more: vec![],
        };

        assert!(validate_tray_session_menu(&snapshot).is_ok());
        assert_eq!(
            tray_session_label(&item),
            "● 设计 && 检查 托盘 · DSH && Dee…"
        );
        assert_eq!(
            tray_menu_text("  多余\t空格  ", "fallback", 16),
            "多余 空格"
        );

        let long = TraySessionMenuItem {
            session_id: "session-2".to_string(),
            title: "[MODE: UNRESTRICTED] FIRST-PASS NORMALIZATION".to_string(),
            context: Some("Documents".to_string()),
            status: TraySessionStatus::Running,
        };
        let label = tray_session_label(&long);
        assert_eq!(label, "◉ [MODE: UNRESTRICT… · Documents");
        assert_eq!(label.chars().count(), 32);
    }

    #[test]
    fn rejects_duplicate_or_invalid_tray_session_ids() {
        let item = TraySessionMenuItem {
            session_id: "session-1".to_string(),
            title: "会话".to_string(),
            context: None,
            status: TraySessionStatus::Idle,
        };
        let duplicate = TraySessionMenuSnapshot {
            unread: vec![item.clone()],
            recent: vec![item],
            more: vec![],
        };
        assert!(validate_tray_session_menu(&duplicate).is_err());

        let invalid = TraySessionMenuSnapshot {
            unread: vec![TraySessionMenuItem {
                session_id: "bad\nsession".to_string(),
                title: "会话".to_string(),
                context: None,
                status: TraySessionStatus::Error,
            }],
            recent: vec![],
            more: vec![],
        };
        assert!(validate_tray_session_menu(&invalid).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn sizes_and_positions_the_themed_tray_popup_inside_the_work_area() {
        let item = TraySessionMenuItem {
            session_id: "session-1".to_string(),
            title: "会话".to_string(),
            context: None,
            status: TraySessionStatus::Idle,
        };
        let snapshot = TraySessionMenuSnapshot {
            unread: vec![item.clone()],
            recent: vec![item.clone()],
            more: vec![item],
        };

        assert_eq!(tray_popup_height(&TraySessionMenuSnapshot::default()), 129);
        assert_eq!(tray_popup_height(&snapshot), 281);
        assert_eq!(
            tray_popup_position(1880.0, 1040.0, 32, 32, 320, 400, 0, 0, 1920, 1040),
            tauri::PhysicalPosition::new(1592, 632)
        );
        assert_eq!(
            tray_popup_position(100.0, 0.0, 32, 32, 320, 400, 0, 32, 1920, 1008),
            tauri::PhysicalPosition::new(8, 40)
        );
    }
}

fn main() {
    let args = env::args().collect::<Vec<_>>();
    let prepare_runtime = args
        .iter()
        .any(|argument| argument == "--prepare-bundled-runtime");
    let mut builder = tauri::Builder::default();
    if !prepare_runtime {
        // This plugin must be registered first so a second launch is forwarded
        // before any runtime or window setup can create another instance.
        builder = builder.plugin(tauri_plugin_single_instance::init(move |app, args, cwd| {
            focus_main_window(app);
            let source = external_launch::source_for_args(&args);
            if let Some(request) = external_launch::parse(&args, Path::new(&cwd), source) {
                let runtime = app.state::<BridgeManager>().inner().clone();
                publish_external_launch(app, &runtime, request);
            } else {
                let _ = app.emit("single-instance", json!({ "args": args, "cwd": cwd }));
            }
        }));
    }
    builder = builder
        .manage(BridgeManager::default())
        .manage(TrayMenuState::default())
        .manage(about::UpdateCheckManager::default())
        .manage(terminal::TerminalManager::default())
        .setup(move |app| {
            if prepare_runtime {
                let exit_code = match materialize_bundled_runtime(app.handle()) {
                    Ok(cache) => {
                        println!("内嵌 DSH 运行时已准备：{}", cache.display());
                        0
                    }
                    Err(error) => {
                        eprintln!("内嵌 DSH 运行时准备失败：{error}");
                        1
                    }
                };
                app.handle().exit(exit_code);
            } else {
                setup_tray(app.handle()).map_err(|error| format!("创建系统托盘失败：{error}"))?;
                install_window_behavior_handlers(app.handle())?;
                let runtime = app.state::<BridgeManager>().inner().clone();
                runtime.start(app.handle().clone());
                let cwd = env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
                let source = external_launch::source_for_args(&args);
                if let Some(request) = external_launch::parse(&args, &cwd, source) {
                    publish_external_launch(app.handle(), &runtime, request);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dsh,
            terminate_dsh_processes,
            get_dock_position,
            set_dock_position,
            reset_dock_position,
            get_dock_settings,
            set_dock_settings,
            get_windows_context_menu_status,
            set_windows_context_menu_enabled,
            get_window_behavior_settings,
            set_window_behavior_settings,
            resolve_window_close,
            list_pending_window_close,
            cancel_window_close,
            about::check_for_updates,
            about::cancel_update_check,
            about::download_update,
            about::cancel_update_download,
            about::launch_update_installer,
            about::open_project_url,
            open_connection_url,
            refresh_dsh,
            open_nodejs_download,
            list_pending_open_sessions,
            list_pending_external_launches,
            acknowledge_pending_external_launch,
            acknowledge_pending_open_session,
            update_tray_session_menu,
            get_tray_popup_snapshot,
            open_tray_popup_session,
            run_tray_popup_action,
            dismiss_tray_popup,
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
            git_file_diff,
            git_stage_paths,
            git_unstage_paths,
            git_discard_paths,
            git_stage_all,
            git_unstage_all,
            git_commit,
            git_log,
            git_graph,
            git_commit_detail,
            git_branches,
            git_checkout_branch,
            git_create_branch,
            git_delete_branch,
            git_pull,
            git_push,
            open_in_vscode,
            write_clipboard,
            reveal_in_explorer,
            is_file_path,
            delete_workspace_path,
            create_workspace_folder,
            ensure_theme_files,
            read_theme_css,
            pick_theme_css,
            pick_plugin_entry,
            open_themes_directory,
        ]);
    let mut context = tauri::generate_context!();
    if prepare_runtime {
        for window in &mut context.config_mut().app.windows {
            window.create = false;
        }
    }
    builder.run(context).expect("启动 Deeptop 失败");
}
