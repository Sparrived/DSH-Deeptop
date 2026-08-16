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
}

const DSH_PROFILE: &str = "desktop";
const DSH_PACKAGE: &str = "@deepseek-ai/dsh@latest";
const NODEJS_DOWNLOAD_URL: &str = "https://nodejs.org/en/download";
const BRIDGE_TIMEOUT: Duration = Duration::from_secs(45);
const DSH_INSTALL_TIMEOUT: Duration = Duration::from_secs(300);
const DSH_PACKAGE_JSON: &str = "{\n  \"name\": \"deeptop-dsh\",\n  \"private\": true\n}\n";
const BRIDGE_PACKAGE_JSON: &str = include_str!("../../deeptop-bridge/package.json");
const BRIDGE_PATCH: &str = include_str!("../../deeptop-bridge/cordis.patch.yml");
const BRIDGE_ENTRY: &str = include_str!("../../deeptop-bridge/index.mjs");
const BRIDGE_RUNTIME: &str = include_str!("../../deeptop-bridge/bridge.mjs");
const BRIDGE_ROUTES: &str = include_str!("../../deeptop-bridge/routes.mjs");
const BRIDGE_MESSAGE_ANNOTATIONS: &str =
    include_str!("../../deeptop-bridge/message-annotations.mjs");
const BRIDGE_SKILL_INSTALLER: &str = include_str!("../../deeptop-bridge/skill-installer.mjs");
const BRIDGE_SKILL_INSTALL_PLUGIN: &str =
    include_str!("../../deeptop-bridge/skill-install-plugin.mjs");
const PROFILE_TEMPLATE: &str = include_str!("../../deeptop-bridge/desktop-profile.json");
const PROFILE_PATCH_TEMPLATE: &str = include_str!("../../deeptop-bridge/profile.patch.yml");
const PROFILE_PNPM_WORKSPACE: &str =
    "packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n";
const MAX_PENDING_OPEN_SESSIONS: usize = 16;
const DSH_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(8);

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
        }
    }
}

#[derive(Clone, Default)]
struct BridgeManager {
    state: Arc<Mutex<BridgeState>>,
    next_request_id: Arc<AtomicU64>,
    pending_open_sessions: Arc<Mutex<VecDeque<String>>>,
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
        if !self.is_current(generation) {
            return;
        }
        let text = text.into();
        let _ = app.emit(
            "dsh-runtime-log",
            DshRuntimeLog {
                phase: phase.to_string(),
                stream: stream.to_string(),
                text: text.clone(),
            },
        );
        if stream == "diagnostic" || stream == "stderr" {
            let _ = app.emit("dsh-diagnostic", text);
        }
    }

    fn emit_diagnostic(&self, app: &AppHandle, generation: u64, message: String) {
        self.emit_runtime_log(app, generation, "runtime", "diagnostic", message);
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
        let changed = self
            .state
            .lock()
            .map(|mut state| {
                if state.generation != generation || state.pid != Some(pid) {
                    return false;
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
                true
            })
            .unwrap_or(false);
        if changed {
            self.emit_status(app);
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

#[cfg(test)]
mod tests {
    use super::is_dsh_package_manifest;

    #[test]
    fn accepts_the_dsh_package_manifest() {
        assert!(is_dsh_package_manifest(r#"{"name":"@deepseek-ai/dsh"}"#));
    }

    #[test]
    fn rejects_missing_or_invalid_dsh_package_manifests() {
        assert!(!is_dsh_package_manifest(r#"{"name":"other-package"}"#));
        assert!(!is_dsh_package_manifest("not json"));
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
        .setup(|app| {
            let runtime = app.state::<BridgeManager>().inner().clone();
            runtime.start(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            check_dsh,
            refresh_dsh,
            open_nodejs_download,
            list_pending_open_sessions,
            acknowledge_pending_open_session,
            send_system_notification,
            bridge_request,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Deeptop 失败");
}
