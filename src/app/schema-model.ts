/**
 * Schemastery serialized-schema helpers (pure data, no runtime Schema import).
 *
 * DSH settings namespaces expose `schema` as the vendored schemastery
 * `toJSON()` envelope: `{ uid, refs }` where `refs` maps schema-node uids to
 * their JSON nodes (`type`, `meta`, `dict`/`inner`/`list`/`value`, ...) and
 * nested references appear as numeric uids. The desktop never rehydrates a
 * live Schema; it only walks the envelope to drive option lists and readonly
 * forms, so this module stays a pure projection of the wire shape.
 */

type SchemaNode = {
  type?: string;
  meta?: Record<string, unknown>;
  value?: unknown;
  dict?: Record<string, unknown>;
  inner?: unknown;
  list?: unknown[];
  sKey?: unknown;
  bits?: Record<string, unknown>;
};

export function isSchemaEnvelope(value: unknown): value is { uid: unknown; refs: Record<string, SchemaNode> } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return "uid" in record && Boolean(record.refs) && typeof record.refs === "object" && !Array.isArray(record.refs);
}

function nodeUid(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

/** Resolve one node reference (uid number) against the envelope. */
export function schemaNodeAtRef(envelope: { uid: unknown; refs: Record<string, SchemaNode> }, uid: number | undefined): SchemaNode | undefined {
  if (uid === undefined) return undefined;
  return envelope.refs[String(uid)];
}

/** Return the root node of an envelope. */
export function schemaRootNode(envelope: { uid: unknown; refs: Record<string, SchemaNode> }): SchemaNode | undefined {
  return schemaNodeAtRef(envelope, nodeUid(envelope.uid));
}

/**
 * Walk one path from the root node. Object properties resolve through
 * `object.dict`; array items and dict values through `inner`; tuple positions
 * through `list`. Returns the node at the path, or undefined when any step is
 * missing — the caller decides whether the section was truncated.
 */
export function schemaNodeAtPath(
  envelope: { uid: unknown; refs: Record<string, SchemaNode> },
  path: ReadonlyArray<string | number>,
): SchemaNode | undefined {
  let current = schemaRootNode(envelope);
  for (const segment of path) {
    if (!current) return undefined;
    if (typeof segment === "number") {
      current = current.type === "tuple" ? schemaNodeAtRef(envelope, nodeUid(current.list?.[segment])) : undefined;
      continue;
    }
    if (current.type === "object") {
      current = schemaNodeAtRef(envelope, nodeUid(current.dict?.[segment]));
      continue;
    }
    if (current.type === "array" || current.type === "dict") {
      current = schemaNodeAtRef(envelope, nodeUid(current.inner));
      continue;
    }
    return undefined;
  }
  return current;
}

/** The enum choices declared by a const or union-of-consts node. */
export function schemaEnumChoices(node: SchemaNode | undefined, envelope: { uid: unknown; refs: Record<string, SchemaNode> }): Array<{ value: unknown; label?: string; description?: string }> {
  if (!node) return [];
  if (node.type === "const") {
    const label = stringMeta(node.meta, "name") ?? stringMeta(node.meta, "comment");
    const description = stringMeta(node.meta, "description");
    return [{ value: node.value, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) }];
  }
  if (node.type !== "union" || !Array.isArray(node.list)) return [];
  const choices: Array<{ value: unknown; label?: string; description?: string }> = [];
  for (const ref of node.list) {
    const member = schemaNodeAtRef(envelope, nodeUid(ref));
    if (!member || member.type !== "const") continue;
    const label = stringMeta(member.meta, "name") ?? stringMeta(member.meta, "comment");
    const description = stringMeta(member.meta, "description");
    choices.push({ value: member.value, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) });
  }
  return choices;
}

/** True when the node is an object whose dict includes every key in `keys`. */
export function schemaObjectHasKeys(node: SchemaNode | undefined, keys: readonly string[]): boolean {
  if (!node || node.type !== "object" || !node.dict) return false;
  return keys.every((key) => key in (node.dict as Record<string, unknown>));
}

function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}