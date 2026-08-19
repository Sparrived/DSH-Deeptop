use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const PREFERENCES_FILE: &str = "window-behavior.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WindowBehaviorSettings {
    pub minimize_to_tray: bool,
    pub close_behavior: CloseBehavior,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CloseBehavior {
    Ask,
    HideToTray,
    Exit,
}

impl Default for WindowBehaviorSettings {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
            close_behavior: CloseBehavior::Ask,
        }
    }
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(PREFERENCES_FILE))
        .map_err(|error| format!("无法定位窗口行为配置目录：{error}"))
}

pub fn load(app: &AppHandle) -> Result<WindowBehaviorSettings, String> {
    let path = preferences_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WindowBehaviorSettings::default())
        }
        Err(error) => return Err(format!("读取窗口行为配置失败：{error}")),
    };
    serde_json::from_str(&content).map_err(|error| format!("解析窗口行为配置失败：{error}"))
}

pub fn save(app: &AppHandle, settings: &WindowBehaviorSettings) -> Result<(), String> {
    let path = preferences_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位窗口行为配置目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建窗口行为配置目录失败：{error}"))?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("编码窗口行为配置失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{content}\n"))
        .map_err(|error| format!("写入窗口行为配置失败：{error}"))?;
    if path.exists() {
        let backup = path.with_extension("json.bak");
        let _ = fs::remove_file(&backup);
        fs::rename(&path, &backup).map_err(|error| format!("准备替换窗口行为配置失败：{error}"))?;
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(format!("保存窗口行为配置失败：{error}"));
        }
        let _ = fs::remove_file(&backup);
    } else if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("保存窗口行为配置失败：{error}"));
    }
    Ok(())
}

pub fn get_window_behavior_settings(app: AppHandle) -> Result<WindowBehaviorSettings, String> {
    load(&app)
}

pub fn set_window_behavior_settings(
    app: AppHandle,
    settings: WindowBehaviorSettings,
) -> Result<WindowBehaviorSettings, String> {
    save(&app, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::{CloseBehavior, WindowBehaviorSettings};

    #[test]
    fn defaults_to_asking_before_first_close() {
        assert_eq!(
            WindowBehaviorSettings::default().close_behavior,
            CloseBehavior::Ask
        );
        assert!(!WindowBehaviorSettings::default().minimize_to_tray);
    }

    #[test]
    fn close_behavior_serializes_as_stable_desktop_protocol() {
        let value = serde_json::to_value(WindowBehaviorSettings {
            minimize_to_tray: true,
            close_behavior: CloseBehavior::HideToTray,
        })
        .unwrap();
        assert_eq!(value["minimizeToTray"], true);
        assert_eq!(value["closeBehavior"], "hide-to-tray");
    }
}
