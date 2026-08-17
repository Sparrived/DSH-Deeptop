# Deeptop 文档

这里是 Deeptop 的项目说明文档。README 负责快速了解项目；本目录负责解释运行时边界、开发路径和与 DSH 的原生协调关系。

## 阅读顺序

1. [项目说明手册](PROJECT_GUIDE.md)：适合首次接手项目、配置开发环境或排查运行时问题。
2. [DSH 原生协调关系](DSH_NATIVE_COORDINATION.md)：适合开发 Bridge、接入 DSH 插件或判断代码应该放在哪一层。
3. [架构说明](../ARCHITECTURE.md)：查看 React、Tauri、Bridge、Profile 和纯模型层的依赖方向。
4. [Deeptop UI Runtime 实现设计](DEEPTOP_UI_RUNTIME.md)：设计 Client Module、Client Plugin、Slot、Bridge 能力和动态 UI 插件路线。
5. [官方插件兼容策略](../PLUGIN_COMPATIBILITY.md)：查看兼容分层、已接入能力和后续清单。
6. [WebUI 对齐清单](../WEBUI_PARITY.md)：查看当前桌面端与 WebUI 的功能对齐状态。

## 文档原则

- 以仓库源码和 `vendor/dsh` 子模块锁定的 DSH 提交为准；更新子模块后，应重新生成运行时并验证 Profile 和 API 契约。
- 把“功能兼容”和“WebUI 实现兼容”分开描述。Deeptop 复用 Host/Cordis、Remote、Projection 和事件语义，但不直接加载 WebUI Client runtime。
- 对可选插件使用能力探测和失败状态，不假设所有 DSH Profile 都安装了全部领域服务。
- 新增能力优先进入 DSH Profile；只有桌面传输、原生文件操作和桌面交互才应进入 Bridge/Tauri/React 适配层。

## 维护入口

当以下内容变化时，请同步更新对应文档：

| 变化 | 需要更新 |
| --- | --- |
| npm/Tauri 命令、环境要求、目录或排障方式 | `README.md`、`README.zh.md`、`PROJECT_GUIDE.md` |
| Bridge 协议、ApiProxy/Remote 路由、事件转发或 Profile 装载 | `DSH_NATIVE_COORDINATION.md`、`PLUGIN_COMPATIBILITY.md` |
| React/Tauri/Bridge 依赖方向或插件化规则 | `../ARCHITECTURE.md`、`DSH_NATIVE_COORDINATION.md` |
| Deeptop Client Module、Slot、UI Plugin 生命周期或加载策略 | `DEEPTOP_UI_RUNTIME.md`、`DSH_NATIVE_COORDINATION.md` |
| WebUI 对齐功能、缺口或明确排除项 | `WEBUI_PARITY.md`、`PLUGIN_COMPATIBILITY.md` |
| 新增官方 DSH 插件或原生入口 | `DSH_NATIVE_COORDINATION.md`、`PLUGIN_COMPATIBILITY.md` |
