import { Parser, TokenizerMode, type DefaultTreeAdapterMap, type Token } from "parse5";

export interface SourceRange { startOffset: number; endOffset: number }
export interface HtmlSourceRanges {
  startTags: SourceRange[];
  comments: SourceRange[];
  structuralBoundaries: Set<number>;
}

/** Observe tokens before tree correction, including duplicate/ignored tags; never serialize. */
class ContextParser extends Parser<DefaultTreeAdapterMap> {
  readonly ranges: HtmlSourceRanges = { startTags: [], comments: [], structuralBoundaries: new Set() };
  consumedOffset = 0;
  private scriptStart: number | undefined;
  readonly scriptText: SourceRange[] = [];

  constructor() {
    super({ sourceCodeLocationInfo: true, scriptingEnabled: false });
  }

  private remember(token: Token.Token): void {
    if (token.location) this.consumedOffset = Math.max(this.consumedOffset, token.location.endOffset);
  }

  override onStartTag(token: Token.TagToken): void {
    this.remember(token);
    if (token.location) this.ranges.startTags.push({ startOffset: token.location.startOffset, endOffset: token.location.endOffset });
    super.onStartTag(token);
    if (token.location && this.tokenizer.state === TokenizerMode.SCRIPT_DATA) {
      this.scriptStart = token.location.endOffset;
    }
  }

  override onComment(token: Token.CommentToken): void {
    this.remember(token);
    if (token.location) this.ranges.comments.push({ startOffset: token.location.startOffset, endOffset: token.location.endOffset });
    super.onComment(token);
  }

  override onEndTag(token: Token.TagToken): void {
    this.remember(token);
    if (this.scriptStart !== undefined && token.tagName === "script" && token.location) {
      this.scriptText.push({ startOffset: this.scriptStart, endOffset: token.location.startOffset });
      this.scriptStart = undefined;
    }
    super.onEndTag(token);
  }

  finishScriptText(endOffset: number): void {
    if (this.scriptStart !== undefined) this.scriptText.push({ startOffset: this.scriptStart, endOffset });
  }
  override onDoctype(token: Token.DoctypeToken): void { this.remember(token); super.onDoctype(token); }
  override onCharacter(token: Token.CharacterToken): void { this.remember(token); super.onCharacter(token); }
  override onWhitespaceCharacter(token: Token.CharacterToken): void { this.remember(token); super.onWhitespaceCharacter(token); }
  override onNullCharacter(token: Token.CharacterToken): void { this.remember(token); super.onNullCharacter(token); }
}

/** HTML5 token boundaries cover raw-text/RCDATA, script escapes, namespaces and declarations. */
export function collectHtmlSourceRanges(html: string): HtmlSourceRanges {
  const parser = new ContextParser();
  parser.tokenizer.write(html, true);
  parser.finishScriptText(html.length);
  // HTML drops an unfinished start tag at EOF. Keep conservative attribute escaping for
  // that trailing source, without interpreting consumed raw text as a new tag.
  const tailStart = html.indexOf("<", parser.consumedOffset);
  if (tailStart !== -1 && /[A-Za-z]/.test(html.charAt(tailStart + 1))) {
    parser.ranges.startTags.push({ startOffset: tailStart, endOffset: html.length });
  }
  // A data slot must not complete an opener/end-tag name after substitution. Index
  // these prefix ends once; a backward scan at every placeholder would be quadratic.
  for (const match of html.matchAll(/<\/?[A-Za-z]*/g)) {
    const boundary = match.index + match[0].length;
    if (html.startsWith("{{", boundary)) parser.ranges.structuralBoundaries.add(boundary);
  }
  // Data can also complete a script's escaped-text terminator using a literal suffix.
  let scriptIndex = 0;
  for (const match of html.matchAll(/\{\{[a-z][a-z0-9_]*\}\}(?:>|->)/g)) {
    while (parser.scriptText.at(scriptIndex) && parser.scriptText.at(scriptIndex)!.endOffset <= match.index) scriptIndex++;
    const script = parser.scriptText.at(scriptIndex);
    if (script && script.startOffset <= match.index) parser.ranges.structuralBoundaries.add(match.index);
  }
  return parser.ranges;
}
