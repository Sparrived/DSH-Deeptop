use std::{
    env,
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::Command,
    time::Duration,
};

use flate2::read::GzDecoder;
use fs2::FileExt;
use semver::Version;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

const NODE_VERSION: &str = "22.21.1";
const RUNTIME_DIRECTORY: &str = "node-runtime";
const DOWNLOAD_MAX_BYTES: u64 = 96 * 1024 * 1024;
const EXECUTABLE_MAX_BYTES: u64 = 128 * 1024 * 1024;
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Copy)]
enum ArchiveFormat {
    Zip,
    TarGz,
}

/// 一个受支持的平台上固定的官方 Node.js 发行包。
///
/// 归档摘要取自该版本的官方 `SHASUMS256.txt`，可执行文件摘要由解压出的二进制
/// 实算得出。两者都在编译期固定，因此下载和落盘各校验一次；应用本地缓存不是可
/// 信代码来源，缓存里的可执行文件每次使用前仍要重新校验摘要。
#[derive(Clone, Copy)]
struct NodeArchive {
    name: &'static str,
    format: ArchiveFormat,
    executable_entry: &'static str,
    archive_sha256: &'static str,
    executable_sha256: &'static str,
}

impl NodeArchive {
    fn archive_file(self) -> String {
        match self.format {
            ArchiveFormat::Zip => format!("{}.zip", self.name),
            ArchiveFormat::TarGz => format!("{}.tar.gz", self.name),
        }
    }

    fn url(self) -> String {
        format!(
            "https://nodejs.org/dist/v{NODE_VERSION}/{}",
            self.archive_file()
        )
    }
}

/// 自动配置覆盖发布矩阵的全部目标（Windows/Linux x64、macOS x64 与 arm64），
/// 并一并固定两个 arm64 目标，便于后续扩展。
fn archive_for(platform: &str, arch: &str) -> Option<NodeArchive> {
    match (platform, arch) {
        ("windows", "x64") => Some(NodeArchive {
            name: "node-v22.21.1-win-x64",
            format: ArchiveFormat::Zip,
            executable_entry: "node-v22.21.1-win-x64/node.exe",
            archive_sha256: "3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf",
            executable_sha256: "471961cb355311c9a9dd8ba417eca8269ead32a2231653084112554cda52e8b3",
        }),
        ("windows", "arm64") => Some(NodeArchive {
            name: "node-v22.21.1-win-arm64",
            format: ArchiveFormat::Zip,
            executable_entry: "node-v22.21.1-win-arm64/node.exe",
            archive_sha256: "b9d7faacd0b540b8b46640dbc8f56f4205ff63b79dec700d4f03d36591b0318f",
            executable_sha256: "707bbc8a9e615299ecdbff9040f88f59f20033ff1af923beee749b885cbd565d",
        }),
        ("linux", "x64") => Some(NodeArchive {
            name: "node-v22.21.1-linux-x64",
            format: ArchiveFormat::TarGz,
            executable_entry: "node-v22.21.1-linux-x64/bin/node",
            archive_sha256: "219a152ea859861d75adea578bdec3dce8143853c13c5187f40c40e77b0143b2",
            executable_sha256: "92181daccf61361e7c54d6404a3e2c2307a916d076492e3c0b388e6e5f86a854",
        }),
        ("linux", "arm64") => Some(NodeArchive {
            name: "node-v22.21.1-linux-arm64",
            format: ArchiveFormat::TarGz,
            executable_entry: "node-v22.21.1-linux-arm64/bin/node",
            archive_sha256: "c86830dedf77f8941faa6c5a9c863bdfdd1927a336a46943decc06a38f80bfb2",
            executable_sha256: "c8c89c91b842b5852dea0863836e24d38fec55c263a5b4377e54b40886a1cdb9",
        }),
        ("macos", "x64") => Some(NodeArchive {
            name: "node-v22.21.1-darwin-x64",
            format: ArchiveFormat::TarGz,
            executable_entry: "node-v22.21.1-darwin-x64/bin/node",
            archive_sha256: "8e3dc89614debe66c2a6ad2313a1adb06eb37db6cd6c40d7de6f7d987f7d1afd",
            executable_sha256: "efb341ba4578bb3a988f7bacad4ef80df5e1318b79bbd7621c8a844012a9b0f0",
        }),
        ("macos", "arm64") => Some(NodeArchive {
            name: "node-v22.21.1-darwin-arm64",
            format: ArchiveFormat::TarGz,
            executable_entry: "node-v22.21.1-darwin-arm64/bin/node",
            archive_sha256: "c170d6554fba83d41d25a76cdbad85487c077e51fa73519e41ac885aa429d8af",
            executable_sha256: "8179f1d4a920be531d81edef7a26df5cc5c9cb11c8b5a28fb336aa030fbfe3df",
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
    version.major >= 24 || (version.major == 22 && version.minor >= 21)
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
    let url = archive.url();
    let response = client
        .get(url.clone())
        .send()
        .await
        .map_err(|error| format!("下载 Node.js 失败：{error}"))?
        .error_for_status()
        .map_err(|error| format!("下载 Node.js 失败：{error}"))?;
    if response.url().as_str() != url {
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

/// 流式复制归档里唯一需要的可执行文件，途中累计大小与 SHA-256。
///
/// 只拷贝这一项而不是整包解压：发行包还包含 npm、头文件和文档，全量落盘要多写
/// 上百 MB 和上万个文件。
fn copy_executable(
    source: &mut impl Read,
    declared_size: Option<u64>,
    archive: NodeArchive,
    temporary_path: &Path,
) -> Result<(), String> {
    let mut target = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(temporary_path)
        .map_err(|error| format!("无法创建 Node.js 临时运行时：{error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut total = 0_u64;
    loop {
        let count = source
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
    if total == 0
        || declared_size.is_some_and(|size| size != total)
        || format!("{:x}", hasher.finalize()) != archive.executable_sha256
    {
        return Err("Node.js 运行时 SHA-256 校验失败".to_string());
    }
    Ok(())
}

/// 从官方发行包里取出 `node` 可执行文件（Windows 为 `node.exe`）。
fn extract_executable(
    archive: NodeArchive,
    archive_path: &Path,
    temporary_path: &Path,
) -> Result<(), String> {
    let file =
        File::open(archive_path).map_err(|error| format!("无法读取 Node.js 下载文件：{error}"))?;
    match archive.format {
        ArchiveFormat::Zip => {
            let mut zip = ZipArchive::new(file)
                .map_err(|error| format!("Node.js 下载文件不是有效 ZIP：{error}"))?;
            let mut entry = zip
                .by_name(archive.executable_entry)
                .map_err(|_| "Node.js 下载文件缺少 node.exe".to_string())?;
            if entry.is_dir() {
                return Err("Node.js 下载文件中的 node.exe 不是普通文件".to_string());
            }
            let size = entry.size();
            copy_executable(&mut entry, Some(size), archive, temporary_path)
        }
        ArchiveFormat::TarGz => {
            let mut tar = tar::Archive::new(GzDecoder::new(file));
            let mut entries = tar
                .entries()
                .map_err(|error| format!("Node.js 下载文件不是有效 tar.gz：{error}"))?;
            while let Some(entry) = entries
                .next()
                .transpose()
                .map_err(|error| format!("读取 Node.js 归档条目失败：{error}"))?
            {
                let path = entry
                    .path()
                    .map_err(|error| format!("读取 Node.js 归档路径失败：{error}"))?
                    .into_owned();
                if path.to_string_lossy() != archive.executable_entry {
                    continue;
                }
                if !entry.header().entry_type().is_file() {
                    return Err("Node.js 下载文件中的 node 不是普通文件".to_string());
                }
                let size = entry.header().size().ok();
                let mut entry = entry;
                return copy_executable(&mut entry, size, archive, temporary_path);
            }
            Err("Node.js 下载文件缺少 node".to_string())
        }
    }
}

pub fn install(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = managed_executable(app) {
        return Ok(path);
    }
    let archive = archive_for(platform(), arch()).ok_or_else(|| {
        "当前平台暂不支持自动配置 Node.js；请在浏览器中安装 Node.js 22.21 或更高版本后重试"
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

    let partial_path = root.join("node.archive.part");
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
    use super::{
        archive_for, extract_executable, parse_node_version, supports_dsh, ArchiveFormat,
        NodeArchive,
    };

    #[test]
    fn accepts_only_dsh_compatible_node_versions() {
        assert!(!supports_dsh(&parse_node_version("v22.20.0").unwrap()));
        assert!(supports_dsh(&parse_node_version("v22.21.0\n").unwrap()));
        assert!(!supports_dsh(&parse_node_version("v23.0.0").unwrap()));
        assert!(supports_dsh(&parse_node_version("v24.0.0").unwrap()));
        assert!(parse_node_version("node 22.21.0").is_none());
    }

    #[test]
    fn pins_every_published_target_archive_and_checksums() {
        let archive = archive_for("windows", "x64").unwrap();
        assert_eq!(
            archive.url(),
            "https://nodejs.org/dist/v22.21.1/node-v22.21.1-win-x64.zip"
        );
        assert_eq!(archive.executable_entry, "node-v22.21.1-win-x64/node.exe");
        assert_eq!(
            archive.archive_sha256,
            "3c624e9fbe07e3217552ec52a0f84e2bdc2e6ffa7348f3fdfb9fbf8f42e23fcf"
        );
        assert_eq!(
            archive.executable_sha256,
            "471961cb355311c9a9dd8ba417eca8269ead32a2231653084112554cda52e8b3"
        );
        // 发布矩阵覆盖的四个目标都必须能自动配置，否则安装包在缺 Node 的机器上
        // 只能引导用户手动安装。
        for (platform, arch) in [
            ("windows", "x64"),
            ("linux", "x64"),
            ("macos", "x64"),
            ("macos", "arm64"),
        ] {
            let archive = archive_for(platform, arch)
                .unwrap_or_else(|| panic!("{platform}/{arch} must be pinnable"));
            assert_eq!(archive.archive_sha256.len(), 64);
            assert_eq!(archive.executable_sha256.len(), 64);
        }
        assert!(archive_for("linux", "riscv64").is_none());
    }

    #[test]
    fn extracts_the_node_binary_from_a_tar_gz_release() {
        // 摘要必须是 &'static str，所以载荷与其 SHA-256 都写成字面量。
        let payload: &[u8] = b"fake node binary";
        let archive = NodeArchive {
            name: "node-v22.21.1-linux-x64",
            format: ArchiveFormat::TarGz,
            executable_entry: "node-v22.21.1-linux-x64/bin/node",
            archive_sha256: zero_sha(),
            executable_sha256: "9fd8a3f4b08dddb09dfd4051861ea5a83748391d232bd088189b7b79ab5323d6",
        };
        let root = std::env::temp_dir().join(format!(
            "deeptop-node-extract-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create extract test root");
        let archive_path = root.join(archive.archive_file());
        let target_path = root.join("node");

        let file = std::fs::File::create(&archive_path).expect("create archive");
        let encoder = flate2::write::GzEncoder::new(file, flate2::Compression::default());
        let mut builder = tar::Builder::new(encoder);
        // 目标条目之前的无关文件必须先被跳过。
        let mut header = tar::Header::new_gnu();
        header.set_size(4);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(
                &mut header,
                "node-v22.21.1-linux-x64/README.md",
                &b"docs"[..],
            )
            .expect("append noise entry");
        let mut header = tar::Header::new_gnu();
        header.set_size(payload.len() as u64);
        header.set_mode(0o755);
        header.set_cksum();
        builder
            .append_data(&mut header, archive.executable_entry, payload)
            .expect("append node entry");
        builder
            .into_inner()
            .expect("finish tar")
            .finish()
            .expect("finish gzip");

        extract_executable(archive, &archive_path, &target_path).expect("extract node");
        assert_eq!(std::fs::read(&target_path).expect("read node"), payload);

        // 摘要不符时必须拒绝落盘结果。
        let mismatched = NodeArchive {
            executable_sha256: zero_sha(),
            ..archive
        };
        let _ = std::fs::remove_file(&target_path);
        assert!(extract_executable(mismatched, &archive_path, &target_path).is_err());

        let _ = std::fs::remove_dir_all(&root);
    }

    fn zero_sha() -> &'static str {
        "0000000000000000000000000000000000000000000000000000000000000000"
    }

    /// 用官方发行包真实验证固定摘要与解压逻辑。
    ///
    /// 合成 tar 只能证明解析代码本身，证明不了 pin 得对；这里把真实归档喂给
    /// `extract_executable`，任何 URL/摘要/条目路径写错都会失败。归档体积大且需要
    /// 联网，因此默认忽略，按需运行：
    ///
    /// ```text
    /// set DEEPTOP_NODE_ARCHIVE_DIR=<含发行包的目录>
    /// cargo test --locked -- --ignored verifies_pinned_archives_against_real_releases
    /// ```
    #[test]
    #[ignore = "需要已下载的官方发行包"]
    fn verifies_pinned_archives_against_real_releases() {
        let Ok(directory) = std::env::var("DEEPTOP_NODE_ARCHIVE_DIR") else {
            panic!("set DEEPTOP_NODE_ARCHIVE_DIR to the directory holding the release archives");
        };
        let root = std::env::temp_dir().join(format!(
            "deeptop-node-real-archive-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock")
                .as_nanos()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).expect("create real archive test root");

        let mut verified = 0;
        for (platform, arch) in [
            ("windows", "x64"),
            ("windows", "arm64"),
            ("linux", "x64"),
            ("linux", "arm64"),
            ("macos", "x64"),
            ("macos", "arm64"),
        ] {
            let archive = archive_for(platform, arch).expect("target must be pinned");
            let path = std::path::Path::new(&directory).join(archive.archive_file());
            if !path.is_file() {
                eprintln!("skipping {platform}/{arch}: {} is missing", path.display());
                continue;
            }
            // 归档摘要必须与固定值一致（官方 SHASUMS256.txt）。
            assert_eq!(
                super::sha256_file(&path).expect("hash archive"),
                archive.archive_sha256,
                "{platform}/{arch} archive digest mismatch"
            );
            let target = root.join(format!("{platform}-{arch}"));
            extract_executable(archive, &path, &target)
                .unwrap_or_else(|error| panic!("{platform}/{arch} extract failed: {error}"));
            // 解压出的可执行文件摘要也必须一致。
            assert_eq!(
                super::sha256_file(&target).expect("hash executable"),
                archive.executable_sha256,
                "{platform}/{arch} executable digest mismatch"
            );
            verified += 1;
        }
        assert!(verified > 0, "no release archive was available to verify");
        eprintln!("verified {verified} pinned Node.js archives");
        let _ = std::fs::remove_dir_all(&root);
    }
}
