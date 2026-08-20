use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const POSITIONS_FILE: &str = "dock-positions.json";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct DockPosition {
    pub x: f64,
    pub y: f64,
}

fn positions_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|path| path.join(POSITIONS_FILE))
        .map_err(|error| format!("无法定位 Dock 位置配置目录：{error}"))
}

fn valid_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 100
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Dock id 无效".to_string());
    }
    Ok(())
}

fn valid_position(position: DockPosition) -> Result<(), String> {
    if position.x.is_finite()
        && position.y.is_finite()
        && position.x.abs() <= 100_000.0
        && position.y.abs() <= 100_000.0
    {
        Ok(())
    } else {
        Err("Dock 位置无效".to_string())
    }
}

fn load(app: &AppHandle) -> Result<HashMap<String, DockPosition>, String> {
    let path = positions_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(HashMap::new()),
        Err(error) => return Err(format!("读取 Dock 位置失败：{error}")),
    };
    serde_json::from_str(&content).map_err(|error| format!("解析 Dock 位置失败：{error}"))
}

fn save(app: &AppHandle, positions: &HashMap<String, DockPosition>) -> Result<(), String> {
    let path = positions_path(app)?;
    let parent = path
        .parent()
        .ok_or_else(|| "无法定位 Dock 位置配置目录".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("创建 Dock 位置配置目录失败：{error}"))?;
    let content = serde_json::to_string_pretty(positions)
        .map_err(|error| format!("编码 Dock 位置失败：{error}"))?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{content}\n"))
        .map_err(|error| format!("写入 Dock 位置失败：{error}"))?;
    if path.exists() {
        let backup = path.with_extension("json.bak");
        if let Err(error) = fs::remove_file(&backup) {
            if error.kind() != std::io::ErrorKind::NotFound {
                let _ = fs::remove_file(&temporary);
                return Err(format!("清理旧 Dock 位置备份失败：{error}"));
            }
        }
        if let Err(error) = fs::rename(&path, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("准备替换 Dock 位置失败：{error}"));
        }
        if let Err(error) = fs::rename(&temporary, &path) {
            let _ = fs::rename(&backup, &path);
            let _ = fs::remove_file(&temporary);
            return Err(format!("保存 Dock 位置失败：{error}"));
        }
        let _ = fs::remove_file(&backup);
    } else if let Err(error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("保存 Dock 位置失败：{error}"));
    }
    Ok(())
}

pub fn get(app: AppHandle, id: String) -> Result<Option<DockPosition>, String> {
    valid_id(&id)?;
    Ok(load(&app)?.get(&id).copied())
}

pub fn set(app: AppHandle, id: String, position: DockPosition) -> Result<(), String> {
    valid_id(&id)?;
    valid_position(position)?;
    let mut positions = load(&app)?;
    positions.insert(id, position);
    save(&app, &positions)
}

pub fn reset(app: AppHandle, id: String) -> Result<(), String> {
    valid_id(&id)?;
    let mut positions = load(&app)?;
    positions.remove(&id);
    save(&app, &positions)
}

#[cfg(test)]
mod tests {
    use super::{valid_id, valid_position, DockPosition};

    #[test]
    fn validates_stable_dock_ids() {
        assert!(valid_id("todo-dock").is_ok());
        assert!(valid_id("todo dock").is_err());
        assert!(valid_id("").is_err());
    }

    #[test]
    fn rejects_non_finite_positions() {
        assert!(valid_position(DockPosition { x: 12.0, y: -4.0 }).is_ok());
        assert!(valid_position(DockPosition {
            x: f64::NAN,
            y: 0.0
        })
        .is_err());
        assert!(valid_position(DockPosition {
            x: 100_001.0,
            y: 0.0
        })
        .is_err());
    }
}
