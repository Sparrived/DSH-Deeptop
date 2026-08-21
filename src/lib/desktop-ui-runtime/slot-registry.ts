// In-memory Slot Registry (docs/DEEPTOP_UI_RUNTIME.md §7.6, §10). Pure
// TypeScript: no React, Tauri, or bridge imports at runtime, so node --test can
// drive the whole lifecycle directly.

import {
  compareContributionOrder,
  isUiRuntimeSlot,
  type DshDeclarativeContribution,
  type UiRuntimeSlot,
} from "../../app/ui-plugin-model.ts";
import type { RegisteredContribution, UiContribution } from "./types.ts";

export type RegistryListener = () => void;

interface RegistrationKey {
  pluginId: string;
  contributionId: string;
}

function registrationKey(pluginId: string, contributionId: string): string {
  return `${pluginId}\u0000${contributionId}`;
}

export class DuplicateContributionError extends Error {
  code = "duplicate-contribution";

  constructor(key: RegistrationKey) {
    super(`contribution "${key.contributionId}" of plugin "${key.pluginId}" is already registered`);
    this.name = "DuplicateContributionError";
  }
}

/**
 * One registry instance per UI runtime. Contributions are keyed by
 * pluginId + contribution id, ordered by (order, pluginId, id), and snapshots
 * stay referentially stable between mutations so React's useSyncExternalStore
 * can rely on identity checks.
 */
export class SlotRegistry {
  private entries = new Map<UiRuntimeSlot, Map<string, RegisteredContribution>>();
  private snapshots = new Map<UiRuntimeSlot, readonly RegisteredContribution[]>();
  private listeners = new Set<RegistryListener>();

  /**
   * Register one component-based contribution for a plugin.
   * @param allowedSlots - The plugin's manifest-declared slot whitelist; registrations outside it are rejected.
   */
  register(
    pluginId: string,
    allowedSlots: readonly string[],
    slot: UiRuntimeSlot,
    contribution: UiContribution,
  ): () => void {
    assertKnownSlot(slot);
    if (!allowedSlots.includes(slot)) {
      throw new Error(`plugin ${pluginId} is not allowed to register slot "${slot}" (manifest declares: ${allowedSlots.join(", ") || "none"})`);
    }
    if (typeof contribution.id !== "string" || contribution.id.trim() === "") {
      throw new Error(`plugin ${pluginId} registered a contribution without an id`);
    }
    if (typeof contribution.render !== "function") {
      throw new Error(`contribution "${contribution.id}" needs a render component`);
    }
    const key = registrationKey(pluginId, contribution.id);
    const bucket = this.bucketFor(slot);
    if (bucket.has(key)) throw new DuplicateContributionError({ pluginId, contributionId: contribution.id });
    const entry: RegisteredContribution = {
      pluginId,
      slot,
      contributionId: contribution.id,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      declarative: null,
      render: contribution.render,
    };
    bucket.set(key, entry);
    this.notify(slot);
    return () => {
      if (this.entries.get(slot)?.get(key) === entry) this.remove(slot, key);
    };
  }

  /** Register one host-declared contribution; the bridge has already validated its capabilities. */
  registerDeclarative(descriptor: {
    pluginId: string;
    allowedSlots: readonly string[];
    contribution: DshDeclarativeContribution;
  }): () => void {
    const { pluginId, allowedSlots, contribution } = descriptor;
    assertKnownSlot(contribution.slot);
    if (!allowedSlots.includes(contribution.slot)) {
      throw new Error(`plugin ${pluginId} declared contribution "${contribution.id}" on unregistered slot "${contribution.slot}"`);
    }
    const key = registrationKey(pluginId, contribution.id);
    const bucket = this.bucketFor(contribution.slot);
    if (bucket.has(key)) throw new DuplicateContributionError({ pluginId, contributionId: contribution.id });
    const entry: RegisteredContribution = {
      pluginId,
      slot: contribution.slot,
      contributionId: contribution.id,
      ...(contribution.order !== undefined ? { order: contribution.order } : {}),
      declarative: contribution,
    };
    bucket.set(key, entry);
    this.notify(contribution.slot);
    return () => {
      if (this.entries.get(contribution.slot)?.get(key) === entry) this.remove(contribution.slot, key);
    };
  }

  /** Remove every contribution of one plugin (deactivate path). Idempotent. */
  unregisterPlugin(pluginId: string): void {
    let removed = false;
    for (const [slot, bucket] of this.entries) {
      for (const [key, entry] of [...bucket]) {
        if (entry.pluginId === pluginId) {
          bucket.delete(key);
          removed = true;
        }
      }
      if (removed && bucket.size === 0) this.entries.delete(slot);
    }
    if (removed) this.invalidateSnapshots();
  }

  /** Stable ordered snapshot of one slot; safe to feed useSyncExternalStore. */
  snapshot(slot: UiRuntimeSlot): readonly RegisteredContribution[] {
    const cached = this.snapshots.get(slot);
    if (cached) return cached;
    const items = [...(this.entries.get(slot)?.values() ?? [])].sort((left, right) =>
      compareContributionOrder(
        { order: left.order, id: left.contributionId, pluginId: left.pluginId },
        { order: right.order, id: right.contributionId, pluginId: right.pluginId },
      ),
    );
    this.snapshots.set(slot, items);
    return items;
  }

  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private bucketFor(slot: UiRuntimeSlot): Map<string, RegisteredContribution> {
    let bucket = this.entries.get(slot);
    if (!bucket) {
      bucket = new Map();
      this.entries.set(slot, bucket);
    }
    return bucket;
  }

  private remove(slot: UiRuntimeSlot, key: string): void {
    const bucket = this.entries.get(slot);
    if (!bucket) return;
    bucket.delete(key);
    if (bucket.size === 0) this.entries.delete(slot);
    this.notify(slot);
  }

  private notify(slot?: UiRuntimeSlot): void {
    if (slot) this.snapshots.delete(slot);
    else this.snapshots.clear();
    for (const listener of [...this.listeners]) listener();
  }

  private invalidateSnapshots(): void {
    this.snapshots.clear();
  }
}

function assertKnownSlot(slot: UiRuntimeSlot): void {
  if (!isUiRuntimeSlot(slot)) throw new Error(`"${slot}" is not a known desktop UI slot`);
}
