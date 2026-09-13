use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

const SETTINGS_FILE: &str = "dock-settings.json";

/// 右栏宽度（px）的夹取范围；与前端 dock-layout 模型的常量保持一致。
const DOCK_RAIL_MIN_WIDTH: u32 = 260;
const DOCK_RAIL_MAX_WIDTH: u32 = 960;

/// 布局快照的体积上限。布局本身是小型布局树，超过这个体积只能是损坏或被
/// 篡改的输入，直接丢弃而不是把它继续写回配置文件。
const LAYOUT_MAX_BYTES: usize = 64 * 1024;

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DockSettings {
    #[serde(default)]
    pub auto_collapse_on_outside_click: bool,
    /// 可停靠右栏的布局树快照（`DockLayout` 的 JSON 形式）。
    ///
    /// 结构校验属于前端的纯模型（`src/app/dock-layout.ts` 的
    /// `normalizeDockLayout`），这里是传输与体积守卫：只接受 JSON 对象，
    /// 并拒绝超过 `LAYOUT_MAX_BYTES` 的快照。
    #[serde(default)]
    pub layout: Value,
    /// 用户拖拽调整后的右栏宽度；缺失表示使用默认宽度。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rail_width: Option<u32>,
    /// 用户勾选过"不再询问"的 git 写操作（存后端命令名，例如 `git_stage_paths`）。
    /// 只允许简单可逆的操作进入这个列表，破坏性操作始终确认。
    #[serde(default)]
    pub git_confirm_skip: Vec<String>,
}

fn clamp_rail_width(value: Option<u32>) -> Option<u32> {
    value.map(|width| width.clamp(DOCK_RAIL_MIN_WIDTH, DOCK_RAIL_MAX_WIDTH))
}

/// 丢弃无法解释的布局快照，保证配置文件里的 layout 始终是可用的对象。
pub(crate) fn sanitize_layout(layout: Value) -> Value {
    match layout {
        Value::Object(entries) => {
            let bounded = Value::Object(entries);
            if serde_json::to_vec(&bounded)
                .map(|bytes| bytes.len() > LAYOUT_MAX_BYTES)
                .unwrap_or(true)
            {
                Value::Null
            } else {
                bounded
            }
        }
        _ => Value::Null,
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
    let settings: DockSettings =
        serde_json::from_str(&content).map_err(|error| format!("解析 Dock 设置失败：{error}"))?;
    Ok(sanitize(settings))
}

/// 归一化任意来源的 Dock 设置（读取与写入共用同一条路径）。
pub fn sanitize(settings: DockSettings) -> DockSettings {
    DockSettings {
        layout: sanitize_layout(settings.layout),
        rail_width: clamp_rail_width(settings.rail_width),
        ..settings
    }
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
    let settings = sanitize(settings);
    save(&app, &settings)?;
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{sanitize, sanitize_layout, DockSettings, LAYOUT_MAX_BYTES};

    #[test]
    fn defaults_to_disabled_outside_click_collapse_and_an_empty_layout() {
        let settings = DockSettings::default();
        assert!(!settings.auto_collapse_on_outside_click);
        assert!(settings.layout.is_null());
        assert_eq!(settings.rail_width, None);
    }

    #[test]
    fn serializes_a_stable_desktop_protocol() {
        let value = serde_json::to_value(DockSettings {
            auto_collapse_on_outside_click: true,
            layout: json!({ "root": null, "tabs": {} }),
            rail_width: Some(420),
            git_confirm_skip: vec!["git_stage_paths".to_string()],
        })
        .unwrap();
        assert_eq!(value["autoCollapseOnOutsideClick"], true);
        assert_eq!(value["layout"]["tabs"], json!({}));
        assert_eq!(value["railWidth"], 420);
        assert_eq!(value["gitConfirmSkip"], json!(["git_stage_paths"]));
    }

    #[test]
    fn omits_an_absent_rail_width() {
        let value = serde_json::to_value(DockSettings::default()).unwrap();
        assert!(value.get("railWidth").is_none());
    }

    #[test]
    fn deserializes_legacy_settings_without_layout_or_width() {
        let settings: DockSettings =
            serde_json::from_str("{\"autoCollapseOnOutsideClick\":true}").unwrap();
        assert!(settings.auto_collapse_on_outside_click);
        assert!(settings.layout.is_null());
        assert_eq!(settings.rail_width, None);
    }

    #[test]
    fn ignores_retired_pin_fields_from_older_settings_files() {
        let raw = "{\"pinned\":{\"git-dock\":true},\"columnWidths\":{\"left\":420}}";
        let settings: DockSettings = serde_json::from_str(raw).unwrap();
        let value = serde_json::to_value(settings).unwrap();
        assert!(value.get("pinned").is_none());
        assert!(value.get("columnWidths").is_none());
    }

    #[test]
    fn drops_layout_snapshots_that_are_not_objects() {
        assert!(sanitize_layout(json!(null)).is_null());
        assert_eq!(sanitize_layout(json!("nope")), serde_json::Value::Null);
        assert_eq!(sanitize_layout(json!([1, 2])), serde_json::Value::Null);
        let kept = sanitize_layout(json!({ "root": null, "tabs": {} }));
        assert!(kept.is_object());
    }

    #[test]
    fn drops_oversized_layout_snapshots() {
        let huge = json!({ "root": { "kind": "pane", "id": "x".repeat(LAYOUT_MAX_BYTES) } });
        assert!(sanitize_layout(huge).is_null());
    }

    #[test]
    fn clamps_the_rail_width_into_range() {
        let settings = sanitize(DockSettings {
            auto_collapse_on_outside_click: false,
            layout: json!({}),
            rail_width: Some(80),
            git_confirm_skip: Vec::new(),
        });
        assert_eq!(settings.rail_width, Some(260));
        let settings = sanitize(DockSettings {
            auto_collapse_on_outside_click: false,
            layout: json!({}),
            rail_width: Some(2_000),
            git_confirm_skip: Vec::new(),
        });
        assert_eq!(settings.rail_width, Some(960));
        assert_eq!(sanitize(DockSettings::default()).rail_width, None);
    }
}
