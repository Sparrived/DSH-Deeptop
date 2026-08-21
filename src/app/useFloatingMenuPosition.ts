import { useLayoutEffect, useRef, useState } from "react";
import { positionFloatingMenu } from "./context-menu";

type FloatingMenuAnchor = { x: number; y: number } | null;

export type FloatingMenuPlacement = { left: number; top: number } | null;

/** 浮动右键菜单的测量定位。菜单默认以锚点为左上角向下展开，靠近窗口底部会被裁切：
 *  先按锚点渲染并测量实际尺寸，再在绘制前用 positionFloatingMenu 限制在窗体内、
 *  必要时向上翻转；窗口尺寸变化时重新定位。锚点置空时清空定位状态。 */
export function useFloatingMenuPosition(anchor: FloatingMenuAnchor) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuAt, setMenuAt] = useState<FloatingMenuPlacement>(null);

  useLayoutEffect(() => {
    if (!anchor) {
      setMenuAt(null);
      return;
    }
    const reposition = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = menu.getBoundingClientRect();
      setMenuAt(positionFloatingMenu(
        anchor.x,
        anchor.y,
        rect.width,
        rect.height,
        window.innerWidth,
        window.innerHeight,
      ));
    };
    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [anchor]);

  return { menuRef, menuAt };
}