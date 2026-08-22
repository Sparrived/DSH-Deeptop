use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

use super::dock_position::valid_id;

const SETTINGS_FILE: &str = "dock-settings.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockSettings {
    #[serde(default)]
    pub auto_collapse_on_outside_click: bool,
    /// 钉住的 Dock id 集合；只保留通过 id 校验的条目。
    #[serde(default)]
    pub pinned: HashMap<String, bool>,
}

/// 丢弃非法键并压缩掉 false 值，保证配置文件里的 pinned 始终是精简的 true 映射。
pub(crate) fn sanitize_pinned(pinned: HashMap<String, bool>) -> HashMap<String, bool> {
    pinned
        .into_iter()
        .filter(|(id, pinned)| *pinned && valid_id(id).is_ok())
        .collect()
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
    let settings = DockSettings {
        pinned: sanitize_pinned(settings.pinned),
        ..settings
    };
    save(&app, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{sanitize_pinned, DockSettings};

    #[test]
    fn defaults_to_disabled_outside_click_collapse_and_no_pins() {
        let settings = DockSettings::default();
        assert!(!settings.auto_collapse_on_outside_click);
        assert!(settings.pinned.is_empty());
    }

    #[test]
    fn serializes_a_stable_desktop_protocol() {
        let mut pinned = HashMap::new();
        pinned.insert("todo-dock".to_string(), true);
        let value = serde_json::to_value(DockSettings {
            auto_collapse_on_outside_click: true,
            pinned,
        })
        .unwrap();
        assert_eq!(value["autoCollapseOnOutsideClick"], true);
        assert_eq!(value["pinned"]["todo-dock"], true);
    }

    #[test]
    fn deserializes_legacy_settings_without_pins() {
        let settings: DockSettings =
            serde_json::from_str("{\"autoCollapseOnOutsideClick\":true}").unwrap();
        assert!(settings.auto_collapse_on_outside_click);
        assert!(settings.pinned.is_empty());
    }

    #[test]
    fn sanitizes_pinned_entries() {
        let mut pinned = HashMap::new();
        pinned.insert("todo-dock".to_string(), true);
        pinned.insert("bad id".to_string(), true);
        pinned.insert("".to_string(), true);
        pinned.insert("git-dock".to_string(), false);
        let sanitized = sanitize_pinned(pinned);
        assert_eq!(sanitized.len(), 1);
        assert!(sanitized.contains_key("todo-dock"));
    }
}
