use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, RecvTimeoutError, Sender},
        Mutex,
    },
    thread,
    time::Duration,
};

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

use super::{
    care as pet_care,
    store::{self as pet_store, PetAnchor, PetSettings, PetWindowPlacement},
};

const PET_WINDOW_LABEL: &str = "desktop-pet";
const MAIN_WINDOW_LABEL: &str = "main";
const PET_WINDOW_QUERY: &str = "index.html?desktop-pet=1";
const PET_WINDOW_PADDING: u16 = 32;
const PET_PANEL_WIDTH: u32 = 304;
const PET_PANEL_HEIGHT: u32 = 320;
const PET_WINDOW_EDGE_MARGIN: i32 = 12;
const PET_SETTINGS_EVENT: &str = "deeptop-pet-settings-changed";
const PET_ACTIVITY_EVENT: &str = "deeptop-pet-activity-changed";
const PET_ACTION_EVENT: &str = "deeptop-pet-action-requested";
const PET_PLACEMENT_SAVE_DELAY: Duration = Duration::from_millis(250);
const MAX_SESSION_ID_CHARS: usize = 256;
const MAX_ATTENTION_ID_CHARS: usize = 320;
const MAX_TITLE_CHARS: usize = 160;
const MAX_MESSAGE_CHARS: usize = 1_200;
const MAX_TOOL_NAME_CHARS: usize = 160;
const MAX_ACTION_TEXT_CHARS: usize = 4_000;
const MAX_OPTIONS: usize = 3;
const MAX_OPTION_CHARS: usize = 120;
const MAX_ACTIVITIES: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
struct MonitorWorkArea {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale_factor: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PetDisplaySettings {
    anchor: PetAnchor,
    size: u16,
    interactions_enabled: bool,
    expanded: bool,
}

impl PetDisplaySettings {
    fn new(settings: &PetSettings, expanded: bool) -> Self {
        Self {
            anchor: settings.anchor,
            size: settings.size,
            interactions_enabled: settings.interactions_enabled,
            expanded,
        }
    }
}

#[derive(Clone, Copy, Debug)]
struct PetWindowLayoutUpdate {
    expanded: bool,
    previous_display: Option<PetDisplaySettings>,
    restore_saved: bool,
    reanchor: bool,
    ensure_visible: bool,
}

#[derive(Default)]
pub struct PetWindowRuntime {
    activity: Mutex<PetActivityUpdate>,
    revision: AtomicU64,
    display: Mutex<Option<PetDisplaySettings>>,
    expanded: Mutex<bool>,
    placement_sender: Mutex<Option<Sender<PetWindowPlacement>>>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PetActivityState {
    #[default]
    Idle,
    Running,
    Waiting,
    Failed,
    Review,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetAttentionKind {
    Approval,
    Question,
    Completed,
    Failed,
    Running,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetSessionTarget {
    session_id: String,
    title: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetAttention {
    id: String,
    kind: PetAttentionKind,
    session_id: String,
    title: String,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    tool_name: Option<String>,
    #[serde(default)]
    options: Vec<String>,
    can_reply: bool,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetActivityUpdate {
    state: PetActivityState,
    #[serde(default)]
    activities: Vec<PetAttention>,
    #[serde(default)]
    attention: Option<PetAttention>,
    #[serde(default)]
    target: Option<PetSessionTarget>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetActivity {
    state: PetActivityState,
    revision: u64,
    activities: Vec<PetAttention>,
    #[serde(skip_serializing_if = "Option::is_none")]
    attention: Option<PetAttention>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<PetSessionTarget>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PetWindowContext {
    settings: PetSettings,
    activity: PetActivity,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetPointerContext {
    delta_x: f64,
    delta_y: f64,
    distance: f64,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetActionKind {
    Open,
    Reply,
    Answer,
    ApprovalAllow,
    ApprovalReject,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetAction {
    kind: PetActionKind,
    session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    activity_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    selected_option: Option<bool>,
}

fn pet_window_side(size: u16) -> u32 {
    u32::from(size.saturating_add(PET_WINDOW_PADDING))
}

fn pet_window_dimensions(size: u16, expanded: bool) -> (u32, u32) {
    let side = pet_window_side(size);
    if expanded {
        (
            side.saturating_add(PET_PANEL_WIDTH),
            side.max(PET_PANEL_HEIGHT),
        )
    } else {
        (side, side)
    }
}

fn physical_window_side(logical_side: u32, scale_factor: f64) -> u32 {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    (f64::from(logical_side) * scale).round().max(1.0) as u32
}

fn physical_window_dimensions(size: u16, expanded: bool, scale_factor: f64) -> (u32, u32, u32) {
    let logical_side = pet_window_side(size);
    let (logical_width, logical_height) = pet_window_dimensions(size, expanded);
    (
        physical_window_side(logical_width, scale_factor),
        physical_window_side(logical_height, scale_factor),
        physical_window_side(logical_side, scale_factor),
    )
}

fn pet_position_from_window(
    window_position: PhysicalPosition<i32>,
    window_width: u32,
    window_height: u32,
    pet_side: u32,
    anchor: PetAnchor,
) -> PhysicalPosition<i32> {
    let x = match anchor {
        PetAnchor::BottomLeft => i64::from(window_position.x),
        PetAnchor::BottomRight => {
            i64::from(window_position.x) + i64::from(window_width) - i64::from(pet_side)
        }
    };
    let y = i64::from(window_position.y) + i64::from(window_height) - i64::from(pet_side);
    PhysicalPosition::new(
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    )
}

fn window_position_from_pet(
    pet_position: PhysicalPosition<i32>,
    window_width: u32,
    window_height: u32,
    pet_side: u32,
    anchor: PetAnchor,
) -> PhysicalPosition<i32> {
    let x = match anchor {
        PetAnchor::BottomLeft => i64::from(pet_position.x),
        PetAnchor::BottomRight => {
            i64::from(pet_position.x) + i64::from(pet_side) - i64::from(window_width)
        }
    };
    let y = i64::from(pet_position.y) + i64::from(pet_side) - i64::from(window_height);
    PhysicalPosition::new(
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        y.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    )
}

fn anchored_position(
    anchor: PetAnchor,
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    window_width: u32,
    window_height: u32,
) -> PhysicalPosition<i32> {
    let left = i64::from(work_x) + i64::from(PET_WINDOW_EDGE_MARGIN);
    let right = i64::from(work_x) + i64::from(work_width)
        - i64::from(window_width)
        - i64::from(PET_WINDOW_EDGE_MARGIN);
    let bottom = i64::from(work_y) + i64::from(work_height)
        - i64::from(window_height)
        - i64::from(PET_WINDOW_EDGE_MARGIN);
    let x = match anchor {
        PetAnchor::BottomLeft => left,
        PetAnchor::BottomRight => right,
    };
    PhysicalPosition::new(
        x.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
        bottom.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32,
    )
}

fn visible_position(
    current: PhysicalPosition<i32>,
    work_x: i32,
    work_y: i32,
    work_width: u32,
    work_height: u32,
    window_width: u32,
    window_height: u32,
) -> PhysicalPosition<i32> {
    fn clamp_axis(current: i32, start: i32, extent: u32, window_extent: u32) -> i32 {
        let start = i64::from(start);
        let minimum = start + i64::from(PET_WINDOW_EDGE_MARGIN);
        let maximum = start + i64::from(extent)
            - i64::from(window_extent)
            - i64::from(PET_WINDOW_EDGE_MARGIN);
        if maximum < minimum {
            return start.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32;
        }
        i64::from(current).clamp(minimum, maximum) as i32
    }

    PhysicalPosition::new(
        clamp_axis(current.x, work_x, work_width, window_width),
        clamp_axis(current.y, work_y, work_height, window_height),
    )
}

fn intersection_area(
    position: PhysicalPosition<i32>,
    window_width: u32,
    window_height: u32,
    area: MonitorWorkArea,
) -> u64 {
    let window_left = i64::from(position.x);
    let window_top = i64::from(position.y);
    let window_right = window_left + i64::from(window_width);
    let window_bottom = window_top + i64::from(window_height);
    let area_left = i64::from(area.x);
    let area_top = i64::from(area.y);
    let area_right = area_left + i64::from(area.width);
    let area_bottom = area_top + i64::from(area.height);
    let width = (window_right.min(area_right) - window_left.max(area_left)).max(0) as u64;
    let height = (window_bottom.min(area_bottom) - window_top.max(area_top)).max(0) as u64;
    width * height
}

fn restored_position(
    placement: PetWindowPlacement,
    anchor: PetAnchor,
    logical_side: u32,
    work_areas: &[MonitorWorkArea],
) -> Option<(PhysicalPosition<i32>, MonitorWorkArea)> {
    if placement.anchor != anchor {
        return None;
    }
    let saved = PhysicalPosition::new(placement.x, placement.y);
    let area = work_areas
        .iter()
        .copied()
        .filter_map(|area| {
            let physical_side = physical_window_side(logical_side, area.scale_factor);
            let overlap = intersection_area(saved, physical_side, physical_side, area);
            (overlap > 0).then_some((overlap, area, physical_side))
        })
        .max_by_key(|(overlap, _, _)| *overlap)?;
    Some((
        visible_position(
            saved,
            area.1.x,
            area.1.y,
            area.1.width,
            area.1.height,
            area.2,
            area.2,
        ),
        area.1,
    ))
}

fn pointer_context(
    cursor: tauri::PhysicalPosition<f64>,
    window_position: PhysicalPosition<i32>,
    window_width: u32,
    window_height: u32,
    scale_factor: f64,
) -> PetPointerContext {
    let scale = if scale_factor.is_finite() && scale_factor > 0.0 {
        scale_factor
    } else {
        1.0
    };
    let center_x = f64::from(window_position.x) + f64::from(window_width) / 2.0;
    let center_y = f64::from(window_position.y) + f64::from(window_height) / 2.0;
    let delta_x = (cursor.x - center_x) / scale;
    let delta_y = (cursor.y - center_y) / scale;
    PetPointerContext {
        delta_x,
        delta_y,
        distance: delta_x.hypot(delta_y),
    }
}

fn validate_text(value: &str, label: &str, maximum: usize) -> Result<(), String> {
    if value.trim().is_empty()
        || value.chars().count() > maximum
        || value.chars().any(|character| character == '\0')
    {
        return Err(format!(
            "{label}不能为空、不能包含空字符，且不能超过 {maximum} 个字符"
        ));
    }
    Ok(())
}

fn validate_target(target: &PetSessionTarget) -> Result<(), String> {
    validate_text(&target.session_id, "会话 id", MAX_SESSION_ID_CHARS)?;
    validate_text(&target.title, "会话标题", MAX_TITLE_CHARS)
}

fn validate_attention(attention: &PetAttention) -> Result<(), String> {
    validate_text(&attention.id, "提醒 id", MAX_ATTENTION_ID_CHARS)?;
    validate_text(&attention.session_id, "提醒会话 id", MAX_SESSION_ID_CHARS)?;
    validate_text(&attention.title, "提醒标题", MAX_TITLE_CHARS)?;
    validate_text(&attention.message, "提醒内容", MAX_MESSAGE_CHARS)?;
    if let Some(tool_name) = &attention.tool_name {
        validate_text(tool_name, "工具名称", MAX_TOOL_NAME_CHARS)?;
    }
    if attention.options.len() > MAX_OPTIONS {
        return Err(format!("桌宠快捷选项不能超过 {MAX_OPTIONS} 项"));
    }
    for option in &attention.options {
        validate_text(option, "桌宠快捷选项", MAX_OPTION_CHARS)?;
    }
    Ok(())
}

fn validate_activity(activity: &PetActivityUpdate) -> Result<(), String> {
    if let Some(target) = &activity.target {
        validate_target(target)?;
    }
    if activity.activities.len() > MAX_ACTIVITIES {
        return Err(format!("桌宠活动不能超过 {MAX_ACTIVITIES} 项"));
    }
    let mut ids = HashSet::new();
    let mut session_ids = HashSet::new();
    for item in &activity.activities {
        validate_attention(item)?;
        if !ids.insert(item.id.as_str()) {
            return Err("桌宠活动 id 不能重复".to_string());
        }
        if !session_ids.insert(item.session_id.as_str()) {
            return Err("同一会话只能保留一个桌宠活动".to_string());
        }
    }
    if let Some(attention) = &activity.attention {
        validate_attention(attention)?;
        if !activity.activities.iter().any(|item| item == attention) {
            return Err("当前桌宠提醒必须来自活动列表".to_string());
        }
    }
    if let Some(target) = &activity.target {
        if !activity.activities.is_empty()
            && !activity
                .activities
                .iter()
                .any(|item| item.session_id == target.session_id)
        {
            return Err("桌宠目标会话必须来自活动列表".to_string());
        }
    }
    Ok(())
}

fn validate_action(action: &PetAction) -> Result<(), String> {
    validate_text(&action.session_id, "会话 id", MAX_SESSION_ID_CHARS)?;
    if let Some(activity_id) = &action.activity_id {
        validate_text(activity_id, "活动 id", MAX_ATTENTION_ID_CHARS)?;
    }
    match action.kind {
        PetActionKind::Reply => {
            let text = action
                .text
                .as_deref()
                .ok_or_else(|| "快捷回复不能为空".to_string())?;
            validate_text(text, "快捷回复", MAX_ACTION_TEXT_CHARS)?;
            if action.selected_option.is_some() {
                return Err("快捷回复不能携带问题选项标记".to_string());
            }
            Ok(())
        }
        PetActionKind::Answer => {
            let text = action
                .text
                .as_deref()
                .ok_or_else(|| "快捷回答不能为空".to_string())?;
            validate_text(text, "快捷回答", MAX_ACTION_TEXT_CHARS)
        }
        PetActionKind::Open | PetActionKind::ApprovalAllow | PetActionKind::ApprovalReject => {
            if action.text.is_some() || action.selected_option.is_some() {
                return Err("当前桌宠动作不接受回答内容".to_string());
            }
            Ok(())
        }
    }
}

fn validate_action_against_activity(
    action: &PetAction,
    activity: &PetActivityUpdate,
) -> Result<(), String> {
    let selected = match action.activity_id.as_deref() {
        Some(activity_id) => Some(
            activity
                .activities
                .iter()
                .find(|item| item.id == activity_id && item.session_id == action.session_id)
                .ok_or_else(|| "桌宠活动已经处理或失效".to_string())?,
        ),
        None => None,
    };
    let target_matches = activity
        .target
        .as_ref()
        .is_some_and(|target| target.session_id == action.session_id);
    match action.kind {
        PetActionKind::Open if selected.is_some() || target_matches => Ok(()),
        PetActionKind::Open => Err("桌宠快捷卡片已经失效".to_string()),
        PetActionKind::Reply => match selected {
            Some(attention)
                if attention.can_reply
                    && matches!(
                        attention.kind,
                        PetAttentionKind::Completed | PetAttentionKind::Failed
                    ) =>
            {
                Ok(())
            }
            None if activity.activities.is_empty() && target_matches => Ok(()),
            Some(_) => Err("当前提醒不接受快捷回复".to_string()),
            None => Err("当前提醒不接受快捷回复".to_string()),
        },
        PetActionKind::Answer => match selected {
            Some(attention)
                if attention.kind == PetAttentionKind::Question && attention.can_reply =>
            {
                Ok(())
            }
            _ => Err("该问题已经处理或失效".to_string()),
        },
        PetActionKind::ApprovalAllow | PetActionKind::ApprovalReject => match selected {
            Some(attention) if attention.kind == PetAttentionKind::Approval => Ok(()),
            _ => Err("该权限请求已经处理或失效".to_string()),
        },
    }
}

fn placement_sender(app: &AppHandle) -> Result<Sender<PetWindowPlacement>, String> {
    let runtime = app.state::<PetWindowRuntime>();
    let mut slot = runtime
        .placement_sender
        .lock()
        .map_err(|_| "宠物窗口位置写入器不可用".to_string())?;
    if let Some(sender) = slot.as_ref() {
        return Ok(sender.clone());
    }
    let (sender, receiver) = mpsc::channel::<PetWindowPlacement>();
    let writer_app = app.clone();
    thread::spawn(move || {
        while let Ok(mut placement) = receiver.recv() {
            let mut disconnected = false;
            loop {
                match receiver.recv_timeout(PET_PLACEMENT_SAVE_DELAY) {
                    Ok(next) => placement = next,
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => {
                        disconnected = true;
                        break;
                    }
                }
            }
            if let Err(error) = pet_store::save_pet_window_placement(&writer_app, placement) {
                eprintln!("保存宠物窗口位置失败：{error}");
            }
            if disconnected {
                break;
            }
        }
    });
    *slot = Some(sender.clone());
    Ok(sender)
}

fn install_placement_listener(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let sender = placement_sender(app)?;
    let listener_app = app.clone();
    let listener_window = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::Moved(position) = event {
            let Ok(settings) = pet_store::load_pet_settings(&listener_app) else {
                return;
            };
            let Ok(size) = listener_window.outer_size() else {
                return;
            };
            let Ok(scale_factor) = listener_window.scale_factor() else {
                return;
            };
            let pet_side = physical_window_side(pet_window_side(settings.size), scale_factor);
            let pet_position = pet_position_from_window(
                *position,
                size.width,
                size.height,
                pet_side,
                settings.anchor,
            );
            let _ = sender.send(PetWindowPlacement {
                anchor: settings.anchor,
                x: pet_position.x,
                y: pet_position.y,
            });
        }
    });
    Ok(())
}

fn build_pet_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        PET_WINDOW_LABEL,
        WebviewUrl::App(PET_WINDOW_QUERY.into()),
    )
    .title("Deeptop 宠物")
    .inner_size(120.0, 120.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .visible(false)
    .focused(false)
    .build()
    .map_err(|error| format!("创建全局宠物窗口失败：{error}"))?;
    install_placement_listener(app, &window)?;
    Ok(window)
}

fn configure_pet_window(
    app: &AppHandle,
    window: &WebviewWindow,
    settings: &PetSettings,
    update: PetWindowLayoutUpdate,
) -> Result<(), String> {
    let PetWindowLayoutUpdate {
        expanded,
        previous_display,
        restore_saved,
        reanchor,
        ensure_visible,
    } = update;
    let logical_side = pet_window_side(settings.size);
    let (logical_width, logical_height) = pet_window_dimensions(settings.size, expanded);
    let previous_pet_position = if !restore_saved && !reanchor {
        previous_display
            .map(|previous| {
                let position = window
                    .outer_position()
                    .map_err(|error| format!("读取宠物窗口位置失败：{error}"))?;
                let size = window
                    .outer_size()
                    .map_err(|error| format!("读取宠物窗口尺寸失败：{error}"))?;
                let scale_factor = window
                    .scale_factor()
                    .map_err(|error| format!("读取宠物窗口缩放比例失败：{error}"))?;
                let pet_side = physical_window_side(pet_window_side(previous.size), scale_factor);
                Ok::<PhysicalPosition<i32>, String>(pet_position_from_window(
                    position,
                    size.width,
                    size.height,
                    pet_side,
                    previous.anchor,
                ))
            })
            .transpose()?
    } else {
        None
    };
    window
        .set_size(LogicalSize::new(
            f64::from(logical_width),
            f64::from(logical_height),
        ))
        .map_err(|error| format!("调整宠物窗口大小失败：{error}"))?;
    window
        .set_ignore_cursor_events(!settings.interactions_enabled)
        .map_err(|error| format!("切换宠物窗口互动状态失败：{error}"))?;

    if !restore_saved && !reanchor && !ensure_visible {
        return Ok(());
    }

    if restore_saved {
        let work_areas = window
            .available_monitors()
            .map_err(|error| format!("读取显示器列表失败：{error}"))?
            .iter()
            .map(|monitor| {
                let work_area = monitor.work_area();
                MonitorWorkArea {
                    x: work_area.position.x,
                    y: work_area.position.y,
                    width: work_area.size.width,
                    height: work_area.size.height,
                    scale_factor: monitor.scale_factor(),
                }
            })
            .collect::<Vec<_>>();
        match pet_store::load_pet_window_placement(app) {
            Ok(Some(placement)) => {
                if let Some((pet_position, area)) =
                    restored_position(placement, settings.anchor, logical_side, &work_areas)
                {
                    let (window_width, window_height, pet_side) =
                        physical_window_dimensions(settings.size, expanded, area.scale_factor);
                    let position = visible_position(
                        window_position_from_pet(
                            pet_position,
                            window_width,
                            window_height,
                            pet_side,
                            settings.anchor,
                        ),
                        area.x,
                        area.y,
                        area.width,
                        area.height,
                        window_width,
                        window_height,
                    );
                    return window
                        .set_position(position)
                        .map_err(|error| format!("恢复宠物窗口位置失败：{error}"));
                }
            }
            Ok(None) => {}
            Err(error) => eprintln!("忽略不可用的宠物窗口位置：{error}"),
        }
    }

    let monitor = if restore_saved || reanchor {
        app.primary_monitor()
            .map_err(|error| format!("读取主显示器失败：{error}"))?
    } else {
        window
            .current_monitor()
            .map_err(|error| format!("读取宠物所在显示器失败：{error}"))?
            .or_else(|| app.primary_monitor().ok().flatten())
    }
    .ok_or_else(|| "找不到可用于显示宠物的显示器".to_string())?;
    let (window_width, window_height, pet_side) =
        physical_window_dimensions(settings.size, expanded, monitor.scale_factor());
    let work_area = monitor.work_area();
    let pet_position = if restore_saved || reanchor {
        anchored_position(
            settings.anchor,
            work_area.position.x,
            work_area.position.y,
            work_area.size.width,
            work_area.size.height,
            pet_side,
            pet_side,
        )
    } else {
        previous_pet_position.unwrap_or_else(|| {
            anchored_position(
                settings.anchor,
                work_area.position.x,
                work_area.position.y,
                work_area.size.width,
                work_area.size.height,
                pet_side,
                pet_side,
            )
        })
    };
    let position = visible_position(
        window_position_from_pet(
            pet_position,
            window_width,
            window_height,
            pet_side,
            settings.anchor,
        ),
        work_area.position.x,
        work_area.position.y,
        work_area.size.width,
        work_area.size.height,
        window_width,
        window_height,
    );
    window
        .set_position(position)
        .map_err(|error| format!("定位宠物窗口失败：{error}"))
}

pub fn synchronize(app: &AppHandle, settings: &PetSettings) -> Result<(), String> {
    let runtime = app.state::<PetWindowRuntime>();
    if !settings.enabled {
        if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
            window
                .destroy()
                .map_err(|error| format!("关闭宠物窗口失败：{error}"))?;
        }
        *runtime
            .display
            .lock()
            .map_err(|_| "宠物窗口状态不可用".to_string())? = None;
        *runtime
            .expanded
            .lock()
            .map_err(|_| "宠物窗口展开状态不可用".to_string())? = false;
        return Ok(());
    }

    let (window, created) = match app.get_webview_window(PET_WINDOW_LABEL) {
        Some(window) => (window, false),
        None => (build_pet_window(app)?, true),
    };
    let expanded = *runtime
        .expanded
        .lock()
        .map_err(|_| "宠物窗口展开状态不可用".to_string())?;
    let next_display = PetDisplaySettings::new(settings, expanded);
    let previous_display = *runtime
        .display
        .lock()
        .map_err(|_| "宠物窗口状态不可用".to_string())?;
    let restore_saved = created || previous_display.is_none();
    let reanchor = !restore_saved
        && previous_display.is_some_and(|previous| previous.anchor != next_display.anchor);
    let ensure_visible = previous_display.is_some_and(|previous| {
        previous.size != next_display.size || previous.expanded != next_display.expanded
    });
    let update = PetWindowLayoutUpdate {
        expanded,
        previous_display,
        restore_saved,
        reanchor,
        ensure_visible,
    };
    configure_pet_window(app, &window, settings, update)?;
    *runtime
        .display
        .lock()
        .map_err(|_| "宠物窗口状态不可用".to_string())? = Some(next_display);
    let _ = app.emit(PET_SETTINGS_EVENT, settings.clone());
    Ok(())
}

/// 保存设置并同步独立宠物窗口；异步命令避免 Windows WebView2 在同步命令中创建窗口时死锁。
#[tauri::command]
pub async fn set_pet_settings(
    app: AppHandle,
    settings: PetSettings,
) -> Result<PetSettings, String> {
    // 设置文件损坏时向上报错而不是静默按默认值覆盖，避免宠物被意外关闭且
    // 用户配置丢失；首次运行（文件不存在）仍由 load_pet_settings 返回默认值。
    let previous = pet_store::load_pet_settings(&app)?;
    let settings = pet_store::save_pet_settings(&app, settings)?;
    if let Err(error) =
        pet_care::synchronize_enabled(&app, previous.care_enabled, settings.care_enabled)
    {
        let _ = pet_store::save_pet_settings(&app, previous);
        return Err(error);
    }
    if let Err(error) = synchronize(&app, &settings) {
        let _ = pet_store::save_pet_settings(&app, previous.clone());
        let _ = pet_care::synchronize_enabled(&app, settings.care_enabled, previous.care_enabled);
        let _ = synchronize(&app, &previous);
        return Err(error);
    }
    Ok(settings)
}

/// 调整桌宠快捷卡片的原生窗口空间，透明区域不会在收起时阻挡桌面点击。
#[tauri::command]
pub fn set_pet_window_expanded(app: AppHandle, expanded: bool) -> Result<(), String> {
    let runtime = app.state::<PetWindowRuntime>();
    let previous = {
        let mut state = runtime
            .expanded
            .lock()
            .map_err(|_| "宠物窗口展开状态不可用".to_string())?;
        let previous = *state;
        *state = expanded;
        previous
    };
    let settings = pet_store::load_pet_settings(&app)?;
    if let Err(error) = synchronize(&app, &settings) {
        *runtime
            .expanded
            .lock()
            .map_err(|_| "宠物窗口展开状态不可用".to_string())? = previous;
        let _ = synchronize(&app, &settings);
        return Err(error);
    }
    Ok(())
}

#[tauri::command]
pub fn get_pet_window_context(
    app: AppHandle,
    state: tauri::State<'_, PetWindowRuntime>,
) -> Result<PetWindowContext, String> {
    let state_value = state
        .activity
        .lock()
        .map_err(|_| "宠物活动状态不可用".to_string())?
        .clone();
    Ok(PetWindowContext {
        settings: pet_store::load_pet_settings(&app)?,
        activity: PetActivity {
            state: state_value.state,
            revision: state.revision.load(Ordering::Acquire),
            activities: state_value.activities,
            attention: state_value.attention,
            target: state_value.target,
        },
    })
}

/// 显示已经启用的宠物窗口；保持异步以允许缺失窗口被安全地重新创建。
#[tauri::command]
pub async fn show_pet_window(app: AppHandle) -> Result<(), String> {
    let settings = pet_store::load_pet_settings(&app)?;
    if !settings.enabled {
        return Ok(());
    }
    synchronize(&app, &settings)?;
    let window = app
        .get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "宠物窗口尚未创建".to_string())?;
    window
        .show()
        .map_err(|error| format!("显示宠物窗口失败：{error}"))
}

#[tauri::command]
pub fn begin_pet_window_drag(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "宠物窗口尚未创建".to_string())?;
    window
        .start_dragging()
        .map_err(|error| format!("拖动宠物窗口失败：{error}"))
}

#[tauri::command]
pub fn get_pet_pointer_context(app: AppHandle) -> Result<PetPointerContext, String> {
    let window = app
        .get_webview_window(PET_WINDOW_LABEL)
        .ok_or_else(|| "宠物窗口尚未创建".to_string())?;
    let cursor = app
        .cursor_position()
        .map_err(|error| format!("读取系统指针位置失败：{error}"))?;
    let position = window
        .outer_position()
        .map_err(|error| format!("读取宠物窗口位置失败：{error}"))?;
    let size = window
        .outer_size()
        .map_err(|error| format!("读取宠物窗口尺寸失败：{error}"))?;
    let scale = window
        .scale_factor()
        .map_err(|error| format!("读取宠物窗口缩放比例失败：{error}"))?;
    let settings = pet_store::load_pet_settings(&app)?;
    let pet_side = physical_window_side(pet_window_side(settings.size), scale);
    let pet_position =
        pet_position_from_window(position, size.width, size.height, pet_side, settings.anchor);
    Ok(pointer_context(
        cursor,
        pet_position,
        pet_side,
        pet_side,
        scale,
    ))
}

#[tauri::command]
pub fn update_pet_activity(
    app: AppHandle,
    state: tauri::State<'_, PetWindowRuntime>,
    activity: PetActivityUpdate,
) -> Result<(), String> {
    validate_activity(&activity)?;
    *state
        .activity
        .lock()
        .map_err(|_| "宠物活动状态不可用".to_string())? = activity.clone();
    let revision = state.revision.fetch_add(1, Ordering::AcqRel) + 1;
    if let Some(window) = app.get_webview_window(PET_WINDOW_LABEL) {
        window
            .emit(
                PET_ACTIVITY_EVENT,
                PetActivity {
                    state: activity.state,
                    revision,
                    activities: activity.activities,
                    attention: activity.attention,
                    target: activity.target,
                },
            )
            .map_err(|error| format!("更新宠物任务状态失败：{error}"))?;
    }
    Ok(())
}

/// 把桌宠窗口中的受限语义动作转交给主窗口；桌宠本身不持有 DSH Bridge。
#[tauri::command]
pub fn dispatch_pet_action(
    app: AppHandle,
    state: tauri::State<'_, PetWindowRuntime>,
    action: PetAction,
) -> Result<(), String> {
    validate_action(&action)?;
    {
        let activity = state
            .activity
            .lock()
            .map_err(|_| "宠物活动状态不可用".to_string())?;
        validate_action_against_activity(&action, &activity)?;
    }
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "Deeptop 主窗口不可用".to_string())?;
    if action.kind == PetActionKind::Open {
        main.unminimize()
            .map_err(|error| format!("恢复 Deeptop 主窗口失败：{error}"))?;
        main.show()
            .map_err(|error| format!("显示 Deeptop 主窗口失败：{error}"))?;
        main.set_focus()
            .map_err(|error| format!("聚焦 Deeptop 主窗口失败：{error}"))?;
    }
    main.emit(PET_ACTION_EVENT, action)
        .map_err(|error| format!("转发桌宠快捷动作失败：{error}"))
}

#[cfg(test)]
mod tests {
    use super::super::store::{PetAnchor, PetWindowPlacement};
    use super::{
        anchored_position, pet_position_from_window, pet_window_dimensions, pet_window_side,
        pointer_context, restored_position, validate_action, validate_action_against_activity,
        validate_activity, visible_position, window_position_from_pet, MonitorWorkArea, PetAction,
        PetActionKind, PetActivityState, PetActivityUpdate, PetAttention, PetAttentionKind,
        PetSessionTarget,
    };
    use tauri::PhysicalPosition;

    #[test]
    fn adds_a_tight_interaction_margin_around_the_pet() {
        assert_eq!(pet_window_side(56), 88);
        assert_eq!(pet_window_side(88), 120);
        assert_eq!(pet_window_side(160), 192);
    }

    #[test]
    fn anchors_inside_positive_and_negative_monitor_work_areas() {
        assert_eq!(
            anchored_position(PetAnchor::BottomRight, 0, 0, 1920, 1080, 120, 120),
            PhysicalPosition::new(1788, 948)
        );
        assert_eq!(
            anchored_position(PetAnchor::BottomLeft, -1920, 0, 1920, 1080, 120, 120),
            PhysicalPosition::new(-1908, 948)
        );
    }

    #[test]
    fn keeps_resized_windows_visible_without_resetting_safe_positions() {
        assert_eq!(
            visible_position(PhysicalPosition::new(1788, 900), 0, 0, 1920, 1040, 144, 144,),
            PhysicalPosition::new(1764, 884)
        );
        assert_eq!(
            visible_position(PhysicalPosition::new(640, 420), 0, 0, 1920, 1040, 144, 144,),
            PhysicalPosition::new(640, 420)
        );
    }

    #[test]
    fn restores_saved_positions_on_the_monitor_with_visible_overlap() {
        let work_areas = [
            MonitorWorkArea {
                x: -1920,
                y: 0,
                width: 1920,
                height: 1040,
                scale_factor: 1.0,
            },
            MonitorWorkArea {
                x: 0,
                y: 0,
                width: 1920,
                height: 1040,
                scale_factor: 1.25,
            },
        ];
        assert_eq!(
            restored_position(
                PetWindowPlacement {
                    anchor: PetAnchor::BottomRight,
                    x: -1700,
                    y: 700,
                },
                PetAnchor::BottomRight,
                120,
                &work_areas,
            ),
            Some((PhysicalPosition::new(-1700, 700), work_areas[0]))
        );
    }

    #[test]
    fn expands_the_card_without_moving_the_pet_anchor() {
        assert_eq!(pet_window_dimensions(88, false), (120, 120));
        assert_eq!(pet_window_dimensions(88, true), (424, 320));
        let pet = PhysicalPosition::new(1788, 908);
        for anchor in [PetAnchor::BottomLeft, PetAnchor::BottomRight] {
            let window = window_position_from_pet(pet, 424, 320, 120, anchor);
            assert_eq!(pet_position_from_window(window, 424, 320, 120, anchor), pet);
        }
    }

    #[test]
    fn ignores_stale_anchors_and_disconnected_monitor_positions() {
        let work_areas = [MonitorWorkArea {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
            scale_factor: 1.0,
        }];
        let placement = PetWindowPlacement {
            anchor: PetAnchor::BottomLeft,
            x: -1700,
            y: 700,
        };
        assert_eq!(
            restored_position(placement, PetAnchor::BottomRight, 120, &work_areas),
            None
        );
        assert_eq!(
            restored_position(placement, PetAnchor::BottomLeft, 120, &work_areas),
            None
        );
    }

    #[test]
    fn reports_global_cursor_delta_in_logical_pixels() {
        let context = pointer_context(
            tauri::PhysicalPosition::new(300.0, 80.0),
            PhysicalPosition::new(100, 40),
            200,
            120,
            2.0,
        );
        assert_eq!(context.delta_x, 50.0);
        assert_eq!(context.delta_y, -10.0);
        assert!((context.distance - 50.990_195).abs() < 0.000_001);
    }

    #[test]
    fn validates_only_bounded_status_and_quick_action_payloads() {
        let target = PetSessionTarget {
            session_id: "session-1".to_string(),
            title: "构建任务".to_string(),
        };
        let attention = PetAttention {
            id: "approval:rpc-1".to_string(),
            kind: PetAttentionKind::Approval,
            session_id: target.session_id.clone(),
            title: target.title.clone(),
            message: "需要执行命令".to_string(),
            tool_name: Some("shell".to_string()),
            options: Vec::new(),
            can_reply: false,
        };
        let activity = PetActivityUpdate {
            state: PetActivityState::Waiting,
            activities: vec![attention.clone()],
            attention: Some(attention),
            target: Some(target),
        };
        assert_eq!(validate_activity(&activity), Ok(()));
        assert_eq!(
            validate_action(&PetAction {
                kind: PetActionKind::Reply,
                session_id: "session-1".to_string(),
                activity_id: None,
                text: Some("继续检查".to_string()),
                selected_option: None,
            }),
            Ok(())
        );
        assert!(validate_action(&PetAction {
            kind: PetActionKind::ApprovalAllow,
            session_id: "session-1".to_string(),
            activity_id: Some("approval:rpc-1".to_string()),
            text: Some("unexpected".to_string()),
            selected_option: None,
        })
        .is_err());
        assert_eq!(
            validate_action_against_activity(
                &PetAction {
                    kind: PetActionKind::ApprovalAllow,
                    session_id: "session-1".to_string(),
                    activity_id: Some("approval:rpc-1".to_string()),
                    text: None,
                    selected_option: None,
                },
                &activity,
            ),
            Ok(())
        );
        assert!(validate_action_against_activity(
            &PetAction {
                kind: PetActionKind::Reply,
                session_id: "session-1".to_string(),
                activity_id: Some("approval:rpc-1".to_string()),
                text: Some("继续检查".to_string()),
                selected_option: None,
            },
            &activity,
        )
        .is_err());
    }

    #[test]
    fn validates_actions_against_the_selected_activity_instead_of_only_the_first_item() {
        let approval = PetAttention {
            id: "approval:rpc-1".to_string(),
            kind: PetAttentionKind::Approval,
            session_id: "session-1".to_string(),
            title: "权限会话".to_string(),
            message: "需要执行命令".to_string(),
            tool_name: Some("shell".to_string()),
            options: Vec::new(),
            can_reply: false,
        };
        let completion = PetAttention {
            id: "completed:session-2:2".to_string(),
            kind: PetAttentionKind::Completed,
            session_id: "session-2".to_string(),
            title: "完成会话".to_string(),
            message: "检查已经完成".to_string(),
            tool_name: None,
            options: Vec::new(),
            can_reply: true,
        };
        let activity = PetActivityUpdate {
            state: PetActivityState::Waiting,
            activities: vec![approval.clone(), completion.clone()],
            attention: Some(approval.clone()),
            target: Some(PetSessionTarget {
                session_id: approval.session_id,
                title: approval.title,
            }),
        };

        assert_eq!(
            validate_action_against_activity(
                &PetAction {
                    kind: PetActionKind::Reply,
                    session_id: completion.session_id,
                    activity_id: Some(completion.id),
                    text: Some("继续补充测试".to_string()),
                    selected_option: None,
                },
                &activity,
            ),
            Ok(())
        );
    }
}
