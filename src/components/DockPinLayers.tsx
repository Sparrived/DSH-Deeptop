import { createContext, useContext, type ReactNode } from "react";

/**
 * 钉住分栏层的 DOM 挂载点：App 在 workspace-layout 内渲染左右两个
 * 流内分栏容器，DockFrame 把钉住的卡片 portal 进对应层，使其成为
 * 真实的网格列（对话列由布局天然让位）。
 */
export type DockPinLayerSide = "left" | "right";

export type DockPinLayerElements = {
  left: HTMLElement | null;
  right: HTMLElement | null;
};

const DockPinLayersContext = createContext<DockPinLayerElements>({ left: null, right: null });

export function DockPinLayersProvider({ value, children }: { value: DockPinLayerElements; children: ReactNode }) {
  return <DockPinLayersContext.Provider value={value}>{children}</DockPinLayersContext.Provider>;
}

export function useDockPinLayer(side: DockPinLayerSide): HTMLElement | null {
  return useContext(DockPinLayersContext)[side];
}
