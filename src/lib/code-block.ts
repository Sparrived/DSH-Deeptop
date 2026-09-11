/**
 * Split one code block into display lines.
 *
 * A single trailing newline terminates the block rather than opening an extra
 * empty line, and joining the result reproduces the source exactly — so the
 * copied text and the numbered rendering cannot drift apart.
 *
 * @param source - the block's rendered text.
 * @returns one entry per displayed line; an empty block yields one empty line.
 */
export function codeBlockLines(source: string): string[] {
  return source.replace(/\n$/, "").split("\n");
}
