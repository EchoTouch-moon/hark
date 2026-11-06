//! Lexical support checks for memory and opinion writes.
//!
//! This is not an LLM and not a semantic entailment framework. If a decision
//! cannot be checked against stored wording, the caller gets needs_clarification
//! instead of a false "decided".

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
}
