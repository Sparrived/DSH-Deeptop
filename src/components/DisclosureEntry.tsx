import type { ReactNode } from "react";

/**
 * 折叠横条外壳：摘要按钮 + 常驻正文（折叠层 → 裁剪层 → 正文）。
 *
 * 对话流里的工具、上下文注入、工作流横条，以及子代理抽屉里的工具横条都用它，
 * 与 Think 卡片、步骤摘要条共用同一套开合过渡（25-turn-groups.css 里的
 * `grid-template-rows: 0fr ↔ 1fr`）：正文常驻，所以收起和展开都有动画；裁剪层
 * 自己没有内边距，折叠时行高才能真正归零，不会漏出正文首行。
 *
 * 子元素类名按 `base` 派生：`base-summary` / `base-collapse` / `base-clip`，
 * 各自的外观（排版、配色、边框）继续由所在横条自己的规则负责。
 */
export function DisclosureEntry({
  base,
  className,
  open,
  onToggle,
  summary,
  children,
  "data-tool-status": dataToolStatus,
  "data-workflow-status": dataWorkflowStatus,
}: {
  /** 根 class，同时作为子元素类名前缀。 */
  base: string;
  /** 追加到根元素的 class（状态修饰符）。 */
  className?: string;
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  "data-tool-status"?: string;
  "data-workflow-status"?: string;
}) {
  return (
    <div
      className={`${base}${className ? ` ${className}` : ""}`}
      data-open={open ? "true" : "false"}
      {...(dataToolStatus === undefined ? {} : { "data-tool-status": dataToolStatus })}
      {...(dataWorkflowStatus === undefined ? {} : { "data-workflow-status": dataWorkflowStatus })}
    >
      <button type="button" className={`${base}-summary`} aria-expanded={open} onClick={onToggle}>
        {summary}
      </button>
      <div className={`${base}-collapse`}>
        <div className={`${base}-clip`}>{children}</div>
      </div>
    </div>
  );
}
