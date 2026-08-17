import { useState, type FormEvent } from "react";
import { PopupDialog } from "./PopupDialog";

export type PluginInstallSource = "local" | "package";

export interface PluginInstallDraft {
  id: string;
  name: string;
  source: PluginInstallSource;
}

interface PluginInstallDialogProps {
  existingIds: string[];
  pickingEntry: boolean;
  onClose: () => void;
  onPickEntry: () => Promise<string | null>;
  onSubmit: (draft: PluginInstallDraft) => string | null;
}

function suggestedIdFromEntry(path: string) {
  const fileName = path.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ?? "";
  const candidate = fileName.toLocaleLowerCase() === "index"
    ? "my-plugin"
    : fileName.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return candidate || "my-plugin";
}

export function PluginInstallDialog({
  existingIds,
  pickingEntry,
  onClose,
  onPickEntry,
  onSubmit,
}: PluginInstallDialogProps) {
  const [source, setSource] = useState<PluginInstallSource>("local");
  const [id, setId] = useState("my-plugin");
  const [name, setName] = useState("");
  const [formError, setFormError] = useState("");

  async function pickEntry() {
    setFormError("");
    const path = await onPickEntry();
    if (!path) return;
    setSource("local");
    setName(path);
    if (id === "my-plugin") setId(suggestedIdFromEntry(path));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextId = id.trim();
    const nextName = name.trim();
    if (!nextId || !nextName) {
      setFormError("请填写插件 id，并提供入口文件或 npm 包名。");
      return;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(nextId)) {
      setFormError("插件 id 只能包含字母、数字、点、下划线和连字符，且长度不超过 96 个字符。");
      return;
    }
    const duplicate = existingIds.some((existingId) => existingId === nextId);
    if (duplicate) {
      setFormError(`插件 id 已存在：${nextId}`);
      return;
    }
    const error = onSubmit({ id: nextId, name: nextName, source });
    if (error) setFormError(error);
  }

  return (
    <PopupDialog
      title="添加桌面插件"
      eyebrow="DESKTOP PLUGINS / ADD"
      description="选择一个本地入口文件，或填写已经安装好的 npm 包名。保存后重启 Deeptop 才会加载。"
      className="popup-plugin-install-dialog"
      onClose={onClose}
      footer={<>
        <button type="button" onClick={onClose}>取消</button>
        <button type="submit" form="plugin-install-form" className="confirm">加入插件列表</button>
      </>}
    >
      <form id="plugin-install-form" className="plugin-install-form" onSubmit={submit}>
        <fieldset className="plugin-install-source-picker">
          <legend>插件来源</legend>
          <label className={source === "local" ? "selected" : ""}>
            <input type="radio" name="plugin-source" checked={source === "local"} onChange={() => { setSource("local"); setName(""); setFormError(""); }} />
            <span><strong>本地入口文件</strong><small>适合正在开发或从文件夹获取的插件</small></span>
          </label>
          <label className={source === "package" ? "selected" : ""}>
            <input type="radio" name="plugin-source" checked={source === "package"} onChange={() => { setSource("package"); setName(""); setFormError(""); }} />
            <span><strong>npm 包名</strong><small>适合已由 npm 安装到当前运行环境的包</small></span>
          </label>
        </fieldset>

        <label className="popup-field">
          <span>插件 id</span>
          <input value={id} onChange={(event) => { setId(event.target.value); setFormError(""); }} placeholder="例如：my-plugin" autoFocus />
          <small className="plugin-install-help">用于识别插件，只能包含字母、数字、点、下划线和连字符。</small>
        </label>

        <label className="popup-field">
          <span>{source === "local" ? "入口文件路径" : "npm 包名或模块路径"}</span>
          <div className="plugin-install-path-control">
            <input value={name} onChange={(event) => { setName(event.target.value); setFormError(""); }} placeholder={source === "local" ? "例如：D:/plugins/my-plugin/index.ts" : "例如：@scope/my-plugin"} />
            {source === "local" && <button type="button" onClick={() => void pickEntry()} disabled={pickingEntry}>{pickingEntry ? "打开中…" : "选择文件"}</button>}
          </div>
          <small className="plugin-install-help">{source === "local" ? "使用桌面原生文件选择器，不会触发浏览器下载或文件弹窗。" : "Deeptop 只登记入口，不会在这里自动下载 npm 依赖。"}</small>
        </label>

        {formError && <p className="plugin-install-error" role="alert">{formError}</p>}
        <div className="plugin-install-steps" aria-label="安装步骤">
          <span><b>1</b><small>填写入口</small></span>
          <span><b>2</b><small>加入列表</small></span>
          <span><b>3</b><small>保存并重启</small></span>
        </div>
      </form>
    </PopupDialog>
  );
}
