//! Windows 进程探测：枚举 node 进程、读取远程命令行与 DSH_HOME，并把 DSH 子进程
//! 绑定到"最后一个句柄关闭即终止"的作业对象。
//!
//! 所有远程读取都是尽力而为：读不到就返回错误让调用方降级，绝不把一次探测失败
//! 升级成启动失败。命令行与环境块都直接从目标的 PEB 读取（按目标架构选择指针
//! 宽度与偏移），因此不依赖 WMI/PowerShell，也不会因为 WMI 慢而卡住启动。

use std::{
    ffi::c_void,
    mem::{size_of, MaybeUninit},
    path::PathBuf,
    ptr::null,
};

use windows_sys::Win32::{
    Foundation::{CloseHandle, GetLastError, HANDLE, INVALID_HANDLE_VALUE},
    System::{
        Diagnostics::{
            Debug::ReadProcessMemory,
            ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
        },
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ},
    },
};

const PROCESS_BASIC_INFORMATION_CLASS: u32 = 0;
/// `ProcessWow64Information`：32 位目标返回其 32 位 PEB 地址，64 位目标返回 0。
const PROCESS_WOW64_INFORMATION_CLASS: u32 = 26;
/// 命令行与环境块的读取上限，避免误读进巨量内存。
const MAX_COMMAND_LINE_BYTES: usize = 64 * 1024;
const MAX_ENVIRONMENT_BYTES: usize = 1024 * 1024;
const ENVIRONMENT_CHUNK_BYTES: usize = 4096;
/// `RTL_USER_PROCESS_PARAMETERS` 的字段偏移，按目标指针宽度选择。
const PARAMETERS_OFFSET_64: usize = 0x20;
const PARAMETERS_OFFSET_32: usize = 0x10;
const COMMAND_LINE_OFFSET_64: usize = 0x70;
const COMMAND_LINE_OFFSET_32: usize = 0x40;
const ENVIRONMENT_OFFSET_64: usize = 0x80;
const ENVIRONMENT_OFFSET_32: usize = 0x48;

#[repr(C)]
struct ProcessBasicInformation {
    reserved1: *mut c_void,
    peb_base_address: *mut c_void,
    reserved2: [*mut c_void; 2],
    unique_process_id: usize,
    reserved3: *mut c_void,
}

#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryInformationProcess(
        process_handle: HANDLE,
        process_information_class: u32,
        process_information: *mut c_void,
        process_information_length: u32,
        return_length: *mut u32,
    ) -> i32;
}

/// 拥有的内核句柄，Drop 时关闭。
struct OwnedHandle(HANDLE);

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

// SAFETY: 内核句柄可以在线程之间移动与共享（CloseHandle/AssignProcessToJobObject 只
// 依赖句柄值本身），`*mut c_void` 只是缺少自动推导的 Send/Sync 实现。作业句柄要进入
// Tauri 的托管状态，因此在这里显式声明。
unsafe impl Send for OwnedHandle {}
unsafe impl Sync for OwnedHandle {}

fn last_error() -> u32 {
    unsafe { GetLastError() }
}

fn pointer_offset(base: usize, offset: usize) -> Result<usize, String> {
    base.checked_add(offset)
        .ok_or_else(|| "远程地址溢出".to_string())
}

/// 读取远程内存，允许短读；只有一个字节都没读到才算失败。
/// 环境块尾部可能落在未映射页上，短读必须能取回已读到的部分。
fn read_partial(handle: HANDLE, source: usize, target: &mut [u8]) -> Result<usize, String> {
    let mut bytes_read = 0usize;
    let success = unsafe {
        ReadProcessMemory(
            handle,
            source as *const c_void,
            target.as_mut_ptr().cast(),
            target.len(),
            &mut bytes_read,
        )
    };
    if success == 0 && bytes_read == 0 {
        return Err(format!("ReadProcessMemory 错误 {}", last_error()));
    }
    Ok(bytes_read)
}

fn read_exact(handle: HANDLE, source: usize, target: &mut [u8]) -> Result<(), String> {
    let bytes_read = read_partial(handle, source, target)?;
    if bytes_read != target.len() {
        return Err(format!(
            "远程内存短读（{bytes_read}/{} 字节）",
            target.len()
        ));
    }
    Ok(())
}

fn read_pointer(handle: HANDLE, source: usize, pointer_size: usize) -> Result<usize, String> {
    let mut bytes = [0u8; size_of::<usize>()];
    read_exact(handle, source, &mut bytes[..pointer_size])?;
    Ok(bytes[..pointer_size]
        .iter()
        .enumerate()
        .fold(0usize, |value, (index, byte)| {
            value | (*byte as usize) << (index * 8)
        }))
}

/// 读取一个 `UNICODE_STRING`（长度 + 缓冲区指针）指向的 UTF-16 文本。
fn read_unicode_string(
    handle: HANDLE,
    address: usize,
    pointer_size: usize,
    limit: usize,
) -> Result<String, String> {
    let mut length_bytes = [0u8; 2];
    read_exact(handle, address, &mut length_bytes)?;
    let length = u16::from_le_bytes(length_bytes) as usize;
    if length == 0 || length > limit || !length.is_multiple_of(2) {
        return Err(format!("远程字符串长度不可用（{length} 字节）"));
    }
    let buffer_offset = if pointer_size == 8 { 8 } else { 4 };
    let buffer = read_pointer(
        handle,
        pointer_offset(address, buffer_offset)?,
        pointer_size,
    )?;
    if buffer == 0 {
        return Err("远程字符串缓冲区不可用".to_string());
    }
    let mut bytes = vec![0u8; length];
    read_exact(handle, buffer, &mut bytes)?;
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    Ok(String::from_utf16_lossy(&units))
}

/// UTF-16 环境块中"空条目"（双空字符）的起始偏移。
fn environment_end(bytes: &[u8]) -> Option<usize> {
    (0..bytes.len().saturating_sub(3))
        .step_by(2)
        .find(|index| bytes[*index..*index + 4] == [0, 0, 0, 0])
}

fn parse_environment(bytes: &[u8]) -> Result<Option<PathBuf>, String> {
    if !bytes.len().is_multiple_of(2) {
        return Err("环境块不是 UTF-16 对齐数据".to_string());
    }
    let units: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();
    let mut dsh_home = None;
    let mut user_profile = None;
    for entry in units.split(|unit| *unit == 0) {
        if entry.is_empty() {
            break;
        }
        let entry = String::from_utf16(entry).map_err(|_| "环境块包含无效 UTF-16".to_string())?;
        let Some((name, value)) = entry.split_once('=') else {
            continue;
        };
        let value = value.trim();
        if value.is_empty() {
            continue;
        }
        match name.to_ascii_uppercase().as_str() {
            "DSH_HOME" => dsh_home = Some(PathBuf::from(value)),
            "USERPROFILE" => user_profile = Some(PathBuf::from(value)),
            _ => {}
        }
    }
    Ok(dsh_home.or_else(|| user_profile.map(|path| path.join(".dsh"))))
}

fn wide_to_string(units: &[u16]) -> String {
    let end = units
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(units.len());
    String::from_utf16_lossy(&units[..end])
}

fn is_node_process_name(name: &str) -> bool {
    let process_name = name.trim().to_ascii_lowercase();
    process_name == "node" || process_name == "node.exe"
}

/// 已打开的目标进程：`parameters` 指向 `RTL_USER_PROCESS_PARAMETERS`，
/// `pointer_size` 是目标进程的指针宽度（WOW64 目标为 4）。
struct ProcessMemory {
    handle: OwnedHandle,
    parameters: usize,
    pointer_size: usize,
}

impl ProcessMemory {
    fn open(pid: u32) -> Result<Self, String> {
        let raw =
            unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid) };
        if raw.is_null() {
            return Err(format!("OpenProcess 错误 {}", last_error()));
        }
        let handle = OwnedHandle(raw);
        let (peb, pointer_size) = peb_location(handle.0)?;
        let parameters_offset = if pointer_size == 8 {
            PARAMETERS_OFFSET_64
        } else {
            PARAMETERS_OFFSET_32
        };
        let parameters = read_pointer(
            handle.0,
            pointer_offset(peb, parameters_offset)?,
            pointer_size,
        )?;
        if parameters == 0 {
            return Err("进程参数不可用".to_string());
        }
        Ok(Self {
            handle,
            parameters,
            pointer_size,
        })
    }

    fn command_line(&self) -> Result<String, String> {
        let offset = if self.pointer_size == 8 {
            COMMAND_LINE_OFFSET_64
        } else {
            COMMAND_LINE_OFFSET_32
        };
        read_unicode_string(
            self.handle.0,
            pointer_offset(self.parameters, offset)?,
            self.pointer_size,
            MAX_COMMAND_LINE_BYTES,
        )
    }

    fn environment(&self) -> Result<Vec<u8>, String> {
        let offset = if self.pointer_size == 8 {
            ENVIRONMENT_OFFSET_64
        } else {
            ENVIRONMENT_OFFSET_32
        };
        let environment = read_pointer(
            self.handle.0,
            pointer_offset(self.parameters, offset)?,
            self.pointer_size,
        )?;
        if environment == 0 {
            return Ok(Vec::new());
        }
        let mut bytes = Vec::new();
        while bytes.len() < MAX_ENVIRONMENT_BYTES {
            let start = bytes.len();
            let chunk = ENVIRONMENT_CHUNK_BYTES.min(MAX_ENVIRONMENT_BYTES - start);
            bytes.resize(start + chunk, 0);
            let read = read_partial(self.handle.0, environment + start, &mut bytes[start..])?;
            bytes.truncate(start + read);
            if let Some(end) = environment_end(&bytes) {
                bytes.truncate(end);
                return Ok(bytes);
            }
            if read < chunk {
                break;
            }
        }
        Ok(bytes)
    }
}

/// WOW64（32 位）目标返回其 32 位 PEB 与 4 字节指针宽度；其余返回 64 位 PEB。
fn peb_location(handle: HANDLE) -> Result<(usize, usize), String> {
    let mut wow64 = 0usize;
    let mut return_length = 0u32;
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_WOW64_INFORMATION_CLASS,
            (&mut wow64 as *mut usize).cast(),
            size_of::<usize>() as u32,
            &mut return_length,
        )
    };
    if status >= 0 && wow64 != 0 {
        return Ok((wow64, 4));
    }
    let mut information = MaybeUninit::<ProcessBasicInformation>::zeroed();
    let status = unsafe {
        NtQueryInformationProcess(
            handle,
            PROCESS_BASIC_INFORMATION_CLASS,
            information.as_mut_ptr().cast(),
            size_of::<ProcessBasicInformation>() as u32,
            &mut return_length,
        )
    };
    if status < 0 {
        return Err(format!("NtQueryInformationProcess 状态 0x{status:08x}"));
    }
    let information = unsafe { information.assume_init() };
    if information.peb_base_address.is_null() {
        return Err("PEB 不可用".to_string());
    }
    Ok((information.peb_base_address as usize, size_of::<usize>()))
}

/// 一个 node 进程；命令行读不到时保持 `None`，调用方据此跳过而不是失败。
pub struct NodeProcess {
    pub pid: u32,
    pub name: String,
    pub command_line: Option<String>,
}

/// 用 Toolhelp 快照枚举所有 node/node.exe 进程，并尽力读取各自命令行。
pub fn list_node_processes() -> Result<Vec<NodeProcess>, String> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(format!("CreateToolhelp32Snapshot 错误 {}", last_error()));
    }
    let snapshot = OwnedHandle(snapshot);
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = size_of::<PROCESSENTRY32W>() as u32;
    let mut found = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    let mut processes = Vec::new();
    while found {
        let name = wide_to_string(&entry.szExeFile);
        if is_node_process_name(&name) {
            let command_line = ProcessMemory::open(entry.th32ProcessID)
                .ok()
                .and_then(|memory| memory.command_line().ok());
            processes.push(NodeProcess {
                pid: entry.th32ProcessID,
                name,
                command_line,
            });
        }
        found = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Ok(processes)
}

/// 读取目标进程的 DSH_HOME（未设置时回退到 `USERPROFILE\.dsh`）。
/// 读不到环境时返回 Err，由调用方降级，而不是让整个枚举失败。
pub fn dsh_home(pid: u32) -> Result<Option<PathBuf>, String> {
    let memory = ProcessMemory::open(pid)?;
    let bytes = memory.environment()?;
    if bytes.is_empty() {
        return Ok(None);
    }
    parse_environment(&bytes)
}

/// 绑定了 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` 的作业对象。
///
/// DSH 及其子进程都在作业里：只要本进程还持有句柄，它就是看护者；Deeptop 正常退出、
/// 被任务管理器结束或崩溃时内核都会关闭句柄，从而回收整棵 DSH 进程树。
pub struct KillOnCloseJob(OwnedHandle);

/// 把子进程放进一个新的 kill-on-close 作业对象。
///
/// 嵌套作业在 Windows 8 及以上受支持；失败（例如父进程所在作业不允许）由调用方
/// 记录诊断后继续，退出时的显式终止仍然覆盖常规路径。
pub fn kill_on_close_job(process: HANDLE) -> Result<KillOnCloseJob, String> {
    let raw = unsafe { CreateJobObjectW(null(), null()) };
    if raw.is_null() {
        return Err(format!("CreateJobObject 错误 {}", last_error()));
    }
    let job = KillOnCloseJob(OwnedHandle(raw));
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { std::mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    let configured = unsafe {
        SetInformationJobObject(
            job.0 .0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
            size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        )
    };
    if configured == 0 {
        return Err(format!("SetInformationJobObject 错误 {}", last_error()));
    }
    if unsafe { AssignProcessToJobObject(job.0 .0, process) } == 0 {
        return Err(format!("AssignProcessToJobObject 错误 {}", last_error()));
    }
    Ok(job)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_environment_terminator_on_aligned_boundaries() {
        let mut bytes = Vec::new();
        for unit in "DSH_HOME=C:\\Users\\test\\.dsh".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&[0, 0, 0, 0, 0, 0]);

        assert_eq!(environment_end(&bytes), Some(bytes.len() - 6));
        assert_eq!(
            parse_environment(&bytes[..bytes.len() - 6]).expect("parse environment"),
            Some(PathBuf::from("C:\\Users\\test\\.dsh"))
        );
    }

    #[test]
    fn falls_back_to_user_profile_without_dsh_home() {
        let mut bytes = Vec::new();
        for unit in "USERPROFILE=C:\\Users\\test".encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        bytes.extend_from_slice(&[0, 0, 0, 0]);

        assert_eq!(
            parse_environment(&bytes[..bytes.len() - 4]).expect("parse environment"),
            Some(PathBuf::from("C:\\Users\\test\\.dsh"))
        );
    }

    #[test]
    fn reads_own_command_line_and_environment() {
        let pid = std::process::id();
        let memory = ProcessMemory::open(pid).expect("open own process");
        let command_line = memory.command_line().expect("read own command line");
        assert!(
            command_line.to_ascii_lowercase().contains(".exe"),
            "unexpected command line: {command_line}"
        );
        let home = dsh_home(pid)
            .expect("read own environment")
            .expect("own process should resolve a home directory");
        assert!(home.is_absolute(), "unexpected home: {}", home.display());
    }

    /// 作业句柄关闭后内核必须回收子进程——这正是"强杀 Deeptop 不再留下 DSH"的保证。
    /// 同时验证本机（Deeptop 自身可能已在别人的作业里）允许嵌套作业。
    #[test]
    fn kill_on_close_job_reaps_the_child_when_the_handle_drops() {
        use std::{
            os::windows::io::AsRawHandle,
            process::{Command, Stdio},
            thread::sleep,
            time::{Duration, Instant},
        };

        let mut child = Command::new("cmd")
            .args(["/C", "ping -n 30 127.0.0.1 > NUL"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a long-running child");
        let job = match kill_on_close_job(child.as_raw_handle()) {
            Ok(job) => job,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                panic!("无法把子进程放进作业对象：{error}");
            }
        };
        assert!(
            child.try_wait().expect("poll child").is_none(),
            "建立作业对象后子进程应当仍在运行"
        );
        drop(job);

        // 子进程自己需要约 29 秒才结束，因此 5 秒内退出只可能是被内核回收。
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if child.try_wait().expect("poll child").is_some() {
                break;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("作业句柄关闭后子进程仍在运行");
            }
            sleep(Duration::from_millis(20));
        }
    }
}
