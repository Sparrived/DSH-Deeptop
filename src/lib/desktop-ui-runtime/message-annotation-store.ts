import type {
  DshMessageAnnotationItem,
  DshMessageAnnotationResult,
} from "../desktop";
import type { DeeptopClientContext } from "./types";
import { t } from "../../app/i18n.ts";

type AnnotationMap = Record<string, DshMessageAnnotationItem>;

export type AnnotationListResult = DshMessageAnnotationResult<{ items: DshMessageAnnotationItem[] }>;
export type AnnotationPutResult = DshMessageAnnotationResult<DshMessageAnnotationItem>;
export type AnnotationDeleteResult = DshMessageAnnotationResult<{ absent: true }>;

export interface AnnotationRemote {
  list(args: { sessionId: string }): Promise<AnnotationListResult>;
  put(args: { sessionId: string; messageId: string; note: string; ifVersion: string | null }): Promise<AnnotationPutResult>;
  delete(args: { sessionId: string; messageId: string; ifVersion: string }): Promise<AnnotationDeleteResult>;
}

export interface AnnotationMutation<T> {
  value: T;
  /** The Host committed after the UI moved to another session generation. */
  switched: boolean;
}

export interface AnnotationStore {
  get(sessionId: string): AnnotationMap;
  subscribe(listener: () => void): () => void;
  load(sessionId: string, generation: number): Promise<void>;
  put(sessionId: string, messageId: string, note: string, generation: number): Promise<AnnotationMutation<DshMessageAnnotationItem>>;
  remove(sessionId: string, messageId: string, version: string, generation: number): Promise<AnnotationMutation<void>>;
  dispose(): void;
}

function errorForResult<T>(result: DshMessageAnnotationResult<T>, action: "save" | "delete", locale: DeeptopClientContext["locale"]): T {
  if (result.ok) return result.value;
  const key = action === "save" ? "err.annotationSave" : "err.annotationDelete";
  const error = new Error(t(key, locale, { code: result.error.code }));
  Object.assign(error, { code: result.error.code, details: result.error });
  throw error;
}

/**
 * Create a session-generation guarded annotation cache. The store owns only
 * client cache state; validation, compare-and-set and durability remain Host
 * Service responsibilities.
 */
export function createMessageAnnotationStore(context: Pick<DeeptopClientContext, "remote" | "session" | "locale" | "logger">): AnnotationStore {
  const remote: AnnotationRemote = {
    list: (args) => context.remote.invokeIn<AnnotationListResult>("messageAnnotations", "list", args),
    put: (args) => context.remote.invokeIn<AnnotationPutResult>("messageAnnotations", "put", args),
    delete: (args) => context.remote.invokeIn<AnnotationDeleteResult>("messageAnnotations", "delete", args),
  };
  let currentSessionId: string | null = null;
  let currentGeneration = -1;
  let disposed = false;
  const values = new Map<string, AnnotationMap>();
  const emptyAnnotations: AnnotationMap = {};
  const revisions = new Map<string, number>();
  const loadTokens = new Map<string, number>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  const isCurrent = (sessionId: string, generation: number) => currentSessionId === sessionId && currentGeneration === generation;
  const nextLoadToken = (sessionId: string) => {
    const token = (loadTokens.get(sessionId) ?? 0) + 1;
    loadTokens.set(sessionId, token);
    return token;
  };
  const bumpRevision = (sessionId: string) => {
    const revision = (revisions.get(sessionId) ?? 0) + 1;
    revisions.set(sessionId, revision);
    return revision;
  };

  let sessionUnsubscribe: (() => void) | null = null;
  const store: AnnotationStore = {
    get: (sessionId) => values.get(sessionId) ?? emptyAnnotations,
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async load(sessionId, generation) {
      if (disposed) return;
      currentSessionId = sessionId;
      currentGeneration = generation;
      const token = nextLoadToken(sessionId);
      const revision = revisions.get(sessionId) ?? 0;
      const result = await remote.list({ sessionId });
      if (disposed || !isCurrent(sessionId, generation) || loadTokens.get(sessionId) !== token || (revisions.get(sessionId) ?? 0) !== revision) return;
      if (!result.ok) throw new Error(`annotation list failed: ${result.error.code}`);
      values.set(sessionId, Object.fromEntries(result.value.items.map((item) => [item.messageId, item])));
      notify();
    },
    async put(sessionId, messageId, note, generation) {
      if (disposed) throw new Error("message annotation store is disposed");
      const current = store.get(sessionId)[messageId];
      const operationRevision = bumpRevision(sessionId);
      const result = await remote.put({ sessionId, messageId, note, ifVersion: current?.version ?? null });
      const switched = disposed || !isCurrent(sessionId, generation);
      const canCommit = !switched && revisions.get(sessionId) === operationRevision;
      if (canCommit && !result.ok && result.error.code === "version-conflict") {
        const next = { ...store.get(sessionId) };
        if (result.error.current) next[messageId] = result.error.current;
        else delete next[messageId];
        values.set(sessionId, next);
        revisions.set(sessionId, operationRevision + 1);
        notify();
      }
      const item = errorForResult(result, "save", context.locale);
      if (canCommit) {
        values.set(sessionId, { ...store.get(sessionId), [messageId]: item });
        revisions.set(sessionId, operationRevision + 1);
        notify();
      }
      return { value: item, switched };
    },
    async remove(sessionId, messageId, version, generation) {
      if (disposed) throw new Error("message annotation store is disposed");
      const operationRevision = bumpRevision(sessionId);
      const result = await remote.delete({ sessionId, messageId, ifVersion: version });
      const switched = disposed || !isCurrent(sessionId, generation);
      const canCommit = !switched && revisions.get(sessionId) === operationRevision;
      if (canCommit && !result.ok && result.error.code === "version-conflict") {
        const next = { ...store.get(sessionId) };
        if (result.error.current) next[messageId] = result.error.current;
        else delete next[messageId];
        values.set(sessionId, next);
        revisions.set(sessionId, operationRevision + 1);
        notify();
      }
      errorForResult(result, "delete", context.locale);
      if (canCommit) {
        const next = { ...store.get(sessionId) };
        delete next[messageId];
        values.set(sessionId, next);
        revisions.set(sessionId, operationRevision + 1);
        notify();
      }
      return { value: undefined, switched };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      sessionUnsubscribe?.();
      sessionUnsubscribe = null;
      listeners.clear();
      values.clear();
      currentSessionId = null;
      currentGeneration = -1;
    },
  };

  sessionUnsubscribe = context.session.onChange((session) => {
    if (disposed) return;
    if (!session) {
      currentSessionId = null;
      currentGeneration = context.session.generation;
      notify();
      return;
    }
    currentSessionId = session.sessionId;
    currentGeneration = context.session.generation;
    values.set(session.sessionId, {});
    notify();
    void store.load(session.sessionId, context.session.generation).catch((error) => context.logger.warn(String(error)));
  });
  return store;
}
