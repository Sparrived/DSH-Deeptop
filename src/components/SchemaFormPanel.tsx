import { useMemo, useState } from "react";
import type { DshSettingsNamespace } from "../lib/desktop";
import {
  isSchemaEnvelope,
  schemaEnumChoices,
  schemaNodeAtRef,
  type SchemaNode,
} from "../app/schema-model";
import { schemaDraftOps, type SchemaPathOp, type SchemaFieldValue } from "../app/schema-form-model";

/**
 * A schemastery-schema-driven settings form.
 *
 * The namespace's `schema` is the vendored schemastery `toJSON()` envelope
 * (`{uid, refs}`). This panel walks the envelope to render the editable user
 * section and writes a minimal diff back through `settings.mutate` path ops
 * against the documented revision — the same write path the official settings
 * scope uses, so the desktop never reimplements resolution. Secret fields
 * (`meta.role === 'secret'`) render as write-only inputs: their stored value
 * never leaves the host, and clearing a secret emits nothing (a typed value
 * becomes a `set` write; an untouched secret stays untouched).
 */

export type { SchemaPathOp } from "../app/schema-form-model";

type Envelope = { uid: unknown; refs: Record<string, SchemaNode> };

type SchemaFormProps = {
  namespace: DshSettingsNamespace;
  onSave: (ops: SchemaPathOp[], revision: number) => void | Promise<void>;
  onCancel: () => void;
  saving: boolean;
};

function labelOf(node: SchemaNode | undefined): string | undefined {
  const meta = node?.meta;
  const name = typeof meta?.name === "string" && meta.name.trim() ? meta.name : undefined;
  const comment = typeof meta?.comment === "string" && meta.comment.trim() ? meta.comment : undefined;
  return name ?? comment;
}

function descriptionOf(node: SchemaNode | undefined): string | undefined {
  const meta = node?.meta;
  const value = typeof meta?.description === "string" ? meta.description : typeof meta?.comment === "string" ? meta.comment : undefined;
  return value && value.trim() ? value : undefined;
}

function isSecret(node: SchemaNode | undefined): boolean {
  return node?.meta?.role === "secret";
}

type FieldValue = SchemaFieldValue;

function primitiveValue(node: SchemaNode | undefined, value: unknown): SchemaFieldValue {
  if (value === undefined || value === null) {
    const fallback = node?.meta?.default;
    if (fallback === undefined || fallback === null) return null;
    if (typeof fallback === "boolean" || typeof fallback === "number") return fallback;
    return String(fallback);
  }
  if (typeof value === "boolean" || typeof value === "number") return value;
  return typeof value === "string" ? value : JSON.stringify(value);
}

type FieldProps = {
  path: string[];
  node: SchemaNode;
  envelope: Envelope;
  value: unknown;
  draft: Record<string, FieldValue>;
  onChange: (path: string[], value: FieldValue) => void;
};

function PrimitiveField({ path, node, envelope, value, draft, onChange }: FieldProps) {
  const meta = node.meta ?? {};
  const label = labelOf(node) ?? path.at(-1) ?? "值";
  const description = descriptionOf(node);
  const choices = node.type === "const" || node.type === "union"
    ? schemaEnumChoices(node, envelope)
    : [];
  const draftKey = path.join("/");

  if (node.type === "const" || node.type === "union" && choices.length > 0) {
    const current = draft[draftKey] ?? primitiveValue(node, value);
    const selected = current === null ? "" : String(current);
    return <div className="schema-field" data-path={draftKey}>
      <span className="schema-field-label">{label}{description && <small>{description}</small>}</span>
      <select value={selected} onChange={(event) => onChange(path, event.target.value)}>
        {selected === "" && <option value="" disabled>选择值</option>}
        {choices.map((choice) => <option value={String(choice.value)} key={String(choice.value)}>{choice.label ?? String(choice.value)}</option>)}
      </select>
    </div>;
  }

  if (node.type === "boolean") {
    const checked = primitiveValue(node, draft[draftKey] ?? value) === true;
    return <div className="schema-field" data-path={draftKey}>
      <span className="schema-field-label">{label}{description && <small>{description}</small>}</span>
      <label className="schema-field-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(path, event.target.checked)} /><span aria-hidden="true" /></label>
    </div>;
  }

  return <div className="schema-field" data-path={draftKey}>
    <span className="schema-field-label">{label}
      {isSecret(node) && <em className="schema-secret-badge">Host 保管</em>}
      {description && <small>{description}</small>}
    </span>
    {node.type === "number" ? (
      <input
        type="number"
        value={primitiveValue(node, draft[draftKey] ?? value) === null ? "" : String(primitiveValue(node, draft[draftKey] ?? value))}
        min={typeof meta.min === "number" ? meta.min : undefined}
        max={typeof meta.max === "number" ? meta.max : undefined}
        step={typeof meta.step === "number" ? meta.step : undefined}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === "") { onChange(path, null); return; }
          const parsed = Number(raw);
          if (Number.isFinite(parsed)) onChange(path, parsed);
        }}
      />
    ) : (
      <input
        type={isSecret(node) ? "password" : "text"}
        // Secret fields are write-only: the value never leaves the host, so
        // the input always starts empty and only a typed value becomes a write.
        value={isSecret(node) ? "" : String(primitiveValue(node, draft[draftKey] ?? value) ?? "")}
        placeholder={isSecret(node) ? "输入新值以更新（留空不修改）" : typeof meta.default === "string" ? meta.default : undefined}
        onChange={(event) => onChange(path, isSecret(node) ? (event.target.value === "" ? null : event.target.value) : event.target.value)}
        autoComplete="off"
      />
    )}
  </div>;
}

function ContainerField({ path, node, envelope, value, draft, onChange }: FieldProps) {
  const [open, setOpen] = useState(path.length === 0);
  const label = labelOf(node) ?? path.at(-1) ?? "设置";
  const description = descriptionOf(node);
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const inner = node.inner !== undefined ? schemaNodeAtRef(envelope, typeof node.inner === "number" ? node.inner : undefined) : undefined;

  let rows: Array<{ key: string; node: SchemaNode | undefined }> = [];
  if (node.type === "object" && node.dict) {
    rows = Object.entries(node.dict).map(([key, ref]) => ({ key, node: schemaNodeAtRef(envelope, typeof ref === "number" ? ref : undefined) }));
  } else if (node.type === "array") {
    const list = Array.isArray(value) ? value : [];
    rows = list.map((_item, index) => ({ key: String(index), node: inner }));
    rows.push({ key: "__add__", node: inner });
  } else if (node.type === "dict") {
    rows = Object.keys(record).map((key) => ({ key, node: inner }));
    rows.push({ key: "__add__", node: inner });
  }

  function childValue(key: string) {
    if (node.type === "object") return record[key];
    if (node.type === "array") return Array.isArray(value) ? value[Number(key)] : undefined;
    return record[key];
  }

  return <div className={`schema-field schema-container ${path.length > 0 ? "nested" : ""}`} data-path={path.join("/")}>
    <button className="schema-container-toggle" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
      <span aria-hidden="true">{open ? "⌄" : "›"}</span>
      <strong>{label}</strong>
      {description && <small>{description}</small>}
    </button>
    {open && <div className="schema-container-body">
      {rows.length === 0
        ? <p className="schema-empty">没有可编辑字段。</p>
        : rows.map(({ key, node: childNode }) => key === "__add__"
          ? <button type="button" className="schema-add-row" key="__add__" onClick={() => onChange([...path, "__draft__"], "")} disabled>数组项由 JSON 编辑管理</button>
          : childNode
            ? <SchemaField
              key={key}
              path={[...path, key]}
              node={childNode}
              envelope={envelope}
              value={childValue(key)}
              draft={draft}
              onChange={onChange}
            />
            : <p className="schema-empty" key={key}>字段 {key} 无法解析。</p>)}
    </div>}
  </div>;
}

function SchemaField(props: FieldProps) {
  const { node } = props;
  if (node.type === "object" || node.type === "array" || node.type === "dict") {
    return <ContainerField {...props} />;
  }
  return <PrimitiveField {...props} />;
}

export function SchemaFormPanel({ namespace, onSave, onCancel, saving }: SchemaFormProps) {
  const envelope = useMemo<Envelope | null>(() => {
    if (!isSchemaEnvelope(namespace.schema)) return null;
    return namespace.schema;
  }, [namespace.schema]);
  const [draft, setDraft] = useState<Record<string, FieldValue>>({});

  function onChange(path: string[], value: FieldValue) {
    setDraft((current) => {
      const next = { ...current };
      const key = path.join("/");
      if (value === null) delete next[key];
      else next[key] = value;
      return next;
    });
  }

  const ops: SchemaPathOp[] = useMemo(() => schemaDraftOps(draft), [draft]);

  if (!envelope) {
    return <div className="schema-form-empty">
      <strong>该命名空间没有可驱动的 Schema</strong>
      <p>请使用 JSON 编辑查看或修改公开设置。</p>
      <div className="schema-form-actions"><button type="button" onClick={onCancel}>关闭</button></div>
    </div>;
  }

  const root = schemaNodeAtRef(envelope, typeof envelope.uid === "number" ? envelope.uid : undefined);
  if (!root || root.type !== "object") {
    return <div className="schema-form-empty">
      <strong>Schema 根节点不是对象</strong>
      <p>该命名空间的结构无法用表单呈现，请使用 JSON 编辑。</p>
      <div className="schema-form-actions"><button type="button" onClick={onCancel}>关闭</button></div>
    </div>;
  }

  return <div className="schema-form">
    <div className="schema-form-head">
      <span className="schema-form-ns">{namespace.ns}</span>
      <em>{namespace.applies === "restart" ? "重启生效" : "实时生效"} · revision {namespace.revision}</em>
    </div>
    <SchemaField
      path={[]}
      node={root}
      envelope={envelope}
      value={namespace.user ?? {}}
      draft={draft}
      onChange={onChange}
    />
    <div className="schema-form-actions">
      <button type="button" onClick={onCancel} disabled={saving}>取消</button>
      <button type="button" className="confirm" disabled={saving || ops.length === 0} onClick={() => void onSave(ops, namespace.revision)}>
        {saving ? "保存中…" : ops.length > 0 ? `保存 ${ops.length} 项` : "保存"}
      </button>
    </div>
  </div>;
}