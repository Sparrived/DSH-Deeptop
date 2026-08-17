use std::{
    env,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOption {
    pub id: String,
    pub name: String,
    pub description: String,
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
fn windows_terminal_executable(name: &str) -> Option<PathBuf> {
    executable_from_path(name)
        .or_else(|| {
            env::var_os("SystemRoot")
                .map(PathBuf::from)
                .map(|root| root.join("System32").join(name))
                .filter(|path| path.is_file())
        })
        .or_else(|| {
            (name == "wt.exe")
                .then(|| {
                    env::var_os("LOCALAPPDATA")
                        .map(PathBuf::from)
                        .map(|root| root.join("Microsoft/WindowsApps/wt.exe"))
                        .filter(|path| path.is_file())
                })
                .flatten()
        })
}

#[cfg(windows)]
fn available_terminals() -> Vec<TerminalOption> {
    let mut terminals = Vec::new();
    if windows_terminal_executable("wt.exe").is_some() {
        terminals.push(terminal_option(
            "windows-terminal",
            "Windows Terminal",
            "Windows 的多标签终端",
        ));
    }
    if windows_terminal_executable("pwsh.exe").is_some() {
        terminals.push(terminal_option(
            "powershell",
            "PowerShell 7",
            "跨平台 PowerShell",
        ));
    } else if windows_terminal_executable("powershell.exe").is_some() {
        terminals.push(terminal_option(
            "powershell",
            "Windows PowerShell",
            "系统自带 PowerShell",
        ));
    }
    if windows_terminal_executable("cmd.exe").is_some() {
        terminals.push(terminal_option(
            "command-prompt",
            "命令提示符",
            "Windows 命令提示符",
        ));
    }
    terminals
}

#[cfg(target_os = "macos")]
fn mac_application_exists(name: &str) -> bool {
    [
        PathBuf::from(format!("/Applications/{name}.app")),
        PathBuf::from(format!("/System/Applications/{name}.app")),
        env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(format!("Applications/{name}.app")))
            .unwrap_or_default(),
    ]
    .iter()
    .any(|path| path.is_dir())
}

#[cfg(target_os = "macos")]
fn available_terminals() -> Vec<TerminalOption> {
    let mut terminals = Vec::new();
    if mac_application_exists("Terminal") {
        terminals.push(terminal_option("terminal", "Terminal", "macOS 系统终端"));
    }
    if mac_application_exists("iTerm") || mac_application_exists("iTerm2") {
        terminals.push(terminal_option("iterm", "iTerm2", "可定制的 macOS 终端"));
    }
    for (id, name, description) in [
        ("kitty", "kitty", "GPU 加速终端"),
        ("alacritty", "Alacritty", "轻量 GPU 加速终端"),
        ("wezterm", "WezTerm", "跨平台终端"),
    ] {
        if executable_from_path(id).is_some() {
            terminals.push(terminal_option(id, name, description));
        }
    }
    terminals
}

#[cfg(all(unix, not(target_os = "macos")))]
fn available_terminals() -> Vec<TerminalOption> {
    let mut terminals = Vec::new();
    if executable_from_path("x-terminal-emulator").is_some() {
        terminals.push(terminal_option(
            "system-default",
            "系统默认终端",
            "由 Linux 的终端替代器决定",
        ));
    }
    for (id, name, description) in [
        ("gnome-terminal", "GNOME Terminal", "GNOME 桌面终端"),
        ("konsole", "Konsole", "KDE 桌面终端"),
        ("xfce4-terminal", "Xfce Terminal", "Xfce 桌面终端"),
        ("kitty", "kitty", "GPU 加速终端"),
        ("alacritty", "Alacritty", "轻量 GPU 加速终端"),
        ("wezterm", "WezTerm", "跨平台终端"),
        ("foot", "foot", "Wayland 终端"),
        ("xterm", "xterm", "经典 X11 终端"),
    ] {
        if executable_from_path(id).is_some() {
            terminals.push(terminal_option(id, name, description));
        }
    }
    terminals
}

#[cfg(not(any(windows, unix)))]
fn available_terminals() -> Vec<TerminalOption> {
    Vec::new()
}

#[cfg(windows)]
fn launch_terminal(directory: &Path, terminal_id: &str) -> Result<(), String> {
    let executable = match terminal_id {
        "windows-terminal" => windows_terminal_executable("wt.exe")
            .ok_or_else(|| "Windows Terminal 当前不可用".to_string())?,
        "powershell" => windows_terminal_executable("pwsh.exe")
            .or_else(|| windows_terminal_executable("powershell.exe"))
            .ok_or_else(|| "PowerShell 当前不可用".to_string())?,
        "command-prompt" => windows_terminal_executable("cmd.exe")
            .ok_or_else(|| "命令提示符当前不可用".to_string())?,
        _ => return Err("未识别的终端选项".to_string()),
    };
    let mut command = Command::new(executable);
    command.current_dir(directory);
    match terminal_id {
        "windows-terminal" => {
            command.args(["-d", directory.to_string_lossy().as_ref()]);
        }
        "powershell" => {
            command.args(["-NoLogo", "-NoExit"]);
        }
        "command-prompt" => {
            command.arg("/K");
        }
        _ => unreachable!(),
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动终端失败：{error}"))
}

#[cfg(target_os = "macos")]
fn apple_script_string(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\r', '\n'], " ")
}

#[cfg(target_os = "macos")]
fn shell_quote(value: &str) -> String {
    let mut quoted = String::from("'");
    for character in value.chars() {
        if character == '\'' {
            quoted.push_str("'\\''");
        } else {
            quoted.push(character);
        }
    }
    quoted.push('\'');
    quoted
}

#[cfg(target_os = "macos")]
fn launch_terminal(directory: &Path, terminal_id: &str) -> Result<(), String> {
    let shell_command = format!(
        "cd -- {} && exec $SHELL -l",
        shell_quote(&directory.to_string_lossy())
    );
    let mut command = match terminal_id {
        "terminal" => {
            let script = format!(
                "tell application \"Terminal\" to do script \"{}\"",
                apple_script_string(&shell_command)
            );
            let mut command = Command::new("osascript");
            command.args(["-e", &script]);
            command
        }
        "iterm" => {
            let script = format!(
                "tell application \"iTerm2\" to create window with default profile command \"{}\"",
                apple_script_string(&shell_command)
            );
            let mut command = Command::new("osascript");
            command.args(["-e", &script]);
            command
        }
        "kitty" => {
            let mut command = Command::new("kitty");
            command.args(["--directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "alacritty" => {
            let mut command = Command::new("alacritty");
            command.args(["--working-directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "wezterm" => {
            let mut command = Command::new("wezterm");
            command.args(["start", "--cwd", directory.to_string_lossy().as_ref()]);
            command
        }
        _ => return Err("未识别的终端选项".to_string()),
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动终端失败：{error}"))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch_terminal(directory: &Path, terminal_id: &str) -> Result<(), String> {
    let mut command = match terminal_id {
        "system-default" => {
            let mut command = Command::new("x-terminal-emulator");
            command.current_dir(directory);
            command
        }
        "gnome-terminal" => {
            let mut command = Command::new("gnome-terminal");
            command.args(["--working-directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "konsole" => {
            let mut command = Command::new("konsole");
            command.args(["--workdir", directory.to_string_lossy().as_ref()]);
            command
        }
        "xfce4-terminal" => {
            let mut command = Command::new("xfce4-terminal");
            command.args(["--working-directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "kitty" => {
            let mut command = Command::new("kitty");
            command.args(["--directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "alacritty" => {
            let mut command = Command::new("alacritty");
            command.args(["--working-directory", directory.to_string_lossy().as_ref()]);
            command
        }
        "wezterm" => {
            let mut command = Command::new("wezterm");
            command.args(["start", "--cwd", directory.to_string_lossy().as_ref()]);
            command
        }
        "foot" => {
            let mut command = Command::new("foot");
            command.current_dir(directory);
            command
        }
        "xterm" => {
            let mut command = Command::new("xterm");
            command.current_dir(directory);
            command
        }
        _ => return Err("未识别的终端选项".to_string()),
    };
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("启动终端失败：{error}"))
}

#[cfg(not(any(windows, unix)))]
fn launch_terminal(_directory: &Path, _terminal_id: &str) -> Result<(), String> {
    Err("当前系统暂不支持启动终端".to_string())
}

/// 返回当前系统检测到的终端，列表顺序即为默认终端优先级。
#[tauri::command]
pub fn list_terminals() -> Vec<TerminalOption> {
    available_terminals()
}

/// 在指定工作区启动所选终端；终端进程独立于 Deeptop 生命周期运行。
#[tauri::command]
pub fn open_terminal(workspace: String, terminal_id: String) -> Result<(), String> {
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
    launch_terminal(&directory, &terminal_id)
}

#[cfg(test)]
mod tests {
    use super::{terminal_option, TerminalOption};

    #[test]
    fn terminal_options_have_stable_metadata() {
        let option = terminal_option("terminal", "Terminal", "系统终端");
        assert_eq!(option.id, "terminal");
        assert_eq!(option.name, "Terminal");
        assert_eq!(option.description, "系统终端");
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
}
