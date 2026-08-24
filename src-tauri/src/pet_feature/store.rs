//! Script-free pet package storage, validation, import, export and settings.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::{GenericImageView, ImageFormat};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipArchive, ZipWriter};

/// pick_pet_bundle 记录的候选包：canonical 路径 → 选取时的 SHA-256。
/// install_pet_bundle 只接受此表内的路径并复核文件未被替换，
/// 阻断对任意路径的读取探测与 pick→install 之间的 TOCTOU。
#[derive(Default)]
pub struct PickedBundles(Mutex<HashMap<PathBuf, String>>);

impl PickedBundles {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, HashMap<PathBuf, String>>, String> {
        self.0
            .lock()
            .map_err(|_| "宠物包选择记录不可用".to_string())
    }

    fn record(&self, path: PathBuf, sha256: String) -> Result<(), String> {
        self.lock()?.insert(path, sha256);
        Ok(())
    }

    /// 取出（消费）记录的哈希；每次选取只能用于一次安装。
    fn take(&self, path: &Path) -> Result<Option<String>, String> {
        Ok(self.lock()?.remove(path))
    }
}

const SETTINGS_FILE: &str = "pet-settings.json";
const WINDOW_PLACEMENT_FILE: &str = "pet-window-placement.json";
const PETS_DIRECTORY: &str = "pets";
const STARTER_PETS_MARKER_FILE: &str = ".starter-pets-initialized";
const PET_BUNDLE_EXTENSION: &str = "deeptop-pet";
const PET_BUNDLE_KIND: &str = "deeptop-pet";
const PET_RUNTIME_PROFILE: &str = "deeptop";
const PET_SCHEMA_VERSION: u32 = 2;
const PET_SPRITE_VERSION: u32 = 2;
const PET_DEFINITION_FILE: &str = "pet.json";
const DEEPTOP_MANIFEST_FILE: &str = "deeptop.json";
const PET_SPRITESHEET_FILE: &str = "spritesheet.webp";
const PET_CELL_WIDTH: u32 = 192;
const PET_CELL_HEIGHT: u32 = 208;
const PET_ATLAS_WIDTH: u32 = 1536;
const PET_ATLAS_HEIGHT: u32 = 2288;
// The standard atlas reserves row 0, column 6 as the neutral/front look cell in addition to six idle frames.
const PET_USED_COLUMNS: [usize; 11] = [7, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
const MAX_BUNDLE_BYTES: u64 = 12 * 1024 * 1024;
const MAX_MANIFEST_BYTES: u64 = 64 * 1024;
const MAX_ASSET_BYTES: u64 = 10 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 3;
const MAX_INTERACTIONS: usize = 32;
const MAX_INSTALLED_PETS: usize = 64;

struct StarterPet {
    id: &'static str,
    pet_json: &'static [u8],
    deeptop_json: &'static [u8],
    spritesheet: &'static [u8],
}

const STARTER_PETS: [StarterPet; 2] = [
    StarterPet {
        id: "io.github.suakitsu.whale-maid-bubble",
        pet_json: include_bytes!("../../../examples/pets/whale-maid/pet.json"),
        deeptop_json: include_bytes!("../../../examples/pets/whale-maid/deeptop.json"),
        spritesheet: include_bytes!("../../../examples/pets/whale-maid/spritesheet.webp"),
    },
    StarterPet {
        id: "io.github.suakitsu.sawatari-shizuku",
        pet_json: include_bytes!("../../../examples/pets/sawatari-shizuku/pet.json"),
        deeptop_json: include_bytes!("../../../examples/pets/sawatari-shizuku/deeptop.json"),
        spritesheet: include_bytes!("../../../examples/pets/sawatari-shizuku/spritesheet.webp"),
    },
];

fn default_selected_pet_id() -> String {
    String::new()
}

fn default_pet_size() -> u16 {
    112
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetAnchor {
    BottomLeft,
    #[default]
    BottomRight,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct PetSettings {
    pub enabled: bool,
    pub selected_pet_id: String,
    pub anchor: PetAnchor,
    pub size: u16,
    pub motion_enabled: bool,
    pub interactions_enabled: bool,
    pub care_enabled: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetWindowPlacement {
    pub anchor: PetAnchor,
    pub x: i32,
    pub y: i32,
}

impl Default for PetSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            selected_pet_id: default_selected_pet_id(),
            anchor: PetAnchor::BottomRight,
            size: default_pet_size(),
            motion_enabled: default_true(),
            interactions_enabled: default_true(),
            care_enabled: default_true(),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PetInteractionEvent {
    PointerEnter,
    PointerLeave,
    Tap,
    DoubleTap,
    LongPress,
    DragStart,
    DragEnd,
    IdleTimeout,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum PetAnimationState {
    Idle,
    RunningRight,
    RunningLeft,
    Waving,
    Jumping,
    Failed,
    Waiting,
    Running,
    Review,
}

impl PetAnimationState {
    fn loops(self) -> bool {
        matches!(
            self,
            Self::Idle | Self::RunningRight | Self::RunningLeft | Self::Waiting | Self::Running
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PetInteraction {
    pub on: PetInteractionEvent,
    pub play: PetAnimationState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub then: Option<PetAnimationState>,
    pub cooldown_ms: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PetDefinition {
    id: String,
    display_name: String,
    #[serde(default)]
    description: Option<String>,
    sprite_version_number: u32,
    spritesheet_path: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DeeptopPetManifest {
    kind: String,
    schema_version: u32,
    runtime_profile: String,
    version: String,
    author: String,
    license: String,
    #[serde(default)]
    interactions: Option<Vec<PetInteraction>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetCanvas {
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetManifest {
    pub kind: String,
    pub schema_version: u32,
    pub runtime_profile: String,
    pub id: String,
    pub version: String,
    pub name: String,
    pub author: String,
    pub license: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub canvas: PetCanvas,
    pub sprite_version_number: u32,
    pub spritesheet_path: String,
    pub interactions: Vec<PetInteraction>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetRuntimeAsset {
    pub media_type: String,
    pub data: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetBundle {
    pub manifest: PetManifest,
    pub assets: BTreeMap<String, PetRuntimeAsset>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetBundleDescriptor {
    pub id: String,
    pub version: String,
    pub name: String,
    pub author: String,
    pub license: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub canvas: PetCanvas,
    pub sprite_version_number: u32,
    pub built_in: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetLibrarySnapshot {
    pub directory: String,
    pub pets: Vec<PetBundleDescriptor>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PetBundleCandidate {
    pub path: String,
    pub pet: PetBundleDescriptor,
    pub replace_required: bool,
    pub sha256: String,
    pub size_bytes: u64,
}

fn default_interactions() -> Vec<PetInteraction> {
    vec![
        PetInteraction {
            on: PetInteractionEvent::PointerEnter,
            play: PetAnimationState::Waving,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 3_000,
        },
        PetInteraction {
            on: PetInteractionEvent::Tap,
            play: PetAnimationState::Waving,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 350,
        },
        PetInteraction {
            on: PetInteractionEvent::DoubleTap,
            play: PetAnimationState::Jumping,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 500,
        },
        PetInteraction {
            on: PetInteractionEvent::LongPress,
            play: PetAnimationState::Waving,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 700,
        },
        PetInteraction {
            on: PetInteractionEvent::DragEnd,
            play: PetAnimationState::Jumping,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 0,
        },
        PetInteraction {
            on: PetInteractionEvent::IdleTimeout,
            play: PetAnimationState::Waving,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 4_000,
        },
        PetInteraction {
            on: PetInteractionEvent::IdleTimeout,
            play: PetAnimationState::Jumping,
            then: Some(PetAnimationState::Idle),
            cooldown_ms: 4_000,
        },
    ]
}

fn app_config_directory(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|error| format!("无法定位 Deeptop 配置目录：{error}"))
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_directory(app)?.join(SETTINGS_FILE))
}

fn window_placement_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_directory(app)?.join(WINDOW_PLACEMENT_FILE))
}

pub fn pets_directory(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_directory(app)?.join(PETS_DIRECTORY))
}

fn ensure_pets_directory(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = pets_directory(app)?;
    fs::create_dir_all(&directory)
        .map_err(|error| format!("无法创建宠物目录 {}：{error}", directory.display()))?;
    seed_starter_pets(&directory)?;
    Ok(directory)
}

fn starter_pet_archive(starter: &StarterPet) -> Result<Vec<u8>, String> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    for (name, data) in [
        (PET_DEFINITION_FILE, starter.pet_json),
        (DEEPTOP_MANIFEST_FILE, starter.deeptop_json),
        (PET_SPRITESHEET_FILE, starter.spritesheet),
    ] {
        writer
            .start_file(name, options)
            .map_err(|error| format!("创建初始宠物包 {name} 失败：{error}"))?;
        writer
            .write_all(data)
            .map_err(|error| format!("写入初始宠物包 {name} 失败：{error}"))?;
    }
    writer
        .finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| format!("完成初始宠物包失败：{error}"))
}

fn seed_starter_pets(directory: &std::path::Path) -> Result<(), String> {
    let marker = directory.join(STARTER_PETS_MARKER_FILE);
    if marker.exists() {
        return Ok(());
    }
    for starter in &STARTER_PETS {
        let target = bundle_path(directory, starter.id)?;
        if target.exists() {
            continue;
        }
        let bytes = starter_pet_archive(starter)?;
        let bundle = parse_bundle_bytes_with_assets(&bytes, false)?;
        if bundle.manifest.id != starter.id {
            return Err(format!("初始宠物包 id 不匹配：{}", starter.id));
        }
        write_atomic(&target, &bytes)?;
    }
    write_atomic(&marker, b"initialized\n")
}

fn adjacent_path(path: &std::path::Path, suffix: &str) -> Result<PathBuf, String> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("无法生成 {} 的临时文件名", path.display()))?;
    Ok(path.with_file_name(format!(".{name}.{suffix}")))
}

pub(crate) fn write_atomic(path: &std::path::Path, data: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("无法定位 {} 的父目录", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("无法创建目录 {}：{error}", parent.display()))?;
    let temporary = adjacent_path(path, "tmp")?;
    let backup = adjacent_path(path, "bak")?;
    fs::write(&temporary, data)
        .map_err(|error| format!("写入临时文件 {} 失败：{error}", temporary.display()))?;
    if path.exists() {
        if let Err(error) = fs::remove_file(&backup) {
            if error.kind() != std::io::ErrorKind::NotFound {
                let _ = fs::remove_file(&temporary);
                return Err(format!("清理旧备份 {} 失败：{error}", backup.display()));
            }
        }
        if let Err(error) = fs::rename(path, &backup) {
            let _ = fs::remove_file(&temporary);
            return Err(format!("准备替换 {} 失败：{error}", path.display()));
        }
        if let Err(error) = fs::rename(&temporary, path) {
            let _ = fs::rename(&backup, path);
            let _ = fs::remove_file(&temporary);
            return Err(format!("替换 {} 失败：{error}", path.display()));
        }
        let _ = fs::remove_file(&backup);
    } else if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("保存 {} 失败：{error}", path.display()));
    }
    Ok(())
}

fn bundle_sha256(data: &[u8]) -> String {
    format!("{:x}", Sha256::digest(data))
}

fn verify_bundle_sha256(data: &[u8], expected_sha256: Option<&str>) -> Result<String, String> {
    let actual = bundle_sha256(data);
    let Some(expected) = expected_sha256 else {
        return Ok(actual);
    };
    if expected.len() != 64 || !expected.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("期望的宠物包 SHA-256 必须是 64 位十六进制字符串".to_string());
    }
    if !actual.eq_ignore_ascii_case(expected) {
        return Err(format!(
            "宠物包 SHA-256 不匹配：期望 {}，实际 {actual}",
            expected.to_ascii_lowercase()
        ));
    }
    Ok(actual)
}

fn valid_pet_id(id: &str) -> bool {
    let bytes = id.as_bytes();
    if !(3..=64).contains(&bytes.len()) {
        return false;
    }
    let is_edge = |byte: u8| byte.is_ascii_lowercase() || byte.is_ascii_digit();
    is_edge(bytes[0])
        && is_edge(bytes[bytes.len() - 1])
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        })
}

fn validate_text(label: &str, value: &str, minimum: usize, maximum: usize) -> Result<(), String> {
    let length = value.chars().count();
    if value.trim() != value || !(minimum..=maximum).contains(&length) {
        return Err(format!(
            "{label}长度必须为 {minimum}–{maximum} 个字符，且首尾不能有空白"
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(format!("{label}不能包含控制字符"));
    }
    Ok(())
}

fn validate_interactions(interactions: &[PetInteraction]) -> Result<(), String> {
    if interactions.len() > MAX_INTERACTIONS {
        return Err(format!("互动规则不能超过 {MAX_INTERACTIONS} 项"));
    }
    for (index, interaction) in interactions.iter().enumerate() {
        if interaction.cooldown_ms > 60_000 {
            return Err(format!("interactions[{index}].cooldownMs 不能超过 60000"));
        }
        if interaction.then.is_some() && interaction.play.loops() {
            return Err(format!("interactions[{index}] 的循环动画不能声明 then"));
        }
    }
    Ok(())
}

fn merge_manifest(
    definition: PetDefinition,
    deeptop: Option<DeeptopPetManifest>,
) -> Result<PetManifest, String> {
    if !valid_pet_id(&definition.id) {
        return Err("宠物 id 必须为 3–64 位小写字母、数字、点、下划线或连字符".to_string());
    }
    validate_text("宠物名称", &definition.display_name, 1, 80)?;
    if let Some(description) = &definition.description {
        validate_text("宠物描述", description, 1, 500)?;
    }
    if definition.sprite_version_number != PET_SPRITE_VERSION
        || definition.spritesheet_path != PET_SPRITESHEET_FILE
    {
        return Err(
            "pet.json 动画清单格式不受支持，spritesheetPath 必须为 spritesheet.webp".to_string(),
        );
    }

    let (version, author, license, interactions) = if let Some(extension) = deeptop {
        if extension.kind != PET_BUNDLE_KIND
            || extension.schema_version != PET_SCHEMA_VERSION
            || extension.runtime_profile != PET_RUNTIME_PROFILE
        {
            return Err("deeptop.json 不是受支持的 Deeptop Pet 清单".to_string());
        }
        Version::parse(&extension.version)
            .map_err(|_| "宠物版本必须是有效的 SemVer".to_string())?;
        validate_text("作者名称", &extension.author, 1, 80)?;
        validate_text("许可证", &extension.license, 1, 120)?;
        (
            extension.version,
            extension.author,
            extension.license,
            extension.interactions.unwrap_or_else(default_interactions),
        )
    } else {
        (
            "1.0.0".to_string(),
            "社区创作者".to_string(),
            "未声明".to_string(),
            default_interactions(),
        )
    };
    validate_interactions(&interactions)?;

    Ok(PetManifest {
        kind: PET_BUNDLE_KIND.to_string(),
        schema_version: PET_SCHEMA_VERSION,
        runtime_profile: PET_RUNTIME_PROFILE.to_string(),
        id: definition.id,
        version,
        name: definition.display_name,
        author,
        license,
        description: definition.description,
        canvas: PetCanvas {
            width: PET_CELL_WIDTH,
            height: PET_CELL_HEIGHT,
        },
        sprite_version_number: PET_SPRITE_VERSION,
        spritesheet_path: definition.spritesheet_path,
        interactions,
    })
}

fn validate_spritesheet(bytes: &[u8]) -> Result<(u32, u32), String> {
    let format = image::guess_format(bytes)
        .map_err(|error| format!("无法识别 spritesheet.webp：{error}"))?;
    if format != ImageFormat::WebP {
        return Err("spritesheet.webp 的扩展名与内容必须都是 WebP".to_string());
    }
    let image = image::load_from_memory_with_format(bytes, ImageFormat::WebP)
        .map_err(|error| format!("无法解码 spritesheet.webp：{error}"))?;
    let (width, height) = image.dimensions();
    if width != PET_ATLAS_WIDTH || height != PET_ATLAS_HEIGHT {
        return Err(format!(
            "Deeptop Pet 图集必须是 {PET_ATLAS_WIDTH}×{PET_ATLAS_HEIGHT}，实际为 {width}×{height}"
        ));
    }

    let rgba = image.to_rgba8();
    let mut visible = [[false; 8]; 11];
    for (x, y, pixel) in rgba.enumerate_pixels() {
        if pixel.0[3] > 0 {
            visible[(y / PET_CELL_HEIGHT) as usize][(x / PET_CELL_WIDTH) as usize] = true;
        }
    }
    for (row, used_columns) in PET_USED_COLUMNS.iter().copied().enumerate() {
        for (column, is_visible) in visible[row].iter().copied().enumerate() {
            match (column < used_columns, is_visible) {
                (true, false) => {
                    return Err(format!("Deeptop Pet 图集第 {row} 行第 {column} 列为空"))
                }
                (false, true) => {
                    return Err(format!(
                        "Deeptop Pet 图集第 {row} 行第 {column} 列应完全透明"
                    ))
                }
                _ => {}
            }
        }
    }
    Ok((width, height))
}

fn read_entry(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    name: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| format!("宠物包缺少 {name}"))?;
    if entry.size() == 0 || entry.size() > maximum {
        return Err(format!("宠物包条目 {name} 大小无效"));
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry
        .by_ref()
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取宠物包条目 {name} 失败：{error}"))?;
    if bytes.len() as u64 > maximum {
        return Err(format!("宠物包条目 {name} 解压后过大"));
    }
    Ok(bytes)
}

fn parse_bundle_bytes_with_assets(
    bytes: &[u8],
    include_runtime_assets: bool,
) -> Result<PetBundle, String> {
    if bytes.is_empty() || bytes.len() as u64 > MAX_BUNDLE_BYTES {
        return Err("宠物包必须小于 12 MB".to_string());
    }
    let mut archive = ZipArchive::new(Cursor::new(bytes))
        .map_err(|error| format!("宠物包不是有效的 ZIP：{error}"))?;
    if archive.len() < 2 || archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(format!("宠物包必须包含 2–{MAX_ARCHIVE_ENTRIES} 个文件"));
    }
    let mut entry_names = HashSet::new();
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("读取宠物包目录失败：{error}"))?;
        let name = entry.name().to_string();
        if entry.is_dir()
            || name == "."
            || name.starts_with('/')
            || name.contains('\\')
            || name
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
            || name.chars().any(char::is_control)
        {
            return Err(format!("宠物包包含不安全路径：{name}"));
        }
        if !entry_names.insert(name.clone()) {
            return Err(format!("宠物包包含重复条目：{name}"));
        }
        if let Some(mode) = entry.unix_mode() {
            if mode & 0o170000 == 0o120000 {
                return Err(format!("宠物包不能包含符号链接：{name}"));
            }
        }
    }

    let definition_bytes = read_entry(&mut archive, PET_DEFINITION_FILE, MAX_MANIFEST_BYTES)?;
    let definition: PetDefinition = serde_json::from_slice(&definition_bytes)
        .map_err(|error| format!("宠物包 pet.json 无效：{error}"))?;
    let extension = if entry_names.contains(DEEPTOP_MANIFEST_FILE) {
        let extension_bytes = read_entry(&mut archive, DEEPTOP_MANIFEST_FILE, MAX_MANIFEST_BYTES)?;
        Some(
            serde_json::from_slice(&extension_bytes)
                .map_err(|error| format!("宠物包 deeptop.json 无效：{error}"))?,
        )
    } else {
        None
    };
    let manifest = merge_manifest(definition, extension)?;
    let expected_entries = HashSet::from([
        PET_DEFINITION_FILE.to_string(),
        manifest.spritesheet_path.clone(),
    ]);
    let mut expected_entries = expected_entries;
    if entry_names.contains(DEEPTOP_MANIFEST_FILE) {
        expected_entries.insert(DEEPTOP_MANIFEST_FILE.to_string());
    }
    if entry_names != expected_entries {
        let unexpected = entry_names
            .difference(&expected_entries)
            .cloned()
            .collect::<Vec<_>>();
        let missing = expected_entries
            .difference(&entry_names)
            .cloned()
            .collect::<Vec<_>>();
        return Err(format!(
            "宠物包条目不受支持；多余：{}；缺少：{}",
            unexpected.join("、"),
            missing.join("、")
        ));
    }

    let asset_bytes = read_entry(&mut archive, &manifest.spritesheet_path, MAX_ASSET_BYTES)?;
    let (width, height) = validate_spritesheet(&asset_bytes)?;
    let assets = if include_runtime_assets {
        BTreeMap::from([(
            manifest.spritesheet_path.clone(),
            PetRuntimeAsset {
                media_type: "image/webp".to_string(),
                data: STANDARD.encode(asset_bytes),
                width,
                height,
            },
        )])
    } else {
        BTreeMap::new()
    };
    Ok(PetBundle { manifest, assets })
}

#[cfg(test)]
fn parse_bundle_bytes(bytes: &[u8]) -> Result<PetBundle, String> {
    parse_bundle_bytes_with_assets(bytes, true)
}

fn read_bundle_file_bytes(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("无法读取宠物包 {}：{error}", path.display()))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_BUNDLE_BYTES {
        return Err("宠物包必须是小于 12 MB 的文件".to_string());
    }
    fs::read(path).map_err(|error| format!("无法读取宠物包 {}：{error}", path.display()))
}

fn read_bundle_with_bytes(
    path: &std::path::Path,
    include_runtime_assets: bool,
) -> Result<(PetBundle, Vec<u8>), String> {
    let bytes = read_bundle_file_bytes(path)?;
    let bundle = parse_bundle_bytes_with_assets(&bytes, include_runtime_assets)?;
    Ok((bundle, bytes))
}

fn read_bundle(path: &std::path::Path) -> Result<PetBundle, String> {
    read_bundle_with_bytes(path, true).map(|(bundle, _)| bundle)
}

fn read_bundle_descriptor(path: &std::path::Path) -> Result<PetBundleDescriptor, String> {
    read_bundle_with_bytes(path, false).map(|(bundle, _)| descriptor(&bundle))
}

fn descriptor(bundle: &PetBundle) -> PetBundleDescriptor {
    PetBundleDescriptor {
        id: bundle.manifest.id.clone(),
        version: bundle.manifest.version.clone(),
        name: bundle.manifest.name.clone(),
        author: bundle.manifest.author.clone(),
        license: bundle.manifest.license.clone(),
        description: bundle.manifest.description.clone(),
        canvas: PetCanvas {
            width: PET_CELL_WIDTH,
            height: PET_CELL_HEIGHT,
        },
        sprite_version_number: PET_SPRITE_VERSION,
        built_in: false,
    }
}

fn candidate_from_path(path: Option<PathBuf>) -> Result<Option<PetBundleCandidate>, String> {
    let Some(path) = path else {
        return Ok(None);
    };
    let (bundle, data) = read_bundle_with_bytes(&path, false)?;
    Ok(Some(PetBundleCandidate {
        path: path.to_string_lossy().into_owned(),
        pet: descriptor(&bundle),
        replace_required: false,
        sha256: bundle_sha256(&data),
        size_bytes: data.len() as u64,
    }))
}

fn bundle_path(directory: &std::path::Path, id: &str) -> Result<PathBuf, String> {
    if !valid_pet_id(id) {
        return Err("宠物 id 无效".to_string());
    }
    Ok(directory.join(format!("{id}.{PET_BUNDLE_EXTENSION}")))
}

fn replacement_required(directory: &std::path::Path, id: &str) -> Result<bool, String> {
    Ok(bundle_path(directory, id)?.exists())
}

fn install_pet_bundle_into_directory(
    directory: &std::path::Path,
    source: &std::path::Path,
    replace_existing: bool,
    expected_sha256: Option<&str>,
) -> Result<PetBundleDescriptor, String> {
    install_pet_bundle_verified(directory, source, replace_existing, expected_sha256, None)
}

/// `pinned_sha256` 来自 pick_pet_bundle 的选取记录；安装时文件必须与
/// 用户在原生选择器里确认的内容逐字节一致，防止选择后替换（TOCTOU）。
fn install_pet_bundle_verified(
    directory: &std::path::Path,
    source: &std::path::Path,
    replace_existing: bool,
    expected_sha256: Option<&str>,
    pinned_sha256: Option<&str>,
) -> Result<PetBundleDescriptor, String> {
    let data = read_bundle_file_bytes(source)?;
    let actual = bundle_sha256(&data);
    verify_bundle_sha256(&data, expected_sha256)?;
    if let Some(pinned) = pinned_sha256 {
        if !actual.eq_ignore_ascii_case(pinned) {
            return Err("宠物包自选择后内容已变化，请重新导入".to_string());
        }
    }
    let bundle = parse_bundle_bytes_with_assets(&data, false)?;
    fs::create_dir_all(directory)
        .map_err(|error| format!("无法创建宠物目录 {}：{error}", directory.display()))?;
    let target = bundle_path(directory, &bundle.manifest.id)?;
    if target.exists() && !replace_existing {
        return Err(format!(
            "宠物 {} 已安装，需要确认后才能替换",
            bundle.manifest.id
        ));
    }
    if !target.exists() {
        let count = fs::read_dir(directory)
            .map_err(|error| format!("无法读取宠物目录：{error}"))?
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(PET_BUNDLE_EXTENSION))
            })
            .count();
        if count >= MAX_INSTALLED_PETS {
            return Err(format!("最多安装 {MAX_INSTALLED_PETS} 个宠物包"));
        }
    }
    write_atomic(&target, &data)?;
    Ok(descriptor(&bundle))
}

fn export_pet_bundle_to_path(
    directory: &std::path::Path,
    id: &str,
    target: &std::path::Path,
) -> Result<(), String> {
    let source = bundle_path(directory, id)?;
    let (_, data) = read_bundle_with_bytes(&source, false)?;
    write_atomic(target, &data)
}

fn remove_pet_bundle_from_directory(directory: &std::path::Path, id: &str) -> Result<(), String> {
    let path = bundle_path(directory, id)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(format!("宠物 {id} 尚未安装"))
        }
        Err(error) => Err(format!("移除宠物 {id} 失败：{error}")),
    }
}

pub fn normalize_settings(mut settings: PetSettings) -> PetSettings {
    if !settings.selected_pet_id.is_empty() && !valid_pet_id(&settings.selected_pet_id) {
        settings.selected_pet_id = default_selected_pet_id();
    }
    if settings.selected_pet_id.is_empty() {
        settings.enabled = false;
    }
    settings.size = settings.size.clamp(56, 160);
    settings
}

#[tauri::command]
pub fn get_pet_settings(app: AppHandle) -> Result<PetSettings, String> {
    load_pet_settings(&app)
}

pub fn load_pet_settings(app: &AppHandle) -> Result<PetSettings, String> {
    let path = settings_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(PetSettings::default())
        }
        Err(error) => return Err(format!("读取宠物设置失败：{error}")),
    };
    let settings: PetSettings =
        serde_json::from_str(&content).map_err(|error| format!("解析宠物设置失败：{error}"))?;
    Ok(normalize_settings(settings))
}

pub fn save_pet_settings(app: &AppHandle, settings: PetSettings) -> Result<PetSettings, String> {
    let settings = normalize_settings(settings);
    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("编码宠物设置失败：{error}"))?;
    write_atomic(&settings_path(app)?, format!("{content}\n").as_bytes())?;
    Ok(settings)
}

fn valid_window_placement(placement: PetWindowPlacement) -> bool {
    const LIMIT: i32 = 100_000;
    placement.x.abs() <= LIMIT && placement.y.abs() <= LIMIT
}

pub fn load_pet_window_placement(app: &AppHandle) -> Result<Option<PetWindowPlacement>, String> {
    let path = window_placement_path(app)?;
    let content = match fs::read_to_string(&path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取宠物窗口位置失败：{error}")),
    };
    let placement: PetWindowPlacement =
        serde_json::from_str(&content).map_err(|error| format!("解析宠物窗口位置失败：{error}"))?;
    if !valid_window_placement(placement) {
        return Err("宠物窗口位置超出允许范围".to_string());
    }
    Ok(Some(placement))
}

pub fn save_pet_window_placement(
    app: &AppHandle,
    placement: PetWindowPlacement,
) -> Result<(), String> {
    if !valid_window_placement(placement) {
        return Err("宠物窗口位置超出允许范围".to_string());
    }
    let content = serde_json::to_string_pretty(&placement)
        .map_err(|error| format!("编码宠物窗口位置失败：{error}"))?;
    write_atomic(
        &window_placement_path(app)?,
        format!("{content}\n").as_bytes(),
    )
}

#[tauri::command]
pub async fn get_pet_library(app: AppHandle) -> Result<PetLibrarySnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = ensure_pets_directory(&app)?;
        let mut paths = fs::read_dir(&directory)
            .map_err(|error| format!("无法读取宠物目录 {}：{error}", directory.display()))?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case(PET_BUNDLE_EXTENSION))
            })
            .collect::<Vec<_>>();
        paths.sort();
        let mut pets = Vec::new();
        let mut warnings = Vec::new();
        let mut seen = HashSet::new();
        if paths.len() > MAX_INSTALLED_PETS {
            warnings.push(format!(
                "宠物目录超过 {MAX_INSTALLED_PETS} 个包，只加载前 {MAX_INSTALLED_PETS} 个"
            ));
            paths.truncate(MAX_INSTALLED_PETS);
        }
        for path in paths {
            match read_bundle_descriptor(&path) {
                Ok(pet) if seen.insert(pet.id.clone()) => pets.push(pet),
                Ok(pet) => warnings.push(format!("忽略重复宠物 id：{}", pet.id)),
                Err(error) => warnings.push(format!("{}：{error}", path.display())),
            }
        }
        pets.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(PetLibrarySnapshot {
            directory: directory.to_string_lossy().into_owned(),
            pets,
            warnings,
        })
    })
    .await
    .map_err(|error| format!("读取宠物库任务失败：{error}"))?
}

#[tauri::command]
pub async fn read_pet_bundle(app: AppHandle, id: String) -> Result<PetBundle, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = ensure_pets_directory(&app)?;
        read_bundle(&bundle_path(&directory, &id)?)
    })
    .await
    .map_err(|error| format!("读取宠物包任务失败：{error}"))?
}

#[tauri::command]
pub async fn pick_pet_bundle(
    app: AppHandle,
    picked: tauri::State<'_, PickedBundles>,
) -> Result<Option<PetBundleCandidate>, String> {
    let selected = tauri::async_runtime::spawn_blocking(
        move || -> Result<Option<(PetBundleCandidate, PathBuf)>, String> {
            let picked_path = rfd::FileDialog::new()
                .set_title("导入 Deeptop Pet")
                .add_filter("Deeptop 宠物包", &[PET_BUNDLE_EXTENSION])
                .pick_file();
            let Some(mut candidate) = candidate_from_path(picked_path.clone())? else {
                return Ok(None);
            };
            candidate.replace_required =
                replacement_required(&pets_directory(&app)?, &candidate.pet.id)?;
            let canonical = picked_path
                .as_ref()
                .map(|path| {
                    path.canonicalize()
                        .map_err(|error| format!("无法解析宠物包路径 {}：{error}", path.display()))
                })
                .transpose()?;
            Ok(canonical.map(|canonical| (candidate, canonical)))
        },
    )
    .await
    .map_err(|error| format!("打开宠物包选择任务失败：{error}"))??;
    let Some((candidate, canonical)) = selected else {
        return Ok(None);
    };
    picked.record(canonical, candidate.sha256.clone())?;
    Ok(Some(candidate))
}

#[tauri::command]
pub async fn install_pet_bundle(
    app: AppHandle,
    picked: tauri::State<'_, PickedBundles>,
    path: String,
    replace_existing: bool,
    expected_sha256: Option<String>,
) -> Result<PetBundleDescriptor, String> {
    let source = PathBuf::from(&path);
    let canonical = source
        .canonicalize()
        .map_err(|_| "请先通过文件选择器选取宠物包后再安装".to_string())?;
    // 消费选取记录；未经过选择器的任意路径在此被拒绝。
    let pinned_sha256 = picked.take(&canonical)?;
    tauri::async_runtime::spawn_blocking(move || {
        let directory = ensure_pets_directory(&app)?;
        install_pet_bundle_verified(
            &directory,
            &source,
            replace_existing,
            expected_sha256.as_deref(),
            pinned_sha256.as_deref(),
        )
    })
    .await
    .map_err(|error| format!("安装宠物包任务失败：{error}"))?
}

#[tauri::command]
pub async fn export_pet_bundle(app: AppHandle, id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let directory = ensure_pets_directory(&app)?;
        let source = bundle_path(&directory, &id)?;
        let bundle = read_bundle_descriptor(&source)?;
        let default_name = format!("{}-{}.{}", bundle.id, bundle.version, PET_BUNDLE_EXTENSION);
        let picked = rfd::FileDialog::new()
            .set_title("导出 Deeptop Pet")
            .add_filter("Deeptop 宠物包", &[PET_BUNDLE_EXTENSION])
            .set_file_name(&default_name)
            .save_file();
        let Some(path) = picked else {
            return Ok(None);
        };
        export_pet_bundle_to_path(&directory, &id, &path)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|error| format!("导出宠物包任务失败：{error}"))?
}

#[tauri::command]
pub fn remove_pet_bundle(app: AppHandle, id: String) -> Result<(), String> {
    let directory = ensure_pets_directory(&app)?;
    remove_pet_bundle_from_directory(&directory, &id)
}

#[cfg(test)]
mod tests {
    use std::io::{Cursor, Write};

    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    use super::{
        bundle_path, bundle_sha256, candidate_from_path, export_pet_bundle_to_path,
        install_pet_bundle_into_directory, install_pet_bundle_verified, normalize_settings,
        parse_bundle_bytes, remove_pet_bundle_from_directory, replacement_required,
        seed_starter_pets, starter_pet_archive, valid_window_placement, PetAnchor, PetSettings,
        PetWindowPlacement, PickedBundles, PET_ATLAS_HEIGHT, PET_ATLAS_WIDTH, PET_CELL_HEIGHT,
        PET_CELL_WIDTH, PET_RUNTIME_PROFILE, PET_USED_COLUMNS, STARTER_PETS,
    };

    fn temporary_directory(label: &str) -> std::path::PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("deeptop-{label}-{}-{unique}", std::process::id()))
    }

    #[test]
    fn accepts_bounded_physical_pet_window_positions() {
        assert!(valid_window_placement(PetWindowPlacement {
            anchor: PetAnchor::BottomLeft,
            x: -100_000,
            y: 100_000,
        }));
        assert!(!valid_window_placement(PetWindowPlacement {
            anchor: PetAnchor::BottomRight,
            x: 100_001,
            y: 0,
        }));
    }

    fn pet_manifest() -> serde_json::Value {
        serde_json::json!({
            "id": "maker.cloud-cat",
            "displayName": "云猫",
            "description": "测试 Deeptop Pet",
            "spriteVersionNumber": 2,
            "spritesheetPath": "spritesheet.webp"
        })
    }

    fn deeptop_manifest(runtime_profile: &str) -> serde_json::Value {
        serde_json::json!({
            "kind": "deeptop-pet",
            "schemaVersion": 2,
            "runtimeProfile": runtime_profile,
            "version": "1.2.0",
            "author": "Maker",
            "license": "MIT",
            "interactions": [
                { "on": "tap", "play": "waving", "then": "idle", "cooldownMs": 500 }
            ]
        })
    }

    fn spritesheet(width: u32, height: u32) -> Vec<u8> {
        let mut image = RgbaImage::new(width, height);
        if width == PET_ATLAS_WIDTH && height == PET_ATLAS_HEIGHT {
            for (row, used_columns) in PET_USED_COLUMNS.iter().copied().enumerate() {
                for column in 0..used_columns {
                    image.put_pixel(
                        column as u32 * PET_CELL_WIDTH + PET_CELL_WIDTH / 2,
                        row as u32 * PET_CELL_HEIGHT + PET_CELL_HEIGHT / 2,
                        Rgba([60, 210, 220, 255]),
                    );
                }
            }
        }
        let mut output = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut output, ImageFormat::WebP)
            .unwrap();
        output.into_inner()
    }

    fn archive(
        include_extension: bool,
        dimensions: (u32, u32),
        extra: Option<(&str, &[u8])>,
    ) -> Vec<u8> {
        archive_with_runtime_profile(include_extension, dimensions, extra, PET_RUNTIME_PROFILE)
    }

    fn archive_with_runtime_profile(
        include_extension: bool,
        dimensions: (u32, u32),
        extra: Option<(&str, &[u8])>,
        runtime_profile: &str,
    ) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("pet.json", options).unwrap();
        writer
            .write_all(
                serde_json::to_string_pretty(&pet_manifest())
                    .unwrap()
                    .as_bytes(),
            )
            .unwrap();
        if include_extension {
            writer.start_file("deeptop.json", options).unwrap();
            writer
                .write_all(
                    serde_json::to_string_pretty(&deeptop_manifest(runtime_profile))
                        .unwrap()
                        .as_bytes(),
                )
                .unwrap();
        }
        writer.start_file("spritesheet.webp", options).unwrap();
        writer
            .write_all(&spritesheet(dimensions.0, dimensions.1))
            .unwrap();
        if let Some((name, data)) = extra {
            writer.start_file(name, options).unwrap();
            writer.write_all(data).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    fn archive_from_source(directory: &std::path::Path) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        for name in ["pet.json", "deeptop.json", "spritesheet.webp"] {
            writer.start_file(name, options).unwrap();
            writer
                .write_all(&std::fs::read(directory.join(name)).unwrap())
                .unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn accepts_deeptop_pet_with_extension_metadata() {
        let bundle =
            parse_bundle_bytes(&archive(true, (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT), None)).unwrap();
        assert_eq!(bundle.manifest.runtime_profile, PET_RUNTIME_PROFILE);
        assert_eq!(bundle.manifest.sprite_version_number, 2);
        assert_eq!(bundle.manifest.author, "Maker");
        assert_eq!(bundle.manifest.interactions[0].cooldown_ms, 500);
        assert_eq!(bundle.assets["spritesheet.webp"].media_type, "image/webp");
    }

    #[test]
    fn rejects_runtime_profiles_other_than_deeptop() {
        let error = parse_bundle_bytes(&archive_with_runtime_profile(
            true,
            (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT),
            None,
            "unsupported",
        ))
        .unwrap_err();
        assert!(error.contains("deeptop.json 不是受支持的 Deeptop Pet 清单"));
    }

    #[test]
    fn accepts_plain_deeptop_pet_with_safe_defaults() {
        let bundle =
            parse_bundle_bytes(&archive(false, (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT), None)).unwrap();
        assert_eq!(bundle.manifest.author, "社区创作者");
        assert_eq!(bundle.manifest.license, "未声明");
        assert!(!bundle.manifest.interactions.is_empty());
    }

    #[test]
    fn distributable_repository_pet_examples_pass_native_bundle_validation() {
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        for (directory, expected_id) in [
            ("sawatari-shizuku", "io.github.suakitsu.sawatari-shizuku"),
            ("whale-maid", "io.github.suakitsu.whale-maid-bubble"),
        ] {
            let source = repository.join("examples").join("pets").join(directory);
            let bundle = parse_bundle_bytes(&archive_from_source(&source)).unwrap();
            assert_eq!(bundle.manifest.id, expected_id);
            assert_eq!(bundle.manifest.sprite_version_number, 2);
        }
    }

    #[test]
    fn starter_pet_archives_are_installable_packages() {
        for starter in &STARTER_PETS {
            let bundle = parse_bundle_bytes(&starter_pet_archive(starter).unwrap()).unwrap();
            assert_eq!(bundle.manifest.id, starter.id);
        }
    }

    #[test]
    fn starter_pets_are_seeded_once_and_stay_deleted() {
        let directory = temporary_directory("starter-pets");
        std::fs::create_dir_all(&directory).unwrap();
        seed_starter_pets(&directory).unwrap();
        for starter in &STARTER_PETS {
            assert!(bundle_path(&directory, starter.id).unwrap().exists());
        }

        let removed = STARTER_PETS[0].id;
        remove_pet_bundle_from_directory(&directory, removed).unwrap();
        seed_starter_pets(&directory).unwrap();
        assert!(!bundle_path(&directory, removed).unwrap().exists());
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn rejects_unreferenced_files_and_unsafe_paths() {
        let error = parse_bundle_bytes(&archive(
            true,
            (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT),
            Some(("evil.js", b"alert(1)")),
        ))
        .unwrap_err();
        assert!(error.contains("不受支持") || error.contains("2–3"));

        let error = parse_bundle_bytes(&archive(
            false,
            (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT),
            Some(("../evil.webp", b"bad")),
        ))
        .unwrap_err();
        assert!(error.contains("不安全路径"));
    }

    #[test]
    fn rejects_nonstandard_dimensions() {
        let error = parse_bundle_bytes(&archive(false, (192, 208), None)).unwrap_err();
        assert!(error.contains("1536×2288"));
    }

    #[test]
    fn normalizes_settings_without_enabling_the_feature() {
        let settings = normalize_settings(PetSettings {
            enabled: false,
            selected_pet_id: "../bad".to_string(),
            anchor: PetAnchor::BottomLeft,
            size: 500,
            motion_enabled: false,
            interactions_enabled: false,
            care_enabled: false,
        });
        assert!(settings.selected_pet_id.is_empty());
        assert_eq!(settings.size, 160);
        assert!(!settings.enabled);
        assert!(!settings.interactions_enabled);
        assert!(!settings.care_enabled);
    }

    #[test]
    fn serializes_camel_case_settings() {
        let settings = serde_json::to_value(PetSettings::default()).unwrap();
        assert_eq!(settings["selectedPetId"], "");
        assert_eq!(settings["interactionsEnabled"], true);
        assert_eq!(settings["careEnabled"], true);
    }

    #[test]
    fn native_picker_cancellation_does_not_read_or_write_a_bundle() {
        assert_eq!(candidate_from_path(None), Ok(None));
    }

    #[test]
    fn pet_bundle_install_export_remove_and_reinstall_preserve_verified_bytes() {
        let root = temporary_directory("pet-bundle-roundtrip");
        let source = root.join("incoming.deeptop-pet");
        let tampered = root.join("tampered.deeptop-pet");
        let library = root.join("library");
        let exported = root.join("shared").join("cloud-cat.deeptop-pet");
        std::fs::create_dir_all(&root).unwrap();
        let bytes = archive(true, (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT), None);
        std::fs::write(&source, &bytes).unwrap();
        std::fs::write(&tampered, b"not the catalogued package").unwrap();
        let sha256 = bundle_sha256(&bytes);

        let candidate = candidate_from_path(Some(source.clone())).unwrap().unwrap();
        assert_eq!(candidate.sha256, sha256);
        assert_eq!(candidate.size_bytes, bytes.len() as u64);

        let mismatch =
            install_pet_bundle_into_directory(&library, &tampered, false, Some(&"0".repeat(64)))
                .unwrap_err();
        assert!(mismatch.contains("SHA-256 不匹配"));
        assert!(!bundle_path(&library, "maker.cloud-cat").unwrap().exists());

        let installed =
            install_pet_bundle_into_directory(&library, &source, false, Some(&sha256)).unwrap();
        assert_eq!(installed.id, "maker.cloud-cat");
        let installed_path = bundle_path(&library, "maker.cloud-cat").unwrap();
        assert_eq!(std::fs::read(&installed_path).unwrap(), bytes);

        let duplicate =
            install_pet_bundle_into_directory(&library, &source, false, Some(&sha256)).unwrap_err();
        assert!(duplicate.contains("确认后才能替换"));
        install_pet_bundle_into_directory(&library, &source, true, Some(&sha256)).unwrap();

        export_pet_bundle_to_path(&library, "maker.cloud-cat", &exported).unwrap();
        assert_eq!(std::fs::read(&exported).unwrap(), bytes);
        remove_pet_bundle_from_directory(&library, "maker.cloud-cat").unwrap();
        assert!(!installed_path.exists());
        assert!(remove_pet_bundle_from_directory(&library, "maker.cloud-cat").is_err());

        install_pet_bundle_into_directory(&library, &exported, false, Some(&sha256)).unwrap();
        assert_eq!(std::fs::read(installed_path).unwrap(), bytes);

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_installs_without_a_recorded_pick_and_detects_swapped_files() {
        let root = temporary_directory("pick-guard");
        std::fs::create_dir_all(&root).unwrap();
        let library = root.join("library");
        let source = root.join("incoming.deeptop-pet");
        let bytes = archive(true, (PET_ATLAS_WIDTH, PET_ATLAS_HEIGHT), None);
        std::fs::write(&source, &bytes).unwrap();
        let canonical = source.canonicalize().unwrap();
        let sha256 = bundle_sha256(&bytes);

        // 未经 pick_pet_bundle 记录的任意路径必须被拒绝。
        assert!(PickedBundles::default().take(&canonical).unwrap().is_none());

        let picked = PickedBundles::default();
        picked.record(canonical.clone(), sha256.clone()).unwrap();

        // 选择后文件被替换：即使路径有记录也必须拒绝。
        std::fs::write(&source, b"swapped after picking").unwrap();
        let swapped = install_pet_bundle_verified(
            &library,
            &source,
            false,
            None,
            picked.take(&canonical).unwrap().as_deref(),
        )
        .unwrap_err();
        assert!(swapped.contains("自选择后内容已变化"));

        // 内容一致时才能通过 pinned 校验。
        std::fs::write(&source, &bytes).unwrap();
        picked.record(canonical.clone(), sha256).unwrap();
        let installed = install_pet_bundle_verified(
            &library,
            &source,
            false,
            None,
            picked.take(&canonical).unwrap().as_deref(),
        )
        .unwrap();
        assert_eq!(installed.id, "maker.cloud-cat");

        // take 是消费语义：同一记录不能重复用于第二次安装。
        assert!(picked.take(&canonical).unwrap().is_none());

        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn detects_an_unreadable_existing_bundle_before_replacement() {
        let directory = std::env::temp_dir().join(format!(
            "deeptop-pet-replacement-test-{}",
            std::process::id()
        ));
        std::fs::create_dir_all(&directory).unwrap();
        let path = bundle_path(&directory, "maker.cloud-cat").unwrap();
        std::fs::write(&path, b"package without a Deeptop Pet manifest").unwrap();

        assert!(replacement_required(&directory, "maker.cloud-cat").unwrap());

        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(directory).unwrap();
    }
}
