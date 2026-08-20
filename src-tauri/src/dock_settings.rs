use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "dock-settings.json";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockSettings {
    #[serde(default)]
    pub auto_collapse_on_outside_click: bool,
}

impl Default for DockSettings {
    fn default() -> Self {
        Self {
            auto_collapse_on_outside_click: false,
        }
    }
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(SETTINGS_FILE))
        .map_err(|error| format!("无法定位 Dock 设置目录：{error}"))
}

pub fn load(app: &AppHandle) -> Result<DockSettings, String> {
    let path = settings_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DockSettings::default())
        }
        Err(error) => return Err(format!("读取 Dock 设置失败：{error}")),
    };
    serde_json::from_str(&content).map_err(|error| format!("解析 Dock 设置失败：{error}"))
}

pub fn save(app: &AppHandle, settings: &DockSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位 Dock 设置目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建 Dock 设置目录失败：{error}"))?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("编码 Dock 设置失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{content}\n"))
        .map_err(|error| format!("写入 Dock 设置失败：{error}"))?;
    if path.exists() {
        let backup = path.with_extension("json.bak");
        if let Err(error) = fs::remove_file(&backup) {
            if error.kind() != std::io::ErrorKind::NotFound {
                let _ = fs::remove_file(&temporary);
                return Err(format!("清理旧 Dock 设置备份失败：{error}"));
            }
        }
        if let Err(error) = fs::rename(&path, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("准备替换 Dock 设置失败：{error}"));
        }
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(format!("保存 Dock 设置失败：{error}"));
        }
        let _ = fs::remove_file(&backup);
    } else if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("保存 Dock 设置失败：{error}"));
    }
    Ok(())
}

pub fn get(app: AppHandle) -> Result<DockSettings, String> {
    load(&app)
}

pub fn set(app: AppHandle, settings: DockSettings) -> Result<DockSettings, String> {
    save(&app, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::DockSettings;

    #[test]
    fn defaults_to_disabled_outside_click_collapse() {
        assert!(!DockSettings::default().auto_collapse_on_outside_click);
    }

    #[test]
    fn serializes_a_stable_desktop_protocol() {
        let value = serde_json::to_value(DockSettings {
            auto_collapse_on_outside_click: true,
        })
        .unwrap();
        assert_eq!(value["autoCollapseOnOutsideClick"], true);
    }
}
