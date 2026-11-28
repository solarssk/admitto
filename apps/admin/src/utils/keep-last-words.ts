const NO_BREAK_SPACE = " ";

/**
 * Keeps the end of a sentence together on one line: a text that wraps must not end on a lone word ("gateway." alone) or a pair of
 * little words ("it does."). The last two words are joined with a no-break space, and the last three when those two are short.
 * Running text has `text-wrap: pretty` from the body, but Chrome leaves such a line alone, so the texts that were measured to end on
 * one are given this. Not for text that is copied or compared as it is written: the no-break space is a different character.
 */
export function keepLastWords(text: string): string {
  const words = text.split(" ");
  if (words.length < 3) return text;
  const tail = words.slice(-2).join(" ");
  const bound = tail.length < 14 && words.length >= 4 ? 3 : 2;
  return [...words.slice(0, -bound), words.slice(-bound).join(NO_BREAK_SPACE)].join(" ");
}
