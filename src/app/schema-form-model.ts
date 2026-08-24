/**
 * Pure helpers for the Schema-driven settings form: the draft-to-ops mapping
 * and the field value vocabulary. Kept free of React so the Node test runner
 * can import it directly.
 */

export type SchemaPathOp = { op: "set" | "unset"; path: string[]; value?: unknown };

/** One edited primitive value; null marks "clear this field" (emits unset). */
export type SchemaFieldValue = string | number | boolean | null;

export type SchemaDraft = Record<string, SchemaFieldValue>;

/**
 * Build the `settings.mutate` ops for a touched-field draft. Only fields the
 * user actually edited are emitted; untouched fields (and stored secrets) are
 * never rewritten. A null value clears the field (unset).
 */
export function schemaDraftOps(draft: SchemaDraft): SchemaPathOp[] {
  return Object.entries(draft).map(([key, value]) => (
    value === null ? { op: "unset", path: key.split("/") } : { op: "set", path: key.split("/"), value }
  ));
}