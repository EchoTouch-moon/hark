//! Lexical support checks for memory and opinion writes.
//!
//! This is not an LLM and not a semantic entailment framework. If a decision
//! cannot be checked against stored wording, the caller gets needs_clarification
//! instead of a false "decided". Ordinary quotes and opinion overlap still use
//! `text_supports`; only decisions use `decision_supports`.

pub(crate) fn fold_ascii(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

pub(crate) fn normalize_match(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_whitespace() && !is_ignorable_punct(*c))
        .map(|c| {
            if c.is_ascii() {
                c.to_ascii_lowercase()
            } else {
                c
            }
        })
        .collect()
}

fn is_ignorable_punct(c: char) -> bool {
    matches!(
        c,
        '，' | '。'
            | '！'
            | '？'
            | '、'
            | '；'
            | '：'
            | ','
            | '.'
            | '!'
            | '?'
            | ';'
            | ':'
            | '"'
            | '\''
            | '“'
            | '”'
            | '‘'
            | '’'
            | '（'
            | '）'
            | '('
            | ')'
            | '【'
            | '】'
            | '['
            | ']'
            | '《'
            | '》'
            | '…'
            | '—'
            | '·'
    )
}

const STRENGTHENING: &[&str] = &[
    "彻底",
    "已彻底",
    "已切换",
    "已经切换",
    "已迁移",
    "已经迁移",
    "完全切换",
    "完全迁移",
    "永远",
    "总是",
    "所有项目",
    "全局偏好",
    "全局记忆",
    "completely",
    "fully switched",
    "already migrated",
    "already switched",
    "definitely",
    "always",
    "every project",
    "global preference",
];

pub(crate) fn strengthening_introduced(proposal: &str, source: &str) -> bool {
    let proposal = fold_ascii(proposal);
    let source = fold_ascii(source);
    STRENGTHENING.iter().any(|marker| {
        let marker = fold_ascii(marker);
        proposal.contains(&marker) && !source.contains(&marker)
    })
}

/// User-message support. Substring quotes pass. Otherwise every significant
/// token must already be in the source, and the proposal cannot be longer.
pub(crate) fn text_supports(proposal: &str, source: &str) -> bool {
    let proposal = proposal.trim();
    let source = source.trim();
    if proposal.is_empty() || source.is_empty() || strengthening_introduced(proposal, source) {
        return false;
    }
    let folded_proposal = normalize_match(proposal);
    let folded_source = normalize_match(source);
    if folded_proposal.is_empty() {
        return false;
    }
    if folded_source.contains(&folded_proposal) {
        return true;
    }
    if proposal.chars().count() > source.chars().count().saturating_add(8) {
        return false;
    }
    let tokens = significant_tokens(proposal);
    !tokens.is_empty()
        && tokens
            .iter()
            .all(|token| folded_source.contains(&normalize_match(token)))
}

/// Decision support is stricter than a quote or an opinion overlap.
///
/// A complete quote keeps negation and trial wording. A partial quote is an
/// affirmative decision only when the omitted text is a neutral frame such as
/// 「我们决定」 or 「改为」. Dropping a negation, question, condition, or other
/// qualifier is not support. Questions and explicit “not yet” wording are not
/// decisions, even when copied in full.
pub(crate) fn decision_supports(proposal: &str, source: &str) -> bool {
    let proposal = proposal.trim();
    let source = source.trim();
    if proposal.is_empty() || source.is_empty() || strengthening_introduced(proposal, source) {
        return false;
    }
    if message_defers_decision(source) {
        return false;
    }
    let folded_proposal = normalize_match(proposal);
    let folded_source = normalize_match(source);
    if folded_proposal.is_empty() {
        return false;
    }
    if folded_proposal == folded_source {
        return !sentence_is_question(source);
    }
    quote_spans(source, proposal)
        .into_iter()
        .any(|(start, end)| {
            let (sent_start, sent_end) = sentence_bounds(source, start, end);
            let sentence = &source[sent_start..sent_end];
            if sentence_is_question(sentence) {
                return false;
            }
            let prefix = source[sent_start..start].trim();
            let suffix = source[end..sent_end].trim();
            suffix_is_only_closer(suffix) && is_neutral_frame(prefix)
        })
}

/// File excerpts are truncated stored text. Only a contained quote counts.
/// This function does not open the file.
pub(crate) fn file_quote_supports(proposal: &str, excerpt: &str) -> bool {
    let proposal = proposal.trim();
    let excerpt = excerpt.trim();
    if proposal.is_empty() || excerpt.is_empty() || strengthening_introduced(proposal, excerpt) {
        return false;
    }
    let folded_proposal = normalize_match(proposal);
    let folded_excerpt = normalize_match(excerpt);
    !folded_proposal.is_empty() && folded_excerpt.contains(&folded_proposal)
}

/// Opinion overlap is weaker than decision support, and still not a fact check.
/// A summary with no shared substantive token is not treated as evidenced.
pub(crate) fn evidence_overlaps(summary: &str, evidence: &str) -> bool {
    let evidence = normalize_match(evidence);
    if evidence.is_empty() {
        return false;
    }
    overlap_tokens(summary)
        .into_iter()
        .any(|token| !is_weak_token(&token) && evidence.contains(&normalize_match(&token)))
}

pub(crate) fn explicit_experience_confirmation(source: &str) -> bool {
    const PHRASES: &[&str] = &[
        "记住这点",
        "记住这一点",
        "请记住",
        "以后都",
        "以后就按",
        "这是经验",
        "作为经验",
        "remember this",
        "from now on",
        "as a rule",
    ];
    let folded = fold_ascii(source);
    PHRASES
        .iter()
        .any(|phrase| folded.contains(&fold_ascii(phrase)))
}

pub(crate) fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3400}'..='\u{9FFF}' | '\u{F900}'..='\u{FAFF}')
}

fn significant_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut ascii = String::new();
    let mut cjk = String::new();
    let flush_ascii = |ascii: &mut String, out: &mut Vec<String>| {
        if ascii.chars().count() >= 2 {
            out.push(std::mem::take(ascii).to_ascii_lowercase());
        } else {
            ascii.clear();
        }
    };
    let flush_cjk = |cjk: &mut String, out: &mut Vec<String>| {
        let chars: Vec<char> = cjk.chars().collect();
        cjk.clear();
        if chars.len() == 1 {
            out.push(chars[0].to_string());
        } else {
            for pair in chars.windows(2) {
                out.push(pair.iter().collect());
            }
        }
    };
    for ch in text.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '+' | '#' | '_') {
            if !cjk.is_empty() {
                flush_cjk(&mut cjk, &mut out);
            }
            ascii.push(ch);
        } else if is_cjk(ch) {
            if !ascii.is_empty() {
                flush_ascii(&mut ascii, &mut out);
            }
            cjk.push(ch);
        } else {
            if !ascii.is_empty() {
                flush_ascii(&mut ascii, &mut out);
            }
            if !cjk.is_empty() {
                flush_cjk(&mut cjk, &mut out);
            }
        }
    }
    if !ascii.is_empty() {
        flush_ascii(&mut ascii, &mut out);
    }
    if !cjk.is_empty() {
        flush_cjk(&mut cjk, &mut out);
    }
    out
}

fn overlap_tokens(text: &str) -> Vec<String> {
    significant_tokens(text)
        .into_iter()
        .filter(|token| token.chars().count() >= 2)
        .collect()
}

fn is_skipped(c: char) -> bool {
    c.is_whitespace() || is_ignorable_punct(c)
}

fn chars_equal(left: char, right: char) -> bool {
    if left.is_ascii() && right.is_ascii() {
        left.to_ascii_lowercase() == right.to_ascii_lowercase()
    } else {
        left == right
    }
}

fn is_sentence_boundary(c: char) -> bool {
    matches!(c, '。' | '！' | '？' | '!' | '?' | '；' | ';' | '\n')
}

fn sentence_bounds(source: &str, start: usize, end: usize) -> (usize, usize) {
    let mut sent_start = 0;
    for (index, ch) in source.char_indices() {
        if index >= start {
            break;
        }
        if is_sentence_boundary(ch) {
            sent_start = index + ch.len_utf8();
        }
    }
    let mut sent_end = source.len();
    for (index, ch) in source.char_indices() {
        if index < end {
            continue;
        }
        if is_sentence_boundary(ch) {
            sent_end = index + ch.len_utf8();
            break;
        }
    }
    (sent_start, sent_end)
}

/// Contiguous quote spans, ignoring whitespace and punctuation.
fn quote_spans(source: &str, proposal: &str) -> Vec<(usize, usize)> {
    let needle: Vec<char> = proposal.chars().filter(|ch| !is_skipped(*ch)).collect();
    if needle.is_empty() {
        return Vec::new();
    }
    let chars: Vec<(usize, char)> = source.char_indices().collect();
    let mut spans = Vec::new();
    for start_at in 0..chars.len() {
        if is_skipped(chars[start_at].1) || !chars_equal(chars[start_at].1, needle[0]) {
            continue;
        }
        let mut needle_at = 0;
        let mut cursor = start_at;
        let mut end = chars[start_at].0;
        let mut matched = true;
        while needle_at < needle.len() {
            if cursor >= chars.len() {
                matched = false;
                break;
            }
            let (byte, ch) = chars[cursor];
            if is_skipped(ch) {
                cursor += 1;
                continue;
            }
            if !chars_equal(ch, needle[needle_at]) {
                matched = false;
                break;
            }
            end = byte + ch.len_utf8();
            needle_at += 1;
            cursor += 1;
        }
        if matched {
            spans.push((chars[start_at].0, end));
        }
    }
    spans
}

fn suffix_is_only_closer(suffix: &str) -> bool {
    suffix
        .chars()
        .all(|ch| ch.is_whitespace() || is_ignorable_punct(ch) || is_sentence_boundary(ch))
}

fn is_neutral_frame(prefix: &str) -> bool {
    let folded = normalize_match(prefix);
    if folded.is_empty() {
        return true;
    }
    const FRAMES: &[&str] = &[
        "我们决定",
        "我决定",
        "所以决定",
        "我们改为",
        "改为",
        "改成",
        "那就",
        "决定",
    ];
    FRAMES.iter().any(|frame| folded == normalize_match(frame))
}

fn sentence_is_question(sentence: &str) -> bool {
    let folded = fold_ascii(sentence);
    folded.contains('？')
        || folded.contains('?')
        || folded.contains("是否")
        || folded.contains('吗')
}

fn message_defers_decision(source: &str) -> bool {
    let folded = fold_ascii(source);
    const DEFERRALS: &[&str] = &[
        "先别决定",
        "别决定",
        "暂不决定",
        "还没决定",
        "尚未决定",
        "不要决定",
        "先不要决定",
        "don't decide",
        "do not decide",
        "not decided",
    ];
    DEFERRALS
        .iter()
        .any(|phrase| folded.contains(&fold_ascii(phrase)))
}

fn is_weak_token(token: &str) -> bool {
    matches!(
        token,
        "我们"
            | "可以"
            | "这个"
            | "一个"
            | "如果"
            | "但是"
            | "以及"
            | "不是"
            | "the"
            | "and"
            | "for"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bun_fallback_is_not_a_completed_switch() {
        let source = "先试 Bun，Node 保底";
        assert!(text_supports(source, source));
        assert!(!text_supports("已彻底切换 Bun", source));
        assert!(!text_supports("已切换 Bun", source));
        assert!(text_supports("先试 Bun", source));
    }

    #[test]
    fn global_preference_is_not_inferred() {
        assert!(strengthening_introduced(
            "提升为全局偏好",
            "这个项目先用 Tauri"
        ));
    }

    #[test]
    fn decision_support_rejects_stripped_affirmative_quotes() {
        let stripped = [
            "我们决定不采用 Bun，继续使用 Node。",
            "是否采用 Bun？先别决定。",
            "如果测试通过，再采用 Bun。",
        ];
        for source in stripped {
            assert!(
                text_supports("采用 Bun", source),
                "citation overlap still sees the words: {source}"
            );
            assert!(!decision_supports("采用 Bun", source), "{source}");
        }
        assert!(decision_supports(
            "我决定不采用Bun，继续Node",
            "我决定不采用Bun，继续Node"
        ));
        assert!(decision_supports(
            "先试Bun，Node保底",
            "先试 Bun，Node 保底"
        ));
        assert!(decision_supports("我决定采用 Bun", "我决定采用 Bun。"));
        assert!(decision_supports(
            "先用 Tauri 做桌面壳",
            "我们决定先用 Tauri 做桌面壳"
        ));
        assert!(decision_supports(
            "先用 Tauri，Electron 不做了",
            "改为先用 Tauri，Electron 不做了"
        ));
        assert!(!decision_supports("已彻底切换 Bun", "先试 Bun，Node 保底"));
        assert!(!decision_supports("先试 Bun", "先试 Bun，Node 保底"));
        assert!(!decision_supports(
            "是否采用 Bun？先别决定。",
            "是否采用 Bun？先别决定。"
        ));
    }
}
