import type { DshHistoryEntry } from "../lib/desktop";

export type RetryImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export type RetryPromptSourcePart =
  | { type: "text"; text: string }
  | {
      type: "image";
      mediaType: RetryImageMediaType;
      name?: string;
      data?: string;
      attachmentId?: string;
    };

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function imageMediaType(value: unknown): RetryImageMediaType | undefined {
  return value === "image/png" || value === "image/jpeg" || value === "image/webp" || value === "image/gif"
    ? value
    : undefined;
}

function base64Data(value: string) {
  if (!value.startsWith("data:")) return value;
  const separator = value.indexOf(",");
  return separator >= 0 ? value.slice(separator + 1) : value;
}

export function retryPromptSourceParts(content: unknown): RetryPromptSourcePart[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];

  const parts: RetryPromptSourcePart[] = [];
  for (const blockValue of content) {
    const block = recordValue(blockValue);
    if (!block) continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text });
      continue;
    }
    if (block.type !== "image") {
      throw new Error(`历史消息包含暂不支持重发的内容类型：${String(block.type ?? "unknown")}`);
    }

    const attachment = recordValue(block.attachment);
    const mediaType = imageMediaType(block.mediaType) ?? imageMediaType(attachment?.mediaType);
    const data = typeof block.data === "string" ? base64Data(block.data) : undefined;
    const attachmentId = typeof attachment?.attachmentId === "string"
      ? attachment.attachmentId
      : typeof block.attachmentId === "string" ? block.attachmentId : undefined;
    const name = typeof block.name === "string"
      ? block.name
      : typeof attachment?.name === "string" ? attachment.name : undefined;
    if (!mediaType || (!data && !attachmentId)) throw new Error("历史消息中的图片引用无效");
    parts.push({
      type: "image",
      mediaType,
      ...(name ? { name } : {}),
      ...(data ? { data } : {}),
      ...(attachmentId ? { attachmentId } : {}),
    });
  }
  return parts;
}

export function retryBoundarySeq(entries: DshHistoryEntry[], targetSeq: number): number | undefined {
  let boundary: number | undefined;
  for (const entry of entries) {
    const event = entry.event;
    if (event.seq >= targetSeq || event.type !== "turn/end") continue;
    if (boundary === undefined || event.seq > boundary) boundary = event.seq;
  }
  return boundary;
}
