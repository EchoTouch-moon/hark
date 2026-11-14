/**
 * 块级 AST Token 声明
 */
export type BlockToken =
  | { type: "heading"; level: number; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "blockquote"; lines: string[] }
  | { type: "ordered_list"; items: string[] }
  | { type: "unordered_list"; items: string[] }
  | { type: "hr" }
  | { type: "paragraph"; text: string };

export type InlineSpan =
  | { type: "text"; value: string }
  | { type: "code"; value: string }
  | { type: "bold"; value: string }
  | { type: "italic"; value: string }
  | { type: "strike"; value: string }
  | { type: "link"; text: string; url: string };

/**
 * 解析行内 Markdown 元素为纯数据结构
 */
export function parseInlineSpans(text: string): InlineSpan[] {
  if (!text) return [];

  const regex = /(`([^`]+)`)|(\*\*([^*]+)\*\*)|(~~([^~]+)~~)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/g;

  const spans: InlineSpan[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      spans.push({ type: "text", value: text.slice(lastIndex, matchStart) });
    }

    if (match[2] !== undefined) {
      spans.push({ type: "code", value: match[2] });
    } else if (match[4] !== undefined) {
      spans.push({ type: "bold", value: match[4] });
    } else if (match[6] !== undefined) {
      spans.push({ type: "strike", value: match[6] });
    } else if (match[8] !== undefined) {
      spans.push({ type: "italic", value: match[8] });
    } else if (match[10] !== undefined && match[11] !== undefined) {
      spans.push({ type: "link", text: match[10], url: match[11] });
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    spans.push({ type: "text", value: text.slice(lastIndex) });
  }

  return spans;
}

/**
 * 健壮的流式友好 Markdown 块解析器
 */
export function tokenizeMarkdown(markdown: string): BlockToken[] {
  if (!markdown) return [];

  const lines = markdown.split(/\r?\n/);
  const tokens: BlockToken[] = [];

  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  let inBlockquote = false;
  let blockquoteLines: string[] = [];

  let inOrderedList = false;
  let orderedListItems: string[] = [];

  let inUnorderedList = false;
  let unorderedListItems: string[] = [];

  let pendingParagraph: string[] = [];

  const flushParagraph = () => {
    if (pendingParagraph.length > 0) {
      const text = pendingParagraph.join("\n").trim();
      if (text) {
        tokens.push({ type: "paragraph", text });
      }
      pendingParagraph = [];
    }
  };

  const flushBlockquote = () => {
    if (inBlockquote && blockquoteLines.length > 0) {
      tokens.push({ type: "blockquote", lines: [...blockquoteLines] });
      blockquoteLines = [];
      inBlockquote = false;
    }
  };

  const flushOrderedList = () => {
    if (inOrderedList && orderedListItems.length > 0) {
      tokens.push({ type: "ordered_list", items: [...orderedListItems] });
      orderedListItems = [];
      inOrderedList = false;
    }
  };

  const flushUnorderedList = () => {
    if (inUnorderedList && unorderedListItems.length > 0) {
      tokens.push({ type: "unordered_list", items: [...unorderedListItems] });
      unorderedListItems = [];
      inUnorderedList = false;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    const trimmed = rawLine.trim();

    // 1. 处理代码块 ```
    if (trimmed.startsWith("```")) {
      if (inCodeBlock) {
        tokens.push({
          type: "code",
          lang: codeLang,
          code: codeLines.join("\n"),
        });
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        flushParagraph();
        flushBlockquote();
        flushOrderedList();
        flushUnorderedList();
        inCodeBlock = true;
        codeLang = trimmed.slice(3).trim();
        codeLines = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine);
      continue;
    }

    // 2. 空行 -> 结清当前块
    if (!trimmed) {
      flushParagraph();
      flushBlockquote();
      flushOrderedList();
      flushUnorderedList();
      continue;
    }

    // 3. 引用块 >
    if (trimmed.startsWith(">")) {
      flushParagraph();
      flushOrderedList();
      flushUnorderedList();
      inBlockquote = true;
      blockquoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    } else if (inBlockquote) {
      flushBlockquote();
    }

    // 4. 水平分割线 --- 或 ***
    if (/^([-*_]){3,}$/.test(trimmed)) {
      flushParagraph();
      flushOrderedList();
      flushUnorderedList();
      tokens.push({ type: "hr" });
      continue;
    }

    // 5. 标题 # ~ ####
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch && headingMatch[1] && headingMatch[2]) {
      flushParagraph();
      flushOrderedList();
      flushUnorderedList();
      tokens.push({
        type: "heading",
        level: headingMatch[1].length,
        text: headingMatch[2].trim(),
      });
      continue;
    }

    // 6. 有序列表 (1. 或 1) )
    const orderedMatch = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (orderedMatch && orderedMatch[2]) {
      flushParagraph();
      flushUnorderedList();
      inOrderedList = true;
      orderedListItems.push(orderedMatch[2].trim());
      continue;
    } else if (inOrderedList && (rawLine.startsWith("  ") || rawLine.startsWith("\t"))) {
      const lastIdx = orderedListItems.length - 1;
      if (lastIdx >= 0) {
        orderedListItems[lastIdx] += "\n" + trimmed;
        continue;
      }
    } else if (inOrderedList) {
      flushOrderedList();
    }

    // 7. 无序列表 (- 或 * 或 +)
    const unorderedMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch && unorderedMatch[1]) {
      flushParagraph();
      flushOrderedList();
      inUnorderedList = true;
      unorderedListItems.push(unorderedMatch[1].trim());
      continue;
    } else if (inUnorderedList && (rawLine.startsWith("  ") || rawLine.startsWith("\t"))) {
      const lastIdx = unorderedListItems.length - 1;
      if (lastIdx >= 0) {
        unorderedListItems[lastIdx] += "\n" + trimmed;
        continue;
      }
    } else if (inUnorderedList) {
      flushUnorderedList();
    }

    // 8. 普通段落行
    pendingParagraph.push(trimmed);
  }

  // 结清可能遗留的块（如流式传输尚未闭合时的 code block）
  if (inCodeBlock) {
    tokens.push({
      type: "code",
      lang: codeLang,
      code: codeLines.join("\n"),
    });
  }
  flushParagraph();
  flushBlockquote();
  flushOrderedList();
  flushUnorderedList();

  return tokens;
}
