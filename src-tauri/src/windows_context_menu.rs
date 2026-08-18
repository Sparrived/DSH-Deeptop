use serde::Serialize;

const MENU_LABEL: &str = "使用 Deeptop 启动";
const MENU_KEY: &str = "Deeptop.Open";
const MANAGED_VALUE: &str = "DeeptopManaged";
const COMMAND_VALUE: &str = "DeeptopCommand";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextMenuStatus {
    pub supported: bool,
    pub enabled: bool,
    pub managed: bool,
    pub message: String,
}

#[cfg(windows)]
mod platform {
    use super::{ContextMenuStatus, COMMAND_VALUE, MANAGED_VALUE, MENU_KEY, MENU_LABEL};
    use crate::external_launch::{CONTEXT_MENU_DIRECTORY_MARKER, CONTEXT_MENU_FILE_MARKER};
    use std::{io, path::PathBuf};
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_WRITE},
        RegKey,
    };

    const ENTRY_PATHS: [(&str, &str, &str); 3] = [
        (
            r"Software\Classes\*\shell\Deeptop.Open",
            "%1",
            CONTEXT_MENU_FILE_MARKER,
        ),
        (
            r"Software\Classes\Directory\shell\Deeptop.Open",
            "%1",
            CONTEXT_MENU_DIRECTORY_MARKER,
        ),
        (
            r"Software\Classes\Directory\Background\shell\Deeptop.Open",
            "%V",
            CONTEXT_MENU_DIRECTORY_MARKER,
        ),
    ];

    #[derive(Clone, Debug)]
    struct EntrySnapshot {
        path: &'static str,
        existed: bool,
        label: Option<String>,
        icon: Option<String>,
        managed: Option<String>,
        registered_command: Option<String>,
        command: Option<String>,
    }

    fn is_not_found(error: &io::Error) -> bool {
        error.kind() == io::ErrorKind::NotFound
    }

    fn read_value(key: &RegKey, name: &str) -> Option<String> {
        key.get_value(name).ok()
    }

    fn open_entry(path: &str) -> io::Result<RegKey> {
        RegKey::predef(HKEY_CURRENT_USER).open_subkey(path)
    }

    fn snapshot_entry(path: &'static str) -> Result<EntrySnapshot, String> {
        let key = match open_entry(path) {
            Ok(key) => key,
            Err(error) if is_not_found(&error) => {
                return Ok(EntrySnapshot {
                    path,
                    existed: false,
                    label: None,
                    icon: None,
                    managed: None,
                    registered_command: None,
                    command: None,
                });
            }
            Err(error) => return Err(format!("读取右键菜单注册项失败：{error}")),
        };
        let managed = read_value(&key, MANAGED_VALUE);
        let command = key
            .open_subkey("command")
            .ok()
            .and_then(|command_key| read_value(&command_key, ""));
        Ok(EntrySnapshot {
            path,
            existed: true,
            label: read_value(&key, ""),
            icon: read_value(&key, "Icon"),
            managed,
            registered_command: read_value(&key, COMMAND_VALUE),
            command,
        })
    }

    fn split_parent(path: &str) -> (&str, &str) {
        path.rsplit_once('\\').unwrap_or(("", path))
    }

    fn delete_value_if_present(key: &RegKey, name: &str) {
        let _ = key.delete_value(name);
    }

    fn restore_value(key: &RegKey, name: &str, value: &Option<String>) -> io::Result<()> {
        match value {
            Some(value) => key.set_value(name, value),
            None => {
                delete_value_if_present(key, name);
                Ok(())
            }
        }
    }

    fn delete_entry(path: &str) -> io::Result<()> {
        let (parent_path, leaf) = split_parent(path);
        let parent = match RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey_with_flags(parent_path, KEY_WRITE)
        {
            Ok(parent) => parent,
            Err(error) if is_not_found(&error) => return Ok(()),
            Err(error) => return Err(error),
        };
        match parent.delete_subkey_all(leaf) {
            Ok(()) => Ok(()),
            Err(error) if is_not_found(&error) => Ok(()),
            Err(error) => Err(error),
        }
    }

    fn restore_entry(snapshot: &EntrySnapshot) -> io::Result<()> {
        if !snapshot.existed {
            return delete_entry(snapshot.path);
        }
        let (parent_path, leaf) = split_parent(snapshot.path);
        let (parent, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(parent_path)?;
        let (key, _) = parent.create_subkey(leaf)?;
        restore_value(&key, "", &snapshot.label)?;
        restore_value(&key, "Icon", &snapshot.icon)?;
        restore_value(&key, MANAGED_VALUE, &snapshot.managed)?;
        restore_value(&key, COMMAND_VALUE, &snapshot.registered_command)?;
        let _ = key.delete_subkey_all("command");
        if let Some(command) = &snapshot.command {
            let (command_key, _) = key.create_subkey("command")?;
            command_key.set_value("", command)?;
        }
        Ok(())
    }

    fn rollback(snapshots: &[EntrySnapshot]) -> String {
        let mut failures = Vec::new();
        for snapshot in snapshots.iter().rev() {
            if let Err(error) = restore_entry(snapshot) {
                failures.push(format!("{}：{error}", snapshot.path));
            }
        }
        if failures.is_empty() {
            String::new()
        } else {
            format!("；回滚失败：{}", failures.join("；"))
        }
    }

    fn quote_command(executable: &PathBuf, argument: &str, marker: &str) -> String {
        let executable = executable.to_string_lossy().replace('"', "");
        format!("\"{executable}\" \"{marker}\" \"{argument}\"")
    }

    fn write_entry(
        path: &str,
        argument: &str,
        marker: &str,
        executable: &PathBuf,
    ) -> io::Result<()> {
        let (parent_path, leaf) = split_parent(path);
        let (parent, _) = RegKey::predef(HKEY_CURRENT_USER).create_subkey(parent_path)?;
        let (key, _) = parent.create_subkey(leaf)?;
        let command = quote_command(executable, argument, marker);
        key.set_value("", &MENU_LABEL)?;
        key.set_value("Icon", &executable.to_string_lossy().to_string())?;
        key.set_value(MANAGED_VALUE, &"1")?;
        key.set_value(COMMAND_VALUE, &command)?;
        let (command_key, _) = key.create_subkey("command")?;
        command_key.set_value("", &command)
    }

    fn entry_is_managed(snapshot: &EntrySnapshot) -> bool {
        snapshot.existed
            && snapshot.managed.as_deref() == Some("1")
            && snapshot.registered_command.is_some()
            && snapshot.command == snapshot.registered_command
    }

    pub fn status() -> ContextMenuStatus {
        let snapshots = ENTRY_PATHS
            .iter()
            .map(|(path, _, _)| snapshot_entry(path))
            .collect::<Result<Vec<_>, _>>();
        match snapshots {
            Ok(snapshots) => {
                let managed = snapshots.iter().all(entry_is_managed);
                ContextMenuStatus {
                    supported: true,
                    enabled: managed,
                    managed,
                    message: if managed {
                        "已注册到 Windows 资源管理器右键菜单"
                    } else {
                        "未注册 Windows 资源管理器右键菜单"
                    }
                    .to_string(),
                }
            }
            Err(error) => ContextMenuStatus {
                supported: true,
                enabled: false,
                managed: false,
                message: error,
            },
        }
    }

    pub fn set_enabled(enabled: bool) -> Result<ContextMenuStatus, String> {
        let snapshots = ENTRY_PATHS
            .iter()
            .map(|(path, _, _)| snapshot_entry(path))
            .collect::<Result<Vec<_>, _>>()?;
        if !enabled {
            if snapshots
                .iter()
                .any(|snapshot| snapshot.existed && !entry_is_managed(snapshot))
            {
                return Err("检测到右键菜单项已被其他程序修改，未执行删除".to_string());
            }
            for (index, snapshot) in snapshots.iter().enumerate() {
                if let Err(error) = delete_entry(snapshot.path) {
                    let rollback_error = rollback(&snapshots[..=index]);
                    return Err(format!("删除右键菜单失败：{error}{rollback_error}"));
                }
            }
            return Ok(ContextMenuStatus {
                supported: true,
                enabled: false,
                managed: false,
                message: "已从 Windows 资源管理器右键菜单移除".to_string(),
            });
        }

        if snapshots
            .iter()
            .any(|snapshot| snapshot.existed && !entry_is_managed(snapshot))
        {
            return Err(format!(
                "检测到已有同名右键菜单项：{MENU_KEY}，为避免覆盖用户设置未执行修改"
            ));
        }
        let executable = std::env::current_exe()
            .map_err(|error| format!("无法定位 Deeptop 可执行文件：{error}"))?;
        let mut written = Vec::new();
        for (index, (path, argument, marker)) in ENTRY_PATHS.iter().enumerate() {
            if let Err(error) = write_entry(path, argument, marker, &executable) {
                let rollback_error = rollback(&snapshots[..=written.len()]);
                return Err(format!(
                    "写入右键菜单失败（第 {} 项）：{error}{rollback_error}",
                    index + 1
                ));
            }
            written.push(&snapshots[index]);
        }
        Ok(ContextMenuStatus {
            supported: true,
            enabled: true,
            managed: true,
            message: "已添加到 Windows 资源管理器右键菜单".to_string(),
        })
    }
}

#[cfg(not(windows))]
mod platform {
    use super::ContextMenuStatus;

    pub fn status() -> ContextMenuStatus {
        ContextMenuStatus {
            supported: false,
            enabled: false,
            managed: false,
            message: "资源管理器右键菜单仅支持 Windows".to_string(),
        }
    }

    pub fn set_enabled(_enabled: bool) -> Result<ContextMenuStatus, String> {
        Err("资源管理器右键菜单仅支持 Windows".to_string())
    }
}

pub fn status() -> ContextMenuStatus {
    platform::status()
}

pub fn set_enabled(enabled: bool) -> Result<ContextMenuStatus, String> {
    platform::set_enabled(enabled)
}
