/**
 * `read_image` 结果的样式识别。
 *
 * 该工具的结果内容是一段面向模型的信封文本加一个图片块：
 *
 * ```text
 * <path>…</path>
 * <type>image</type>
 * <content>
 * image/png image, 1024x768 px, 204800 bytes
 * </content>
 * ```
 *
 * 图片本身走附件，展示在结果区的图库里；信封文本对读者只剩路径与尺寸信息，
 * 因此这里把它解析成两段可读文本，而不是把 XML 信封当正文显示。「查看原文」
 * 仍然保留完整信封。只有形状完整的信封才被识别，其他任何文本放弃解析，交回
 * 通用结果视图。
 */

/** 信封解析结果：读取到的路径与图片描述行。 */
export type ImageResultEnvelope = {
  path: string;
  detail: string;
};

const ENVELOPE_PATTERN = /^<path>([\s\S]*?)<\/path>\n<type>image<\/type>\n<content>\n([\s\S]*)\n<\/content>$/u;

/**
 * 把 `read_image` 的模型信封文本解析成路径与描述行。
 * @param text - 工具结果的文本内容。
 * @returns 匹配信封时的路径与描述行；其他文本返回 undefined。
 */
export function imageResultEnvelope(text: string): ImageResultEnvelope | undefined {
  const match = ENVELOPE_PATTERN.exec(text.trim());
  if (!match) return undefined;
  const path = match[1]!.trim();
  const detail = match[2]!.trim();
  return path && detail ? { path, detail } : undefined;
}
