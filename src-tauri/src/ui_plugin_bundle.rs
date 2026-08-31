//! 受控 UI 插件资源协议（docs/DEEPTOP_UI_RUNTIME.md §9.3）。
//!
//! `deeptop-plugin://` 只服务一件事：把宿主 registry 登记过的单个 ESM
//! client bundle 读给 WebView。安全规则全部在本模块执行：
//! - 只服务 `resolve_ui_plugin_bundle` 成功解析并缓存过的 pluginId；
//! - 入口路径必须位于 `<DSH_HOME>/plugins` 围栏内（规范化后前缀比对）；
//! - manifest 声明 integrity 时按 SHA-256 校验，不匹配即拒绝装载；
//! - bundle 大小不超过 `MAX_BUNDLE_BYTES`；
//! - 协议处理器只从缓存回放字节，不做文件 IO、不访问 Bridge，
//!   且缓存条目绑定 BridgeManager generation：DSH 重启后旧代资源立即失效。

use std::borrow::Cow;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::http::{header, StatusCode};
use tauri::Manager;

/// WebView 中该 scheme 的 URL 形态随平台不同：Windows/Android 走
/// `http://<scheme>.localhost/<path>`，其余平台是 `<scheme>://localhost/<path>`。
pub const UI_PLUGIN_SCHEME: &str = "deeptop-plugin";
const BUNDLE_FILE: &str = "client.mjs";
const MAX_BUNDLE_BYTES: u64 = 16 * 1024 * 1024;

/// 平台上可被 WebView `import()` 的 bundle URL；由 resolve 命令返回给前端，
/// 前端不自行拼装，避免平台差异散落。
pub fn bundle_url(plugin_id: &str) -> String {
    #[cfg(windows)]
    {
        format!("http://{UI_PLUGIN_SCHEME}.localhost/{plugin_id}/{BUNDLE_FILE}")
    }
    #[cfg(not(windows))]
    {
        format!("{UI_PLUGIN_SCHEME}://localhost/{plugin_id}/{BUNDLE_FILE}")
    }
}

/// 与 cordis/ui-registry/manifest.mjs 相同的 pluginId 约束：
/// 小写字母数字与点/连字符，形如 "vendor.plugin-name"，且不允许 "." / ".." 段。
fn valid_plugin_id(plugin_id: &str) -> bool {
    if plugin_id.is_empty() || plugin_id.len() > 128 {
        return false;
    }
    if !plugin_id
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '-')
    {
        return false;
    }
    plugin_id.split('.').all(|segment| !segment.is_empty())
}

#[derive(Clone)]
struct ResolvedBundle {
    bytes: Arc<Vec<u8>>,
    generation: u64,
}

/// 已验证的插件 bundle 缓存。键为 pluginId；值绑定了启动代次，
/// 旧的代次在 DSH 重启后不可再被协议读取（§11.2）。
#[derive(Clone, Default)]
pub struct UiPluginBundleStore {
    resolved: Arc<Mutex<HashMap<String, ResolvedBundle>>>,
}

impl UiPluginBundleStore {
    fn get(&self, plugin_id: &str, generation: u64) -> Option<Arc<Vec<u8>>> {
        let resolved = self.resolved.lock().ok()?;
        let entry = resolved.get(plugin_id)?;
        (entry.generation == generation).then(|| Arc::clone(&entry.bytes))
    }

    fn put(&self, plugin_id: &str, bytes: Vec<u8>, generation: u64) {
        if let Ok(mut resolved) = self.resolved.lock() {
            resolved.insert(
                plugin_id.to_string(),
                ResolvedBundle {
                    bytes: Arc::new(bytes),
                    generation,
                },
            );
        }
    }
}

struct BundleDescriptor {
    entry_path: String,
    integrity: Option<String>,
}

/// 从桌面桥读取一个插件的 bundle 描述（ui.plugin.bundle 是宿主专用路由）。
fn fetch_descriptor(
    runtime: &crate::BridgeManager,
    plugin_id: &str,
) -> Result<BundleDescriptor, String> {
    let response = runtime.request(
        "ui.plugin.bundle".to_string(),
        json!({ "pluginId": plugin_id }),
    )?;
    let entry_path = response
        .get("entryPath")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| {
            structured_error(
                "ui-module-unavailable",
                format!("插件 {plugin_id} 没有登记可加载的客户端入口"),
            )
        })?;
    Ok(BundleDescriptor {
        entry_path,
        integrity: response
            .get("integrity")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// 强制入口文件位于 `<DSH_HOME>/plugins` 内：两侧都做规范化后做前缀比较，
/// 杜绝符号链接或 ".." 逃逸；根目录不存在时直接失败（此时不可能有合法插件）。
fn contain_within_plugins_root(entry_path: &Path) -> Result<PathBuf, String> {
    let root = crate::dsh_home().join("plugins");
    let canonical_root = root.canonicalize().map_err(|error| {
        structured_error(
            "ui-path-outside-root",
            format!("UI 插件目录 {} 不可用：{error}", root.display()),
        )
    })?;
    let canonical_entry = entry_path.canonicalize().map_err(|error| {
        structured_error(
            "ui-module-unavailable",
            format!("客户端入口 {} 不可读：{error}", entry_path.display()),
        )
    })?;
    if !canonical_entry.starts_with(&canonical_root) {
        return Err(structured_error(
            "ui-path-outside-root",
            format!(
                "客户端入口 {} 位于允许目录 {} 之外",
                canonical_entry.display(),
                canonical_root.display()
            ),
        ));
    }
    Ok(canonical_entry)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// 解析并预载一个 UI 插件 bundle：读桥 → 路径围栏 → 完整性 → 大小上限 → 缓存。
/// 返回 WebView 可 import 的 URL 与字节数。
pub fn resolve(
    runtime: &crate::BridgeManager,
    store: &UiPluginBundleStore,
    generation: u64,
    plugin_id: &str,
) -> Result<Value, String> {
    if !valid_plugin_id(plugin_id) {
        return Err(structured_error(
            "ui-invalid-request",
            format!("非法的 UI 插件标识 {plugin_id:?}"),
        ));
    }
    let descriptor = fetch_descriptor(runtime, plugin_id)?;
    let entry = PathBuf::from(&descriptor.entry_path);
    if entry.extension().and_then(|value| value.to_str()) != Some("mjs") {
        return Err(structured_error(
            "ui-module-unavailable",
            format!(
                "客户端入口 {} 不是单文件 ESM（.mjs）",
                descriptor.entry_path
            ),
        ));
    }
    let canonical_entry = contain_within_plugins_root(&entry)?;
    let metadata = fs::metadata(&canonical_entry).map_err(|error| {
        structured_error(
            "ui-module-unavailable",
            format!("无法读取客户端入口元数据：{error}"),
        )
    })?;
    let size_bytes = metadata.len();
    if size_bytes > MAX_BUNDLE_BYTES {
        return Err(structured_error(
            "ui-module-too-large",
            format!(
                "客户端入口 {} 字节数 {size_bytes} 超过上限 {MAX_BUNDLE_BYTES}",
                canonical_entry.display()
            ),
        ));
    }
    let bytes = fs::read(&canonical_entry).map_err(|error| {
        structured_error(
            "ui-module-unavailable",
            format!("读取客户端入口失败：{error}"),
        )
    })?;
    let actual_digest = sha256_hex(&bytes);
    if let Some(expected) = descriptor.integrity.as_deref() {
        let expected_digest = expected
            .strip_prefix("sha256-")
            .map(str::trim)
            .map(str::to_ascii_lowercase);
        if expected_digest.as_deref() != Some(actual_digest.as_str()) {
            return Err(structured_error(
                "ui-integrity-mismatch",
                format!("插件 {plugin_id} 客户端入口完整性校验失败"),
            ));
        }
    }
    store.put(plugin_id, bytes, generation);
    Ok(json!({ "url": bundle_url(plugin_id), "sizeBytes": size_bytes }))
}

/// 协议处理器：只回放缓存字节。任何未命中（未解析过、代次过期、路径不符）
/// 都返回 404，绝不触达文件系统或 Bridge。
pub fn handle_protocol<R: tauri::Runtime>(
    ctx: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Cow<'static, [u8]>> {
    let not_found = |message: &'static str| {
        tauri::http::Response::builder()
            .status(StatusCode::NOT_FOUND)
            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
            .body(Cow::Borrowed(message.as_bytes()) as Cow<'static, [u8]>)
            .unwrap_or_else(|_| tauri::http::Response::new(Cow::Borrowed(&b"not found"[..])))
    };

    let path = percent_decode(request.uri().path());
    let mut segments = path.trim_matches('/').split('/');
    let plugin_id = segments.next().unwrap_or("");
    let file = segments.next().unwrap_or("");
    if segments.next().is_some() || file != BUNDLE_FILE || !valid_plugin_id(plugin_id) {
        return not_found("unknown ui plugin resource");
    }

    let app = ctx.app_handle();
    let generation = app.state::<crate::BridgeManager>().generation();
    let Some(bytes) = app
        .state::<UiPluginBundleStore>()
        .get(plugin_id, generation)
    else {
        return not_found("ui plugin bundle is not resolved");
    };

    tauri::http::Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/javascript; charset=utf-8")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Cow::Owned((*bytes).clone()))
        .unwrap_or_else(|_| tauri::http::Response::new(Cow::Borrowed(&b"internal error"[..])))
}

/// 自定义 scheme 的 path 可能带百分号编码；这里只解码到可读形式供段校验，
/// 格式不合法的 %XX 原样保留。
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let hex_digit = |byte: u8| (byte as char).to_digit(16);
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let (Some(high), Some(low)) =
                (hex_digit(bytes[index + 1]), hex_digit(bytes[index + 2]))
            {
                output.push(((high << 4) | low) as u8);
                index += 3;
                continue;
            }
        }
        output.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn structured_error(code: &str, message: impl Into<String>) -> String {
    crate::structured_bridge_error(code, message.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_plugin_ids() {
        assert!(valid_plugin_id("example.session-pins"));
        assert!(valid_plugin_id("community.my-notes.v2"));
        assert!(!valid_plugin_id(""));
        assert!(!valid_plugin_id("../escape"));
        assert!(!valid_plugin_id(".."));
        assert!(!valid_plugin_id("Vendor.Name"));
        assert!(!valid_plugin_id("has space"));
        assert!(!valid_plugin_id("trailing."));
    }

    #[test]
    fn builds_platform_bundle_urls() {
        let url = bundle_url("example.session-pins");
        #[cfg(windows)]
        assert_eq!(
            url,
            "http://deeptop-plugin.localhost/example.session-pins/client.mjs"
        );
        #[cfg(not(windows))]
        assert_eq!(
            url,
            "deeptop-plugin://localhost/example.session-pins/client.mjs"
        );
    }

    #[test]
    fn decodes_percent_escapes_and_keeps_malformed_ones() {
        assert_eq!(percent_decode("/a%2Fb"), "/a/b");
        assert_eq!(percent_decode("/plain"), "/plain");
        assert_eq!(percent_decode("/bad%zz"), "/bad%zz");
    }
}
