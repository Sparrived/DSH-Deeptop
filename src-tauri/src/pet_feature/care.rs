use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Instant, SystemTime},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use super::store::{self, PetAnimationState};

const PET_CARE_FILE: &str = "pet-care-state.json";
const PET_CARE_EVENT: &str = "deeptop-pet-care-changed";
const PET_CARE_SCHEMA_VERSION: u8 = 1;
const MAX_OFFLINE_MS: u64 = 24 * 60 * 60 * 1_000;
const SATIETY_DECAY_PER_HOUR: f64 = 1.6;
const MOOD_DECAY_PER_HOUR: f64 = 0.7;
const HUNGRY_MOOD_DECAY_PER_HOUR: f64 = 0.6;
const CARE_ACTION_SPACING_MS: u64 = 5_000;
const MEAL_COOLDOWN_MS: u64 = 30 * 60 * 1_000;
const TREAT_COOLDOWN_MS: u64 = 10 * 60 * 1_000;
const PET_COOLDOWN_MS: u64 = 60 * 1_000;
const PLAY_COOLDOWN_MS: u64 = 5 * 60 * 1_000;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetCareCondition {
    Happy,
    Content,
    Hungry,
    Lonely,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct PetCareActionReadyAtMs {
    meal: u64,
    treat: u64,
    pet: u64,
    play: u64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetCareActionAllowed {
    meal: bool,
    treat: bool,
    pet: bool,
    play: bool,
}

impl PetCareActionReadyAtMs {
    fn get(self, action: PetCareActionKind) -> u64 {
        match action {
            PetCareActionKind::Meal => self.meal,
            PetCareActionKind::Treat => self.treat,
            PetCareActionKind::Pet => self.pet,
            PetCareActionKind::Play => self.play,
        }
    }

    fn set(&mut self, action: PetCareActionKind, ready_at_ms: u64) {
        match action {
            PetCareActionKind::Meal => self.meal = ready_at_ms,
            PetCareActionKind::Treat => self.treat = ready_at_ms,
            PetCareActionKind::Pet => self.pet = ready_at_ms,
            PetCareActionKind::Play => self.play = ready_at_ms,
        }
    }

    fn defer_all(&mut self, ready_at_ms: u64) {
        self.meal = self.meal.max(ready_at_ms);
        self.treat = self.treat.max(ready_at_ms);
        self.pet = self.pet.max(ready_at_ms);
        self.play = self.play.max(ready_at_ms);
    }

    fn normalize(&mut self, now: u64) {
        self.meal = self.meal.min(now.saturating_add(MEAL_COOLDOWN_MS));
        self.treat = self.treat.min(now.saturating_add(TREAT_COOLDOWN_MS));
        self.pet = self.pet.min(now.saturating_add(PET_COOLDOWN_MS));
        self.play = self.play.min(now.saturating_add(PLAY_COOLDOWN_MS));
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PetCareRecord {
    schema_version: u8,
    satiety: f64,
    mood: f64,
    affection: f64,
    updated_at_ms: u64,
    revision: u64,
    #[serde(default)]
    action_ready_at_ms: PetCareActionReadyAtMs,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetCareState {
    schema_version: u8,
    satiety: f64,
    mood: f64,
    affection: f64,
    updated_at_ms: u64,
    revision: u64,
    condition: PetCareCondition,
    action_ready_at_ms: PetCareActionReadyAtMs,
    action_allowed: PetCareActionAllowed,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetCareActionKind {
    Meal,
    Treat,
    Pet,
    Play,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PetCareActionResult {
    state: PetCareState,
    accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reaction: Option<PetAnimationState>,
    message: String,
}

/// 序列化对 pet-care-state.json 的读-改-写：宠物窗口与设置面板可能并发
/// 触发喂食/查询/开关，交错写入会互相覆盖冷却与进度；write_atomic 的
/// rename 替换间隙里文件瞬时缺失，未加锁的读取会把默认值回写冲掉真实数据。
static CARE_STATE_LOCK: Mutex<()> = Mutex::new(());

fn lock_care_state() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    CARE_STATE_LOCK
        .lock()
        .map_err(|_| "宠物养成状态写入冲突".to_string())
}

/// 进程内单调基准钟：以进程首次读取时刻的墙钟为起点，叠加 Instant 的
/// 单调增量。运行期间把系统时钟向前拨不再能跳过养成冷却或放大离线结算；
/// 跨重启仍以墙钟为基准（关闭应用期间改钟属于可接受的残余风险）。
struct MonotonicClock {
    wall_ms_at_start: u64,
    started: Instant,
}

static CARE_CLOCK: OnceLock<MonotonicClock> = OnceLock::new();

fn now_ms() -> Result<u64, String> {
    let clock = CARE_CLOCK.get_or_init(|| MonotonicClock {
        wall_ms_at_start: SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|value| u64::try_from(value.as_millis()).unwrap_or(0))
            .unwrap_or(0),
        started: Instant::now(),
    });
    let value = u64::try_from(clock.started.elapsed().as_millis())
        .map_err(|_| "系统时间超出支持范围".to_string())?;
    Ok(clock.wall_ms_at_start.saturating_add(value))
}

fn default_record(now: u64) -> PetCareRecord {
    PetCareRecord {
        schema_version: PET_CARE_SCHEMA_VERSION,
        satiety: 78.0,
        mood: 72.0,
        affection: 12.0,
        updated_at_ms: now,
        revision: 0,
        action_ready_at_ms: PetCareActionReadyAtMs::default(),
    }
}

fn care_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(PET_CARE_FILE))
        .map_err(|error| format!("无法定位 Deeptop 配置目录：{error}"))
}

fn clamp_score(value: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(0.0, 100.0)
    } else {
        fallback
    }
}

fn normalize_record(mut record: PetCareRecord, now: u64) -> Result<PetCareRecord, String> {
    if record.schema_version != PET_CARE_SCHEMA_VERSION {
        return Err(format!(
            "不支持的宠物养成数据版本：{}",
            record.schema_version
        ));
    }
    record.satiety = clamp_score(record.satiety, 78.0);
    record.mood = clamp_score(record.mood, 72.0);
    record.affection = clamp_score(record.affection, 12.0);
    if record.updated_at_ms > now {
        record.updated_at_ms = now;
    }
    record.action_ready_at_ms.normalize(now);
    Ok(record)
}

fn load_record(app: &AppHandle, now: u64) -> Result<PetCareRecord, String> {
    let path = care_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(default_record(now));
        }
        Err(error) => return Err(format!("读取宠物养成状态失败：{error}")),
    };
    let record =
        serde_json::from_str(&content).map_err(|error| format!("解析宠物养成状态失败：{error}"))?;
    normalize_record(record, now)
}

fn save_record(app: &AppHandle, record: &PetCareRecord) -> Result<(), String> {
    let content = serde_json::to_string_pretty(record)
        .map_err(|error| format!("编码宠物养成状态失败：{error}"))?;
    store::write_atomic(&care_path(app)?, format!("{content}\n").as_bytes())
}

fn condition(record: &PetCareRecord) -> PetCareCondition {
    if record.satiety <= 30.0 {
        return PetCareCondition::Hungry;
    }
    if record.mood <= 35.0 {
        return PetCareCondition::Lonely;
    }
    if record.satiety >= 70.0 && record.mood >= 75.0 {
        return PetCareCondition::Happy;
    }
    PetCareCondition::Content
}

fn state_from_record(record: &PetCareRecord) -> PetCareState {
    PetCareState {
        schema_version: record.schema_version,
        satiety: record.satiety,
        mood: record.mood,
        affection: record.affection,
        updated_at_ms: record.updated_at_ms,
        revision: record.revision,
        condition: condition(record),
        action_ready_at_ms: record.action_ready_at_ms,
        action_allowed: action_allowed(record),
    }
}

fn action_allowed(record: &PetCareRecord) -> PetCareActionAllowed {
    PetCareActionAllowed {
        meal: record.satiety <= 80.0,
        treat: record.satiety <= 90.0,
        pet: record.mood < 100.0 || record.affection < 100.0,
        play: record.satiety > 20.0 && record.mood < 94.0,
    }
}

fn advance_record(record: &mut PetCareRecord, now: u64, enabled: bool) {
    let elapsed_ms = now.saturating_sub(record.updated_at_ms).min(MAX_OFFLINE_MS);
    record.updated_at_ms = now;
    if !enabled || elapsed_ms == 0 {
        return;
    }

    let elapsed_hours = elapsed_ms as f64 / 3_600_000.0;
    let previous_satiety = record.satiety;
    let previous_mood = record.mood;
    record.satiety = (record.satiety - elapsed_hours * SATIETY_DECAY_PER_HOUR).max(0.0);
    let hungry_decay = if record.satiety <= 30.0 {
        HUNGRY_MOOD_DECAY_PER_HOUR
    } else {
        0.0
    };
    record.mood = (record.mood - elapsed_hours * (MOOD_DECAY_PER_HOUR + hungry_decay)).max(0.0);
    if record.satiety != previous_satiety || record.mood != previous_mood {
        record.revision = record.revision.saturating_add(1);
    }
}

fn increase(value: &mut f64, amount: f64) {
    *value = (*value + amount).clamp(0.0, 100.0);
}

fn action_cooldown_ms(action: PetCareActionKind) -> u64 {
    match action {
        PetCareActionKind::Meal => MEAL_COOLDOWN_MS,
        PetCareActionKind::Treat => TREAT_COOLDOWN_MS,
        PetCareActionKind::Pet => PET_COOLDOWN_MS,
        PetCareActionKind::Play => PLAY_COOLDOWN_MS,
    }
}

fn wait_label(remaining_ms: u64) -> String {
    let seconds = remaining_ms.saturating_add(999) / 1_000;
    if seconds < 60 {
        return format!("{seconds} 秒");
    }
    let minutes = seconds.saturating_add(59) / 60;
    format!("{minutes} 分钟")
}

fn cooldown_message(action: PetCareActionKind, remaining_ms: u64) -> String {
    let wait = wait_label(remaining_ms);
    match action {
        PetCareActionKind::Meal => format!("刚吃过正餐，{wait}后再喂吧"),
        PetCareActionKind::Treat => format!("点心要慢慢吃，{wait}后再来吧"),
        PetCareActionKind::Pet => format!("已经收到摸摸啦，{wait}后再陪陪它吧"),
        PetCareActionKind::Play => format!("刚玩过一轮，{wait}后再玩吧"),
    }
}

fn apply_action(
    record: &mut PetCareRecord,
    action: PetCareActionKind,
    now: u64,
) -> (bool, Option<PetAnimationState>, String) {
    let ready_at_ms = record.action_ready_at_ms.get(action);
    if ready_at_ms > now {
        return (
            false,
            None,
            cooldown_message(action, ready_at_ms.saturating_sub(now)),
        );
    }

    let (reaction, message) = match action {
        PetCareActionKind::Meal if record.satiety > 80.0 => {
            return (false, None, "现在还不饿，晚一点再喂正餐吧".to_string());
        }
        PetCareActionKind::Treat if record.satiety > 90.0 => {
            return (false, None, "点心也吃不下啦，晚一点再来吧".to_string());
        }
        PetCareActionKind::Pet if record.mood >= 100.0 && record.affection >= 100.0 => {
            return (false, None, "现在已经很满足啦，陪它待一会儿吧".to_string());
        }
        PetCareActionKind::Play if record.satiety <= 20.0 => {
            return (false, None, "肚子有点饿，先吃点东西再玩吧".to_string());
        }
        PetCareActionKind::Play if record.mood >= 94.0 => {
            return (
                false,
                None,
                "现在已经玩得很开心啦，先休息一下吧".to_string(),
            );
        }
        PetCareActionKind::Meal => {
            increase(&mut record.satiety, 18.0);
            increase(&mut record.mood, 2.0);
            increase(&mut record.affection, 0.5);
            (Some(PetAnimationState::Waving), "吃饱啦，感觉安心多了")
        }
        PetCareActionKind::Treat => {
            increase(&mut record.satiety, 6.0);
            increase(&mut record.mood, 5.0);
            increase(&mut record.affection, 0.5);
            (Some(PetAnimationState::Waving), "点心很好吃，心情变好了")
        }
        PetCareActionKind::Pet => {
            increase(&mut record.mood, 3.0);
            increase(&mut record.affection, 0.75);
            (
                Some(PetAnimationState::Waving),
                "被认真摸摸了，正在悄悄亲近你",
            )
        }
        PetCareActionKind::Play => {
            record.satiety = (record.satiety - 6.0).max(0.0);
            increase(&mut record.mood, 7.0);
            increase(&mut record.affection, 1.25);
            (Some(PetAnimationState::Jumping), "玩得很开心，还想再来一次")
        }
    };

    record
        .action_ready_at_ms
        .defer_all(now.saturating_add(CARE_ACTION_SPACING_MS));
    record
        .action_ready_at_ms
        .set(action, now.saturating_add(action_cooldown_ms(action)));
    (true, reaction, message.to_string())
}

pub(crate) fn load_current(app: &AppHandle, enabled: bool) -> Result<PetCareState, String> {
    let _guard = lock_care_state()?;
    let now = now_ms()?;
    let mut record = load_record(app, now)?;
    advance_record(&mut record, now, enabled);
    save_record(app, &record)?;
    Ok(state_from_record(&record))
}

pub fn synchronize_enabled(
    app: &AppHandle,
    was_enabled: bool,
    is_enabled: bool,
) -> Result<(), String> {
    if was_enabled == is_enabled {
        return Ok(());
    }
    let _guard = lock_care_state()?;
    let now = now_ms()?;
    let mut record = load_record(app, now)?;
    advance_record(&mut record, now, was_enabled);
    save_record(app, &record)?;
    app.emit(PET_CARE_EVENT, state_from_record(&record))
        .map_err(|error| format!("更新宠物养成状态失败：{error}"))
}

#[tauri::command]
pub fn get_pet_care_state(app: AppHandle) -> Result<PetCareState, String> {
    let settings = store::load_pet_settings(&app)?;
    load_current(&app, settings.care_enabled)
}

#[tauri::command]
pub fn perform_pet_care_action(
    app: AppHandle,
    action: PetCareActionKind,
) -> Result<PetCareActionResult, String> {
    let settings = store::load_pet_settings(&app)?;
    if !settings.care_enabled {
        return Err("养成互动已关闭".to_string());
    }
    let _guard = lock_care_state()?;
    let now = now_ms()?;
    let mut record = load_record(&app, now)?;
    advance_record(&mut record, now, true);
    let (accepted, reaction, message) = apply_action(&mut record, action, now);
    if accepted {
        record.revision = record.revision.saturating_add(1);
    }
    save_record(&app, &record)?;
    let state = state_from_record(&record);
    app.emit(PET_CARE_EVENT, state.clone())
        .map_err(|error| format!("更新宠物养成状态失败：{error}"))?;
    Ok(PetCareActionResult {
        state,
        accepted,
        reaction,
        message,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        action_allowed, advance_record, apply_action, condition, default_record, PetCareActionKind,
        PetCareActionReadyAtMs, PetCareCondition, PetCareRecord, CARE_ACTION_SPACING_MS,
        MAX_OFFLINE_MS, PET_COOLDOWN_MS,
    };

    #[test]
    fn advances_gently_and_caps_offline_decay() {
        let mut record = default_record(1_000);
        advance_record(&mut record, 1_000 + MAX_OFFLINE_MS * 3, true);
        assert!((record.satiety - 39.6).abs() < 0.001);
        assert!((record.mood - 55.2).abs() < 0.001);
        assert_eq!(record.updated_at_ms, 1_000 + MAX_OFFLINE_MS * 3);
        assert_eq!(record.revision, 1);
    }

    #[test]
    fn pauses_decay_when_care_is_disabled() {
        let mut record = default_record(1_000);
        advance_record(&mut record, 1_000 + MAX_OFFLINE_MS, false);
        assert_eq!(record.satiety, 78.0);
        assert_eq!(record.mood, 72.0);
        assert_eq!(record.revision, 0);
    }

    #[test]
    fn applies_balanced_food_and_interaction_gains() {
        let mut meal = default_record(1_000);
        let (accepted, _, _) = apply_action(&mut meal, PetCareActionKind::Meal, 1_000);
        assert!(accepted);
        assert_eq!(meal.satiety, 96.0);
        assert_eq!(meal.mood, 74.0);
        assert_eq!(meal.affection, 12.5);

        let mut treat = default_record(1_000);
        let (accepted, _, _) = apply_action(&mut treat, PetCareActionKind::Treat, 1_000);
        assert!(accepted);
        assert_eq!(treat.satiety, 84.0);
        assert_eq!(treat.mood, 77.0);
        assert_eq!(treat.affection, 12.5);

        let mut pet = default_record(1_000);
        let (accepted, _, _) = apply_action(&mut pet, PetCareActionKind::Pet, 1_000);
        assert!(accepted);
        assert_eq!(pet.mood, 75.0);
        assert_eq!(pet.affection, 12.75);

        let mut play = default_record(1_000);
        let (accepted, _, _) = apply_action(&mut play, PetCareActionKind::Play, 1_000);
        assert!(accepted);
        assert_eq!(play.satiety, 72.0);
        assert_eq!(play.mood, 79.0);
        assert_eq!(play.affection, 13.25);
    }

    #[test]
    fn persists_per_action_cooldowns_and_spaces_different_actions() {
        let now = 1_000;
        let mut record = default_record(now);
        assert!(apply_action(&mut record, PetCareActionKind::Pet, now).0);
        assert_eq!(record.action_ready_at_ms.pet, now + PET_COOLDOWN_MS);
        assert_eq!(record.action_ready_at_ms.play, now + CARE_ACTION_SPACING_MS);
        let repeated = apply_action(&mut record, PetCareActionKind::Pet, now + 1_000);
        assert!(!repeated.0);
        assert!(repeated.2.contains("59 秒"));
        assert!(
            !apply_action(
                &mut record,
                PetCareActionKind::Play,
                now + CARE_ACTION_SPACING_MS - 1,
            )
            .0
        );
        assert!(
            apply_action(
                &mut record,
                PetCareActionKind::Play,
                now + CARE_ACTION_SPACING_MS,
            )
            .0
        );
    }

    #[test]
    fn refuses_overfeeding_and_playing_without_capacity() {
        let mut meal = default_record(1_000);
        meal.satiety = 81.0;
        assert!(!apply_action(&mut meal, PetCareActionKind::Meal, 1_000).0);

        let mut treat = default_record(1_000);
        treat.satiety = 91.0;
        assert!(!apply_action(&mut treat, PetCareActionKind::Treat, 1_000).0);

        let mut hungry = default_record(1_000);
        hungry.satiety = 20.0;
        assert!(!apply_action(&mut hungry, PetCareActionKind::Play, 1_000).0);

        let mut cheerful = default_record(1_000);
        cheerful.mood = 94.0;
        assert!(!apply_action(&mut cheerful, PetCareActionKind::Play, 1_000).0);

        let mut fulfilled = default_record(1_000);
        fulfilled.mood = 100.0;
        fulfilled.affection = 100.0;
        assert!(!apply_action(&mut fulfilled, PetCareActionKind::Pet, 1_000).0);
        assert!(!action_allowed(&fulfilled).pet);
    }

    #[test]
    fn loads_existing_care_state_without_cooldown_fields() {
        let record: PetCareRecord = serde_json::from_value(serde_json::json!({
            "schemaVersion": 1,
            "satiety": 78.0,
            "mood": 72.0,
            "affection": 12.0,
            "updatedAtMs": 1_000,
            "revision": 0
        }))
        .expect("legacy care state should remain readable");
        assert_eq!(record.action_ready_at_ms, PetCareActionReadyAtMs::default());
    }

    #[test]
    fn derives_visible_conditions_from_shared_state() {
        let mut record = default_record(1_000);
        record.satiety = 20.0;
        assert_eq!(condition(&record), PetCareCondition::Hungry);
        record.satiety = 60.0;
        record.mood = 20.0;
        assert_eq!(condition(&record), PetCareCondition::Lonely);
        record.satiety = 80.0;
        record.mood = 90.0;
        assert_eq!(condition(&record), PetCareCondition::Happy);
    }
}
