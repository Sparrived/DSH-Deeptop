use std::{
    env,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use fs2::FileExt;
use semver::Version;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const NODE_VERSION: &str = "22.19.0";
const RUNTIME_DIRECTORY: &str = "node-runtime";
const DOWNLOAD_MAX_BYTES: u64 = 96 * 1024 * 1024;
const EXECUTABLE_MAX_BYTES: u64 = 128 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy)]
struct NodeArchive {
    url: &'static str,
    archive_sha256: &'static str,
    executable_sha256: &'static str,
    executable_entry: &'static str,
}

fn archive_for(platform: &str, arch: &str) -> Option<NodeArchive> {
    match (platform, arch) {
        ("windows", "x64") => Some(NodeArchive {
            url: "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip",
            archive_sha256: "ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86",
            executable_sha256: "995a3fb3cefad590cd3f4b321532a4b9582fb9c6575320ed2e3e894caac3e362",
            executable_entry: "node-v22.19.0-win-x64/node.exe",
        }),
        _ => None,
    }
}

fn platform() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

fn arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "other"
    }
}

fn runtime_root(app: &AppHandle) -> Result<PathBuf, String> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("无法定位 Node.js 运行时目录：{error}"))?
        .join(RUNTIME_DIRECTORY)
        .join(format!("v{NODE_VERSION}-{}-{}", platform(), arch()));
    fs::create_dir_all(&root)
        .map_err(|error| format!("无法创建 Node.js 运行时目录 {}：{error}", root.display()))?;
    if is_reparse_point(&root) {
        return Err(format!(
            "拒绝使用重解析点作为 Node.js 运行时目录：{}",
            root.display()
        ));
    }
    Ok(root)
}

#[cfg(windows)]
fn is_reparse_point(path: &Path) -> bool {
    use std::os::windows::fs::MetadataExt;

    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_attributes() & 0x400 != 0)
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn is_reparse_point(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_symlink())
        .unwrap_or(false)
}

fn executable_name() -> &'static str {
    if cfg!(windows) {
        "node.exe"
    } else {
        "node"
    }
}

fn managed_executable_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(runtime_root(app)?.join(executable_name()))
}

fn parse_node_version(value: &str) -> Option<Version> {
    Version::parse(value.trim().strip_prefix('v').unwrap_or(value.trim())).ok()
}

fn supports_dsh(version: &Version) -> bool {
    version.major >= 24 || (version.major == 22 && version.minor >= 19)
}

fn command_output(path: &Path, argument: &str) -> Option<std::process::Output> {
    let mut command = Command::new(path);
    command.arg(argument);
    #[cfg(windows)]
    super::configure_hidden_process(&mut command);
    command.output().ok()
}

pub fn is_supported_executable(path: &Path) -> bool {
    if !path.is_file() || is_reparse_point(path) {
        return false;
    }
    command_output(path, "--version")
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|output| parse_node_version(&output))
        .is_some_and(|version| supports_dsh(&version))
}

pub fn is_available_npm(path: &Path) -> bool {
    path.is_file()
        && !is_reparse_point(path)
        && command_output(path, "--version").is_some_and(|output| output.status.success())
}

pub fn managed_executable(app: &AppHandle) -> Option<PathBuf> {
    let archive = archive_for(platform(), arch())?;
    let path = managed_executable_path(app).ok()?;
    // Verify the pinned executable before asking it for its version: the local
    // app-data directory is not a trusted source of executable code.
    (path.is_file() && !is_reparse_point(&path))
        .then(|| sha256_file(&path).ok())
        .flatten()
        .filter(|hash| hash == archive.executable_sha256)
        .and_then(|_| is_supported_executable(&path).then_some(path))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("无法读取 Node.js 文件：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("读取 Node.js 文件失败：{error}"))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn download_archive(archive: NodeArchive, partial_path: &Path) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(DOWNLOAD_TIMEOUT)
        .user_agent(format!(
            "Deeptop/{} managed-node",
            env!("CARGO_PKG_VERSION")
        ))
        .build()
        .map_err(|error| format!("无法创建 Node.js 下载连接：{error}"))?;
    let response = client
        .get(archive.url)
        .send()
        .await
        .map_err(|error| format!("下载 Node.js 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载 Node.js 失败：{error}"))?;
    if response.url().as_str() != archive.url {
        return Err("Node.js 下载地址发生未允许的跳转".to_string());
    }
    if response
        .content_length()
        .is_some_and(|length| length == 0 || length > DOWNLOAD_MAX_BYTES)
    {
        return Err("Node.js 下载文件大小无效".to_string());
    }

    let mut file = File::create(partial_path)
        .map_err(|error| format!("无法创建 Node.js 下载临时文件：{error}"))?;
    let mut stream = response.bytes_stream();
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
        let chunk = chunk.map_err(|error| format!("读取 Node.js 下载数据失败：{error}"))?;
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        if downloaded > DOWNLOAD_MAX_BYTES {
            return Err("Node.js 下载文件超过安全大小限制".to_string());
        }
        file.write_all(&chunk)
            .map_err(|error| format!("写入 Node.js 下载文件失败：{error}"))?;
        hasher.update(&chunk);
    }
    file.flush()
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("保存 Node.js 下载文件失败：{error}"))?;
    if downloaded == 0 || format!("{:x}", hasher.finalize()) != archive.archive_sha256 {
        return Err("Node.js 下载文件 SHA-256 校验失败".to_string());
    }
    Ok(())
}

fn extract_executable(
    archive: NodeArchive,
    archive_path: &Path,
    temporary_path: &Path,
) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|error| format!("无法读取 Node.js 下载文件：{error}"))?;
    let mut zip =
        ZipArchive::new(file).map_err(|error| format!("Node.js 下载文件不是有效 ZIP：{error}"))?;
    let mut entry = zip
        .by_name(archive.executable_entry)
        .map_err(|_| "Node.js 下载文件缺少 node.exe".to_string())?;
    if entry.is_dir() || entry.size() == 0 || entry.size() > EXECUTABLE_MAX_BYTES {
        return Err("Node.js 下载文件中的 node.exe 大小无效".to_string());
    }

    let mut target = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary_path)
        .map_err(|error| format!("无法创建 Node.js 临时运行时：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_u64;
    loop {
        let count = entry
            .read(&mut buffer)
            .map_err(|error| format!("解压 Node.js 运行时失败：{error}"))?;
        if count == 0 {
            break;
        }
        total = total.saturating_add(count as u64);
        if total > EXECUTABLE_MAX_BYTES {
            return Err("Node.js 解压文件超过安全大小限制".to_string());
        }
        target
            .write_all(&buffer[..count])
            .map_err(|error| format!("写入 Node.js 运行时失败：{error}"))?;
        hasher.update(&buffer[..count]);
    }
    target
        .flush()
        .and_then(|_| target.sync_all())
        .map_err(|error| format!("保存 Node.js 运行时失败：{error}"))?;
    if total != entry.size() || format!("{:x}", hasher.finalize()) != archive.executable_sha256 {
        return Err("Node.js 运行时 SHA-256 校验失败".to_string());
    }
    Ok(())
}

pub fn install(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = managed_executable(app) {
        return Ok(path);
    }
    let archive = archive_for(platform(), arch()).ok_or_else(|| {
        "当前平台暂不支持自动配置 Node.js；请在浏览器中安装 Node.js 22.19 或更高版本后重试"
            .to_string()
    })?;
    let root = runtime_root(app)?;
    let lock_path = root.join(".lock");
    if is_reparse_point(&lock_path) {
        return Err(format!(
            "拒绝使用重解析点作为 Node.js 运行时锁：{}",
            lock_path.display()
        ));
    }
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| format!("无法打开 Node.js 运行时锁：{error}"))?;
    lock.lock_exclusive()
        .map_err(|error| format!("无法取得 Node.js 运行时锁：{error}"))?;
    if let Some(path) = managed_executable(app) {
        return Ok(path);
    }

    let partial_path = root.join("node.zip.part");
    let temporary_path = root.join(format!("{}.tmp-{}", executable_name(), std::process::id()));
    let executable_path = managed_executable_path(app)?;
    let _ = fs::remove_file(&partial_path);
    let _ = fs::remove_file(&temporary_path);
    let result = (|| -> Result<PathBuf, String> {
        tauri::async_runtime::block_on(download_archive(archive, &partial_path))?;
        extract_executable(archive, &partial_path, &temporary_path)?;
        if sha256_file(&temporary_path)? != archive.executable_sha256 {
            return Err("Node.js 运行时复核失败".to_string());
        }
        if executable_path.exists() && is_reparse_point(&executable_path) {
            return Err(format!(
                "拒绝覆盖重解析点 Node.js 运行时：{}",
                executable_path.display()
            ));
        }
        let _ = fs::remove_file(&executable_path);
        fs::rename(&temporary_path, &executable_path)
            .map_err(|error| format!("无法提交 Node.js 运行时：{error}"))?;
        if !is_supported_executable(&executable_path) {
            return Err("自动配置的 Node.js 版本不满足 DSH 要求".to_string());
        }
        Ok(executable_path)
    })();
    let _ = fs::remove_file(&partial_path);
    let _ = fs::remove_file(&temporary_path);
    result
}

#[cfg(test)]
mod tests {
    use super::{archive_for, parse_node_version, supports_dsh};

    #[test]
    fn accepts_only_dsh_compatible_node_versions() {
        assert!(!supports_dsh(&parse_node_version("v22.18.0").unwrap()));
        assert!(supports_dsh(&parse_node_version("v22.19.0\n").unwrap()));
        assert!(!supports_dsh(&parse_node_version("v23.0.0").unwrap()));
        assert!(supports_dsh(&parse_node_version("v24.0.0").unwrap()));
        assert!(parse_node_version("node 22.19.0").is_none());
    }

    #[test]
    fn pins_the_windows_x64_archive_and_checksums() {
        let archive = archive_for("windows", "x64").unwrap();
        assert_eq!(
            archive.url,
            "https://nodejs.org/dist/v22.19.0/node-v22.19.0-win-x64.zip"
        );
        assert_eq!(archive.executable_entry, "node-v22.19.0-win-x64/node.exe");
        assert_eq!(
            archive.archive_sha256,
            "ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86"
        );
        assert_eq!(
            archive.executable_sha256,
            "995a3fb3cefad590cd3f4b321532a4b9582fb9c6575320ed2e3e894caac3e362"
        );
        assert!(archive_for("linux", "x64").is_none());
    }
}
