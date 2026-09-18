import {
  BookOpen,
  Bot,
  Code,
  FileImage,
  FilePenLine,
  FilePlus,
  FileSearch,
  FileText,
  FolderSearch,
  Globe,
  Link,
  ListChecks,
  MessageCircleQuestion,
  PackageOpen,
  Puzzle,
  Repeat,
  ScrollText,
  Search,
  Send,
  SquareTerminal,
  Target,
  Users,
  Workflow,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { toolGlyphKind, type ToolGlyphKind } from "../app/tool-call-display";

/**
 * 工具行左侧图标：字形说明“这次调用在做什么”，颜色由调用状态经 `currentColor`
 * 决定（见 23-interaction-motion.css），所以同一个工具在运行、成功、失败时
 * 只换颜色不换字形。
 */
const TOOL_GLYPH_ICONS: Record<ToolGlyphKind, LucideIcon> = {
  terminal: SquareTerminal,
  read: FileText,
  image: FileImage,
  write: FilePlus,
  edit: FilePenLine,
  search: Search,
  find: FolderSearch,
  web: Globe,
  fetch: Link,
  delegate: Bot,
  workflow: Workflow,
  repeat: Repeat,
  goal: Target,
  todo: ListChecks,
  question: MessageCircleQuestion,
  skill: BookOpen,
  job: ScrollText,
  deliver: PackageOpen,
  message: Send,
  agent: Users,
  session: FileSearch,
  code: Code,
  plugin: Puzzle,
  generic: Wrench,
};

export function ToolGlyph({ toolName }: { toolName: string | undefined }) {
  const Icon = TOOL_GLYPH_ICONS[toolGlyphKind(toolName)];
  return <Icon />;
}
