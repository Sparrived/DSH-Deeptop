use std::{
    env,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use portable_pty::{native_pty_system, Child as PtyChild, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const TERMINAL_OUTPUT_EVENT: &str = "terminal-output";
const MAX_TERMINAL_INPUT_BYTES: usize = 64 * 1024;
const INITIAL_TERMINAL_COLS: u16 = 120;
const INITIAL_TERMINAL_ROWS: u16 = 32;
const MAX_TERMINAL_COLS: u16 = 500;
const MAX_TERMINAL_ROWS: u16 = 200;
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

type PtyChildHandle = Box<dyn PtyChild + Send + Sync>;
type PtyMasterHandle = Box<dyn MasterPty + Send>;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOption {
    pub id: String,
    pub name: String,
    pub description: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub session_id: String,
    pub terminal_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutput {
    pub session_id: String,
    pub stream: String,
    pub text: String,
    pub exited: bool,
    pub exit_code: Option<i32>,
}

struct TerminalSession {
    id: String,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Arc<Mutex<PtyMasterHandle>>,
    child: Arc<Mutex<PtyChildHandle>>,
}

#[derive(Clone, Default)]
pub struct TerminalManager {
    session: Arc<Mutex<Option<TerminalSession>>>,
}

fn terminal_option(id: &str, name: &str, description: &str) -> TerminalOption {
    TerminalOption {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
    }
}

fn executable_from_path(name: &str) -> Option<PathBuf> {
    env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| env::split_paths(&paths).collect::<Vec<_>>())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
}

#[cfg(windows)]
fn windows_shell_executable(name: &str) -> Option<PathBuf> {
    executable_from_path(name).or_else(|| {
        env::var_os("SystemRoot")
            .map(PathBuf::from)
            .map(|root| root.join("System32").join(name))
            .filter(|path| path.is_file())
    })
}

#[cfg(unix)]
fn unix_shell_executable(name: &str) -> Option<PathBuf> {
    [
        PathBuf::from(format!("/bin/{name}")),
        PathBuf::from(format!("/usr/bin/{name}")),
        PathBuf::from(format!("/usr/local/bin/{name}")),
    ]
    .into_iter()
    .find(|path| path.is_file())
    .or_else(|| executable_from_path(name))
}

#[cfg(windows)]
fn available_terminals() -> Vec<TerminalOption> {
    let mut terminals = Vec::new();
    if windows_shell_executable("pwsh.exe").is_some() {
        terminals.push(terminal_option(
            "pwsh",
            "PowerShell 7",
            "原生 PTY PowerShell 7 会话",
        ));
    }
    if windows_shell_executable("powershell.exe").is_some() {
        terminals.push(terminal_option(
            "powershell",
            "Windows PowerShell",
            "原生 PTY 系统 PowerShell 会话",
        ));
    }
    if windows_shell_executable("cmd.exe").is_some() {
        terminals.push(terminal_option(
            "command-prompt",
            "命令提示符",
            "原生 ConPTY 命令行会话",
        ));
    }
    terminals
}

#[cfg(unix)]
fn available_terminals() -> Vec<TerminalOption> {
    let definitions = [
        ("zsh", "zsh", "原生 PTY 交互式 zsh 会话"),
        ("bash", "bash", "原生 PTY 交互式 bash 会话"),
        ("fish", "fish", "原生 PTY 交互式 fish 会话"),
        ("sh", "sh", "原生 PTY 兼容性 shell 会话"),
    ];
    let preferred = env::var("SHELL")
        .ok()
        .and_then(|value| Path::new(&value).file_stem()?.to_str().map(str::to_owned));
    let mut ordered = Vec::new();
    if let Some(preferred) = preferred {
        if definitions.iter().any(|(id, _, _)| *id == preferred) {
            ordered.push(preferred);
        }
    }
    definitions.iter().for_each(|(id, _, _)| {
        if !ordered.iter().any(|current| current == id) {
            ordered.push((*id).to_string());
        }
    });
    ordered
        .into_iter()
        .filter_map(|id| {
            unix_shell_executable(&id)?;
            let (_, name, description) = definitions
                .iter()
                .find(|(candidate, _, _)| *candidate == id)?;
            Some(terminal_option(&id, name, description))
        })
        .collect()
}

#[cfg(not(any(windows, unix)))]
fn available_terminals() -> Vec<TerminalOption> {
    Vec::new()
}

#[cfg(windows)]
fn shell_command(directory: &Path, terminal_id: &str) -> Result<CommandBuilder, String> {
    let (executable, args) = match terminal_id {
        "pwsh" => (
            windows_shell_executable("pwsh.exe"),
            vec!["-NoLogo", "-NoProfile", "-NoExit"],
        ),
        "powershell" => (
            windows_shell_executable("powershell.exe"),
            vec!["-NoLogo", "-NoProfile", "-NoExit"],
        ),
        "command-prompt" => (windows_shell_executable("cmd.exe"), vec!["/K"]),
        _ => (None, Vec::new()),
    };
    let executable = executable.ok_or_else(|| "所选终端当前不可用，请刷新终端列表".to_string())?;
    let mut command = CommandBuilder::new(executable);
    command.args(args);
    command.cwd(directory);
    Ok(command)
}

#[cfg(unix)]
fn shell_command(directory: &Path, terminal_id: &str) -> Result<CommandBuilder, String> {
    let executable = unix_shell_executable(terminal_id)
        .ok_or_else(|| "所选终端当前不可用，请刷新终端列表".to_string())?;
    let mut command = CommandBuilder::new(executable);
    match terminal_id {
        "zsh" => command.args(["-l", "-i"]),
        "bash" => command.args(["--login", "--interactive"]),
        "fish" => command.arg("-i"),
        "sh" => command.arg("-i"),
        _ => return Err("未识别的终端选项".to_string()),
    }
    command.cwd(directory);
    Ok(command)
}

#[cfg(not(any(windows, unix)))]
fn shell_command(_directory: &Path, _terminal_id: &str) -> Result<CommandBuilder, String> {
    Err("当前系统暂不支持内嵌终端".to_string())
}

fn configure_shell_process(command: &mut CommandBuilder) {
    command.env("TERM_PROGRAM", "Deeptop");
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
}

fn emit_output(app: &AppHandle, session_id: &str, text: String) {
    let _ = app.emit(
        TERMINAL_OUTPUT_EVENT,
        TerminalOutput {
            session_id: session_id.to_string(),
            stream: "pty".to_string(),
            text,
            exited: false,
            exit_code: None,
        },
    );
}

fn read_stream<R: Read + Send + 'static>(app: AppHandle, session_id: String, mut reader: R) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => emit_output(
                    &app,
                    &session_id,
                    String::from_utf8_lossy(&buffer[..size]).into_owned(),
                ),
                Err(_) => break,
            }
        }
    });
}

fn terminal_size(cols: u16, rows: u16) -> PtySize {
    PtySize {
        cols: cols.clamp(1, MAX_TERMINAL_COLS),
        rows: rows.clamp(1, MAX_TERMINAL_ROWS),
        pixel_width: 0,
        pixel_height: 0,
    }
}

impl TerminalManager {
    fn stop_current(&self) {
        let current = self
            .session
            .lock()
            .ok()
            .and_then(|mut session| session.take());
        if let Some(session) = current {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    fn start(
        &self,
        app: AppHandle,
        workspace: String,
        terminal_id: String,
    ) -> Result<TerminalSessionInfo, String> {
        let trimmed = workspace.trim();
        if trimmed.is_empty() {
            return Err("请先选择一个工作区".to_string());
        }
        let directory = PathBuf::from(trimmed);
        if !directory.is_dir() {
            return Err(format!("工作区目录不存在：{trimmed}"));
        }
        if !available_terminals()
            .iter()
            .any(|terminal| terminal.id == terminal_id)
        {
            return Err("所选终端当前不可用，请刷新终端列表".to_string());
        }

        self.stop_current();
        let mut command = shell_command(&directory, &terminal_id)?;
        configure_shell_process(&mut command);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(terminal_size(INITIAL_TERMINAL_COLS, INITIAL_TERMINAL_ROWS))
            .map_err(|error| format!("创建终端 PTY 失败：{error}"))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("启动内嵌终端失败：{error}"))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("读取终端 PTY 失败：{error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("打开终端输入失败：{error}"))?;
        let master: PtyMasterHandle = pair.master;
        let session_id = format!(
            "terminal-{}",
            NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed)
        );
        let writer = Arc::new(Mutex::new(writer));
        let master = Arc::new(Mutex::new(master));
        let child = Arc::new(Mutex::new(child));
        if let Ok(mut current) = self.session.lock() {
            *current = Some(TerminalSession {
                id: session_id.clone(),
                writer: Arc::clone(&writer),
                master: Arc::clone(&master),
                child: Arc::clone(&child),
            });
        }

        let manager = self.clone();
        let monitor_app = app.clone();
        let monitor_id = session_id.clone();
        thread::spawn(move || {
            let status = loop {
                let result = child
                    .lock()
                    .ok()
                    .and_then(|mut child| child.try_wait().ok().flatten());
                if result.is_some() {
                    break result;
                }
                thread::sleep(Duration::from_millis(80));
            };
            let _ = monitor_app.emit(
                TERMINAL_OUTPUT_EVENT,
                TerminalOutput {
                    session_id: monitor_id.clone(),
                    stream: "system".to_string(),
                    text: String::new(),
                    exited: true,
                    exit_code: status.map(|status| status.exit_code() as i32),
                },
            );
            if let Ok(mut current) = manager.session.lock() {
                if current.as_ref().map(|session| session.id.as_str()) == Some(monitor_id.as_str())
                {
                    *current = None;
                }
            }
        });
        read_stream(app, session_id.clone(), reader);
        Ok(TerminalSessionInfo {
            session_id,
            terminal_id,
        })
    }

    fn write(&self, session_id: &str, input: &str) -> Result<(), String> {
        if input.len() > MAX_TERMINAL_INPUT_BYTES {
            return Err("终端输入过长，请分段发送".to_string());
        }
        let writer = self
            .session
            .lock()
            .ok()
            .and_then(|current| {
                current
                    .as_ref()
                    .filter(|session| session.id == session_id)
                    .map(|session| Arc::clone(&session.writer))
            })
            .ok_or_else(|| "内嵌终端会话已结束".to_string())?;
        let mut writer = writer
            .lock()
            .map_err(|_| "内嵌终端输入流不可用".to_string())?;
        writer
            .write_all(input.as_bytes())
            .map_err(|error| format!("写入终端失败：{error}"))?;
        writer
            .flush()
            .map_err(|error| format!("刷新终端输入失败：{error}"))
    }

    fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let master = self
            .session
            .lock()
            .ok()
            .and_then(|current| {
                current
                    .as_ref()
                    .filter(|session| session.id == session_id)
                    .map(|session| Arc::clone(&session.master))
            })
            .ok_or_else(|| "内嵌终端会话已结束".to_string())?;
        let result = master
            .lock()
            .map_err(|_| "终端窗口不可用".to_string())?
            .resize(terminal_size(cols, rows))
            .map_err(|error| format!("调整终端大小失败：{error}"));
        result
    }

    fn close(&self, session_id: &str) {
        let current = self.session.lock().ok().and_then(|mut session| {
            if session.as_ref().map(|current| current.id.as_str()) == Some(session_id) {
                session.take()
            } else {
                None
            }
        });
        if let Some(session) = current {
            if let Ok(mut child) = session.child.lock() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

#[tauri::command]
pub fn list_terminals() -> Vec<TerminalOption> {
    available_terminals()
}

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    manager: State<'_, TerminalManager>,
    workspace: String,
    terminal_id: String,
) -> Result<TerminalSessionInfo, String> {
    manager.start(app, workspace, terminal_id)
}

#[tauri::command]
pub fn write_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    manager.write(&session_id, &input)
}

#[tauri::command]
pub fn resize_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    manager.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn close_terminal(
    manager: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    manager.close(&session_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        terminal_option, terminal_size, TerminalOption, MAX_TERMINAL_COLS, MAX_TERMINAL_ROWS,
    };

    #[test]
    fn terminal_options_have_stable_metadata() {
        let option = terminal_option("bash", "bash", "原生 PTY 交互式 bash 会话");
        assert_eq!(option.id, "bash");
        assert_eq!(option.name, "bash");
        assert_eq!(option.description, "原生 PTY 交互式 bash 会话");
    }

    #[test]
    fn terminal_option_is_serializable() {
        let option = TerminalOption {
            id: "system-default".to_string(),
            name: "系统默认终端".to_string(),
            description: "跟随系统设置".to_string(),
        };
        let value = serde_json::to_value(option).expect("terminal option should serialize");
        assert_eq!(value["id"], "system-default");
        assert_eq!(value["name"], "系统默认终端");
    }

    #[test]
    fn terminal_size_is_clamped_to_safe_bounds() {
        assert_eq!(terminal_size(0, 0).cols, 1);
        assert_eq!(terminal_size(u16::MAX, u16::MAX).cols, MAX_TERMINAL_COLS);
        assert_eq!(terminal_size(u16::MAX, u16::MAX).rows, MAX_TERMINAL_ROWS);
    }
}
