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
    time::{Duration, Instant},
};

use notify_rust::{Notification as DesktopNotification, NotificationResponse};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State};

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
        .env("NPM_CONFIG_UPDATE_NOTIFIER", "false");
    #[cfg(windows)]
    configure_hidden_process(&mut command);
    #[cfg(unix)]
    configure_process_group(&mut command);
    Ok(command)
}

fn run_command_with_timeout(mut command: Command, timeout: Duration) -> Result<Output, String> {
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
    let (output_sender, output_receiver) = mpsc::channel();
    let stdout_sender = output_sender.clone();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stdout).read_to_end(&mut bytes);
        let _ = stdout_sender.send((true, bytes));
    });
    let stderr_sender = output_sender.clone();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = BufReader::new(stderr).read_to_end(&mut bytes);
        let _ = stderr_sender.send((false, bytes));
    });
    drop(output_sender);
    let deadline = Instant::now() + timeout;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
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
        match output_receiver.recv_timeout(Duration::from_millis(250)) {
            Ok((is_stdout, bytes)) => {
                if is_stdout {
                    stdout = bytes;
                } else {
                    stderr = bytes;
                }
                streams_received += 1;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn verify_dsh_with_npm() -> Result<(), String> {
    let home = dsh_home();
    let prefix = home.to_string_lossy().into_owned();
    let mut command = npm_command()?;
    command
        .args([
            "exec",
            "--prefix",
            &prefix,
            "--offline",
            "--package=@deepseek-ai/dsh",
            "--",
            "dsh",
            "--version",
        ])
        .current_dir(&home);
    let output = run_command_with_timeout(command, Duration::from_secs(30))?;
    if output.status.success() {
        Ok(())
    } else {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Err(if detail.is_empty() {
            format!(
                "npm 无法验证 DSH（退出码 {}）",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!("npm 无法验证 DSH：{detail}")
        })
    }
}

fn install_dsh(manager: &BridgeManager, app: &AppHandle, generation: u64) -> Result<(), String> {
    let home = dsh_home();
    fs::create_dir_all(&home).map_err(|error| format!("无法创建 DSH 目录：{error}"))?;
    write_if_missing(&home.join("package.json"), DSH_PACKAGE_JSON)?;
    let prefix = home.to_string_lossy().into_owned();
    let mut command = npm_command()?;
    let command_label = format!(
        "npm install --prefix {} --no-audit --no-fund {}",
        prefix, DSH_PACKAGE
    );
    manager.emit_runtime_log(app, generation, "install", "command", command_label);
    command
        .args([
            "install",
            "--prefix",
            &prefix,
            "--no-audit",
            "--no-fund",
            "--no-update-notifier",
            "--force",
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
        for line in BufReader::new(stdout).lines().flatten() {
            let _ = stdout_sender.send(("stdout".to_string(), line));
        }
    });
    let stderr_sender = line_sender.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().flatten() {
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
    verify_dsh_with_npm().map_err(|error| format!("DSH 安装校验失败：{error}"))
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
        DshStatus {
            dsh_home: dsh_home().to_string_lossy().into_owned(),
            runtime_directory: dsh_home().to_string_lossy().into_owned(),
            package_name: DSH_PACKAGE.to_string(),
            runtime_available,
            runtime_starting,
            installing,
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
        let result = (|| -> Result<(), String> {
            materialize_desktop_profile()?;
            node_executable()?;
            npm_executable()?;
            if verify_dsh_with_npm().is_err() {
                let changed = self
                    .state
                    .lock()
                    .map(|mut state| {
                        if state.generation != generation {
                            return false;
                        }
                        state.phase = RuntimePhase::Installing;
                        state.message = "未检测到可用的 DSH，正在通过 npm 安装...".to_string();
                        true
                    })
                    .unwrap_or(false);
                if changed {
                    self.emit_status(&app);
                }
                install_dsh(self, &app, generation)?;
            }
            if !self.is_current(generation) {
                return Err("DSH 启动已取消".to_string());
            }
            if let Ok(mut state) = self.state.lock() {
                state.package_available = true;
            }
            Ok(())
        })();

        if let Err(message) = result {
            self.fail_start(&app, generation, message);
            return;
        }
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
        self.launch(app, generation);
    }

    fn launch(&self, app: AppHandle, generation: u64) {
        let result = (|| -> Result<_, String> {
            let home = dsh_home();
            let prefix = home.to_string_lossy().into_owned();
            let mut command = npm_command()?;
            let command_label = format!(
                "npm exec --prefix {} -- dsh --profile {DSH_PROFILE}",
                prefix
            );
            self.emit_runtime_log(&app, generation, "start", "command", command_label);
            command
                .args([
                    "exec",
                    "--prefix",
                    &prefix,
                    "--offline",
                    "--package=@deepseek-ai/dsh",
                    "--",
                    "dsh",
                    "--profile",
                    DSH_PROFILE,
                ])
                .current_dir(&home)
                .env("DSH_HOME", home)
                .env_remove("DSH_CWD")
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
            for line in BufReader::new(stdout).lines() {
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
            for line in BufReader::new(stderr).lines() {
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
