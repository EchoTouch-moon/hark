import test from "node:test";
import assert from "node:assert/strict";
import {
  tokenizeMarkdown,
  parseInlineSpans,
} from "./parser.ts";

test("tokenizeMarkdown handles headings, paragraphs and dividers", () => {
  const md = `# 第一阶段：项目骨架梳理\n\n这是对项目的核心定位剖析。\n\n---\n\n## 第二阶段：演进建议`;
  const tokens = tokenizeMarkdown(md);

  assert.equal(tokens.length, 4);
  assert.deepEqual(tokens[0], {
    type: "heading",
    level: 1,
    text: "第一阶段：项目骨架梳理",
  });
  assert.deepEqual(tokens[1], {
    type: "paragraph",
    text: "这是对项目的核心定位剖析。",
  });
  assert.deepEqual(tokens[2], { type: "hr" });
  assert.deepEqual(tokens[3], {
    type: "heading",
    level: 2,
    text: "第二阶段：演进建议",
  });
});

test("tokenizeMarkdown correctly partitions ordered list items for cardified rendering", () => {
  const md = `1. **架构模块化**：建议将通信模块独立拆分为 SDK\n2. **离线缓存**：引入轻量 SQLite 缓存层\n3. **错误对账**：完善 unverified 状态重试`;
  const tokens = tokenizeMarkdown(md);

  assert.equal(tokens.length, 1);
  assert.equal(tokens[0]?.type, "ordered_list");
  if (tokens[0]?.type === "ordered_list") {
    assert.equal(tokens[0].items.length, 3);
    assert.match(tokens[0].items[0]!, /架构模块化/);
    assert.match(tokens[0].items[1]!, /离线缓存/);
    assert.match(tokens[0].items[2]!, /错误对账/);
  }
});

test("tokenizeMarkdown gracefully closes unclosed codeblock during streaming", () => {
  const streamingMd = "下面是配置示例：\n```typescript\nconst port = 1420;\nconst host = '127.0.0.1';";
  const tokens = tokenizeMarkdown(streamingMd);

  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]?.type, "paragraph");
  assert.equal(tokens[1]?.type, "code");
  if (tokens[1]?.type === "code") {
    assert.equal(tokens[1].lang, "typescript");
    assert.equal(tokens[1].code, "const port = 1420;\nconst host = '127.0.0.1';");
  }
});

test("tokenizeMarkdown handles closed code block with language", () => {
  const md = "```rust\nfn main() {\n    println!(\"Hello\");\n}\n```";
  const tokens = tokenizeMarkdown(md);

  assert.equal(tokens.length, 1);
  assert.deepEqual(tokens[0], {
    type: "code",
    lang: "rust",
    code: "fn main() {\n    println!(\"Hello\");\n}",
  });
});

test("tokenizeMarkdown handles blockquotes and unordered lists", () => {
  const md = "> 重要事实依据：已阅读 Cargo.toml\n\n- 前端：React 19\n- 桌面壳：Tauri 2\n- 运行时：Node 22";
  const tokens = tokenizeMarkdown(md);

  assert.equal(tokens.length, 2);
  assert.equal(tokens[0]?.type, "blockquote");
  assert.equal(tokens[1]?.type, "unordered_list");
  if (tokens[1]?.type === "unordered_list") {
    assert.equal(tokens[1].items.length, 3);
  }
});

test("parseInlineSpans extracts code, bold, links, and text segments", () => {
  const inlineText = "请关注 `apps/desktop` 中的 **native-shell** 模块，详见 [官网](https://example.com)。";
  const spans = parseInlineSpans(inlineText);

  assert.equal(spans[0]?.type, "text");
  assert.equal(spans[0]?.value, "请关注 ");
  assert.equal(spans[1]?.type, "code");
  assert.equal(spans[1]?.value, "apps/desktop");
  assert.equal(spans[2]?.type, "text");
  assert.equal(spans[2]?.value, " 中的 ");
  assert.equal(spans[3]?.type, "bold");
  assert.equal(spans[3]?.value, "native-shell");
  assert.equal(spans[4]?.type, "text");
  assert.equal(spans[4]?.value, " 模块，详见 ");
  assert.equal(spans[5]?.type, "link");
  if (spans[5]?.type === "link") {
    assert.equal(spans[5].text, "官网");
    assert.equal(spans[5].url, "https://example.com");
  }
  assert.equal(spans[6]?.type, "text");
  assert.equal(spans[6]?.value, "。");
});
