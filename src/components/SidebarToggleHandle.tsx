import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { t, type UiLocale } from "../app/i18n";

type SidebarToggleHandleProps = {
  /** 界面语言：按钮的可访问名称按语言渲染。 */
  locale?: UiLocale;
  collapsed: boolean;
  onToggle: () => void;
};

/** 会话语侧栏的收起开关：贴住侧栏靠对话一侧的右内边距并垂直居中，收起与展开
 *  时停在同一个位置。
 *
 *  位置与外观由 15-final-overrides.css 负责：把手挂在侧栏内部（.session-sidebar
 *  是它的定位基准），因此直接长在面板表面上——同一块底色、只在靠内一侧收圆角，
 *  也跟着侧栏这一列一起移动，不需要跨列同步过渡。 */
export function SidebarToggleHandle({ locale = "zh", collapsed, onToggle }: SidebarToggleHandleProps) {
  return (
    <button
      className="sidebar-toggle-handle"
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-controls="session-sidebar"
      title={t(collapsed ? "sidebar.expand" : "sidebar.collapse", locale)}
      aria-label={t(collapsed ? "sidebar.expand" : "sidebar.collapse", locale)}
    >{collapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}</button>
  );
}
