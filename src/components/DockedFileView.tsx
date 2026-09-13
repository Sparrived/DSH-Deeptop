import { DockedImageView } from "./DockedImageView";
import { DockedTextFileView } from "./DockedTextFileView";
import { previewableImage } from "../app/image-preview-model";
import { sessionPath } from "../app/ui-model";
import type { UiLocale } from "../app/i18n";

type DockedFileViewProps = {
  /** 停靠标签；`path` 为会话相对或绝对路径，`line` 为 1-based 定位行。 */
  path: string;
  line?: number;
  /** 活动会话的工作目录，用于解析相对路径。 */
  cwd: string;
  locale?: UiLocale;
  onError?: (message: string) => void;
  /**
   * 图片预览在标签内翻到同目录的兄弟图片时，把当前标签改指到新路径。
   * 缺省时只显示打开的那一张，翻页入口一并禁用。
   */
  onNavigatePath?: (path: string) => void;
};

/**
 * 停靠标签里的文件预览：按文件类型分流。
 *
 * 分流点放在这里而不是各个入口：交付物卡片、工作区文件树、git 改动都经由
 * `DockTabBody` 的 `file` 标签打开文件，因此它们不需要各自判断该显示什么。
 * 图片走应用内预览（读取走原生桥接），其余交给按行读取的文本视图——非文本
 * 内容仍由原生侧判定并给出可读提示。
 */
export function DockedFileView({ path, line, cwd, locale = "zh", onError, onNavigatePath }: DockedFileViewProps) {
  return previewableImage(sessionPath(cwd, path))
    ? <DockedImageView path={path} cwd={cwd} locale={locale} onError={onError} onNavigatePath={onNavigatePath} />
    : <DockedTextFileView path={path} line={line} cwd={cwd} locale={locale} onError={onError} />;
}
