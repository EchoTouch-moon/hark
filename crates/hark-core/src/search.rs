//! Workspace search over a SQLite FTS5 projection plus bounded LIKE.
//!
//! Short terms (fewer than 3 Unicode characters, including 1–2 character
//! Chinese words) cannot use trigram MATCH. Those terms use parameterized
//! LIKE. That fallback is not an FTS rank. Ranking is hit count, current
//! before history, then kind. Old revisions stay searchable and are labeled
//! historical.

use rusqlite::{params, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::{CoreError, ErrorCode, Result};
use crate::grant::{self, RootStatus};
use crate::ids::WorkspaceId;
use crate::limits::{MAX_SEARCH_CANDIDATES, MAX_SEARCH_OFFSET, MAX_SEARCH_PAGE, MAX_SEARCH_TERMS};
use crate::messages;
use crate::support::{fold_ascii, is_cjk};
use crate::Core;

pub const SEARCH_NOTE: &str = "排序依据是命中词项数、当前优先于历史、类型；不是 FTS5 bm25。少于 3 个 Unicode 字符的词项走有界 LIKE，不是 FTS 排序。OR 召回不等于事实充分。";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MemorySearchInput {
    pub workspace_id: WorkspaceId,
    pub query: String,
    #[serde(default)]
    pub kinds: Option<Vec<String>>,
    #[serde(default)]
    pub cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchItem {
    pub id: String,
    pub workspace_id: WorkspaceId,
    pub kind: String,
    pub title: String,
    pub snippet: String,
    pub recorded_at: String,
    pub status_label: String,
    pub source_ref_id: Option<String>,
    pub opinion_id: Option<String>,
    pub conversation_id: Option<String>,
    pub memory_id: Option<String>,
    pub historical: bool,
    pub matched_terms: Vec<String>,
    /// `fts5`, `like_fallback`, or `mixed` for this item. Not a model score.
    pub term_match: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySearchPage {
    pub workspace_id: WorkspaceId,
    pub items: Vec<MemorySearchItem>,
    pub next_cursor: Option<String>,
    /// `fts5`, `like_fallback`, `mixed`, or `empty`.
    pub match_mode: String,
    pub like_fallback_terms: Vec<String>,
    pub fts_terms: Vec<String>,
    pub used_or_fallback: bool,
    pub note: String,
}

#[derive(Debug, Clone)]
pub(crate) struct SearchDoc {
    pub id: String,
    pub workspace_id: String,
    pub kind: String,
    pub title: String,
    pub snippet: String,
    pub body: String,
    pub recorded_at: String,
    pub status_label: String,
    pub historical: bool,
    pub source_ref_id: Option<String>,
    pub opinion_id: Option<String>,
    pub conversation_id: Option<String>,
    pub target_id: Option<String>,
    pub trust: i64,
}

#[allow(dead_code)]
struct DocRow {
    id: String,
    workspace_id: String,
    kind: String,
    title: String,
    snippet: String,
    recorded_at: String,
    status_label: String,
    historical: bool,
    source_ref_id: Option<String>,
    opinion_id: Option<String>,
    conversation_id: Option<String>,
    target_id: Option<String>,
    trust: i64,
}

struct Acc {
    terms: Vec<String>,
    via_like: bool,
    via_fts: bool,
}

impl Core {
    pub fn search_workspace_memory(&self, input: &MemorySearchInput) -> Result<MemorySearchPage> {
        let terms = split_terms(&input.query);
        let offset = parse_cursor(input.cursor.as_deref())?;
        let kinds = normalize_kinds(input.kinds.as_deref())?;
        self.with_conn(|conn| {
            if crate::workspace::load_workspace(conn, &input.workspace_id)?.is_none() {
                return Err(CoreError::new(
                    ErrorCode::WorkspaceNotFound,
                    input.workspace_id.as_str(),
                ));
            }
            if terms.is_empty() {
                return Ok(empty_page(&input.workspace_id, "空查询不返回编造结果。"));
            }
            search_conn(conn, &input.workspace_id, &terms, kinds.as_deref(), offset)
        })
    }
}

pub(crate) fn project_event(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    conversation_id: &str,
    kind: &str,
    body: &str,
    recorded_at: &str,
) -> Result<()> {
    let trust = if kind == "user_message" { 3 } else { 2 };
    insert_doc(
        tx,
        &SearchDoc {
            id: format!("evt:{id}"),
            workspace_id: workspace_id.to_string(),
            kind: "conversation_milestone".to_string(),
            title: "对话原文".to_string(),
            snippet: snippet_of(body),
            body: fold_ascii(&format!("对话原文\n{body}")),
            recorded_at: recorded_at.to_string(),
            status_label: "对话原文".to_string(),
            historical: false,
            source_ref_id: None,
            opinion_id: None,
            conversation_id: Some(conversation_id.to_string()),
            target_id: None,
            trust,
        },
        true,
    )
}

pub(crate) fn project_source(
    tx: &Transaction<'_>,
    id: &str,
    workspace_id: &str,
    relative_path: &str,
    excerpt: &str,
    recorded_at: &str,
) -> Result<()> {
    if excerpt.trim().is_empty() {
        return Ok(());
    }
    insert_doc(
        tx,
        &SearchDoc {
            id: format!("src:{id}"),
            workspace_id: workspace_id.to_string(),
            kind: "local_fact".to_string(),
            title: format!("文件摘录 {relative_path}"),
            snippet: snippet_of(excerpt),
            body: fold_ascii(&format!("{relative_path}\n{excerpt}")),
            recorded_at: recorded_at.to_string(),
            status_label: "已保存的文件摘录，不是新读取".to_string(),
            historical: false,
            source_ref_id: Some(id.to_string()),
            opinion_id: None,
            conversation_id: None,
            target_id: None,
            trust: 2,
        },
        true,
    )
}

pub(crate) fn upsert_projection(tx: &Transaction<'_>, doc: &SearchDoc) -> Result<()> {
    insert_doc(tx, doc, true)
}

pub(crate) fn mark_historical(tx: &Transaction<'_>, doc_id: &str, label: &str) -> Result<()> {
    let changed = tx.execute(
        "UPDATE memory_search_docs SET historical = 1, status_label = ?1 WHERE id = ?2",
        params![label, doc_id],
    )?;
    if changed != 1 {
        return Err(CoreError::new(
            ErrorCode::Sqlite,
            format!("search projection {doc_id} missing"),
        ));
    }
    Ok(())
}

pub(crate) fn backfill_existing(tx: &Transaction<'_>) -> Result<()> {
    let mut events = tx.prepare(
        "SELECT id, workspace_id, conversation_id, kind, body, created_at
         FROM conversation_events ORDER BY workspace_id, seq, id",
    )?;
    let rows = events.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, String>(5)?,
        ))
    })?;
    let mut pending = Vec::new();
    for row in rows {
        pending.push(row?);
    }
    drop(events);
    for (id, workspace_id, conversation_id, kind, body, created_at) in pending {
        let trust = if kind == "user_message" { 3 } else { 2 };
        insert_doc(
            tx,
            &SearchDoc {
                id: format!("evt:{id}"),
                workspace_id,
                kind: "conversation_milestone".to_string(),
                title: "对话原文".to_string(),
                snippet: snippet_of(&body),
                body: fold_ascii(&format!("对话原文\n{body}")),
                recorded_at: created_at,
                status_label: "对话原文".to_string(),
                historical: false,
                source_ref_id: None,
                opinion_id: None,
                conversation_id: Some(conversation_id),
                target_id: None,
                trust,
            },
            false,
        )?;
    }

    let mut sources = tx.prepare(
        "SELECT id, workspace_id, relative_path, excerpt, observed_at
         FROM source_refs ORDER BY workspace_id, id",
    )?;
    let rows = sources.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
        ))
    })?;
    let mut pending = Vec::new();
    for row in rows {
        pending.push(row?);
    }
    drop(sources);
    for (id, workspace_id, path, excerpt, observed_at) in pending {
        let Some(excerpt) = excerpt.filter(|text| !text.trim().is_empty()) else {
            continue;
        };
        insert_doc(
            tx,
            &SearchDoc {
                id: format!("src:{id}"),
                workspace_id,
                kind: "local_fact".to_string(),
                title: format!("文件摘录 {path}"),
                snippet: snippet_of(&excerpt),
                body: fold_ascii(&format!("{path}\n{excerpt}")),
                recorded_at: observed_at,
                status_label: "已保存的文件摘录，不是新读取".to_string(),
                historical: false,
                source_ref_id: Some(id),
                opinion_id: None,
                conversation_id: None,
                target_id: None,
                trust: 2,
            },
            false,
        )?;
    }
    tx.execute(
        "INSERT INTO memory_search_fts(memory_search_fts) VALUES('rebuild')",
        [],
    )?;
    Ok(())
}

fn insert_doc(tx: &Transaction<'_>, doc: &SearchDoc, index_fts: bool) -> Result<()> {
    tx.execute(
        "INSERT INTO memory_search_docs (
            id, workspace_id, kind, title, snippet, body, recorded_at, status_label,
            historical, source_ref_id, opinion_id, conversation_id, target_id, trust
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            doc.id,
            doc.workspace_id,
            doc.kind,
            doc.title,
            doc.snippet,
            doc.body,
            doc.recorded_at,
            doc.status_label,
            if doc.historical { 1 } else { 0 },
            doc.source_ref_id,
            doc.opinion_id,
            doc.conversation_id,
            doc.target_id,
            doc.trust,
        ],
    )?;
    if index_fts {
        let rowid: i64 = tx.query_row(
            "SELECT rowid FROM memory_search_docs WHERE id = ?1",
            params![doc.id],
            |row| row.get(0),
        )?;
        tx.execute(
            "INSERT INTO memory_search_fts(rowid, body) VALUES (?1, ?2)",
            params![rowid, doc.body],
        )?;
    }
    Ok(())
}

fn search_conn(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    terms: &[String],
    kinds: Option<&[String]>,
    offset: usize,
) -> Result<MemorySearchPage> {
    let mut like_terms = Vec::new();
    let mut fts_terms = Vec::new();
    let mut fts_failed = false;
    let mut capped = false;
    let mut hits: std::collections::BTreeMap<String, Acc> = std::collections::BTreeMap::new();
    for term in terms {
        let short_like = term_needs_like(term);
        let (ids, hit_cap, this_like) = if short_like {
            like_terms.push(term.clone());
            let found = like_ids(conn, workspace_id, term)?;
            (found.0, found.1, true)
        } else {
            match fts_ids(conn, workspace_id, term) {
                Ok(found) => {
                    fts_terms.push(term.clone());
                    (found.0, found.1, false)
                }
                Err(_) => {
                    fts_failed = true;
                    like_terms.push(term.clone());
                    let found = like_ids(conn, workspace_id, term)?;
                    (found.0, found.1, true)
                }
            }
        };
        if hit_cap {
            capped = true;
        }
        for id in ids {
            let entry = hits.entry(id).or_insert(Acc {
                terms: Vec::new(),
                via_like: false,
                via_fts: false,
            });
            entry.terms.push(term.clone());
            if this_like {
                entry.via_like = true;
            } else {
                entry.via_fts = true;
            }
        }
    }

    let and: Vec<String> = hits
        .iter()
        .filter(|(_, acc)| acc.terms.len() == terms.len())
        .map(|(id, _)| id.clone())
        .collect();
    let used_or = and.is_empty() && terms.len() > 1;
    let chosen: Vec<String> = if and.is_empty() {
        if used_or {
            hits.keys().cloned().collect()
        } else {
            Vec::new()
        }
    } else {
        and
    };

    let mut rows = Vec::new();
    for id in chosen {
        let Some(row) = load_doc(conn, workspace_id, &id)? else {
            continue;
        };
        if let Some(kinds) = kinds {
            if !kinds.iter().any(|kind| kind == &row.kind) {
                continue;
            }
        }
        rows.push(row);
    }
    rows.sort_by(|left, right| {
        let left_hits = hits.get(&left.id).map(|acc| acc.terms.len()).unwrap_or(0);
        let right_hits = hits.get(&right.id).map(|acc| acc.terms.len()).unwrap_or(0);
        right_hits
            .cmp(&left_hits)
            .then_with(|| left.historical.cmp(&right.historical))
            .then_with(|| kind_rank(&left.kind).cmp(&kind_rank(&right.kind)))
            .then_with(|| right.trust.cmp(&left.trust))
            .then_with(|| right.recorded_at.cmp(&left.recorded_at))
            .then_with(|| left.id.cmp(&right.id))
    });

    let root_active = workspace_root_active(conn, workspace_id)?;
    let end = offset.saturating_add(MAX_SEARCH_PAGE).min(rows.len());
    let start = offset.min(rows.len());
    let mut items = Vec::new();
    for row in rows.iter().skip(start).take(end.saturating_sub(start)) {
        let acc = hits.get(&row.id);
        let mut status_label = row.status_label.clone();
        let mut snippet = row.snippet.clone();
        if row.kind == "local_fact" && !root_active {
            status_label = "目录不可用，不能当当前事实".to_string();
            snippet.clear();
        }
        let (via_like, via_fts, matched) = match acc {
            Some(acc) => (acc.via_like, acc.via_fts, acc.terms.clone()),
            None => (false, false, Vec::new()),
        };
        items.push(MemorySearchItem {
            id: row.id.clone(),
            workspace_id: workspace_id.clone(),
            kind: row.kind.clone(),
            title: row.title.clone(),
            snippet,
            recorded_at: row.recorded_at.clone(),
            status_label,
            source_ref_id: row.source_ref_id.clone(),
            opinion_id: row.opinion_id.clone(),
            conversation_id: row.conversation_id.clone(),
            memory_id: row.target_id.clone(),
            historical: row.historical,
            matched_terms: matched,
            term_match: term_match_label(via_like, via_fts),
        });
    }
    let next_cursor = if end < rows.len() {
        Some(format!("p:{end}"))
    } else {
        None
    };
    let match_mode = if items.is_empty() && rows.is_empty() {
        "empty"
    } else if !like_terms.is_empty() && !fts_terms.is_empty() {
        "mixed"
    } else if !like_terms.is_empty() {
        "like_fallback"
    } else {
        "fts5"
    };
    let mut note = SEARCH_NOTE.to_string();
    if used_or {
        note.push_str(" AND 无共同命中，当前页是 OR 召回，不是事实充分。");
    }
    if fts_failed {
        note.push_str(" FTS 查询失败后改用有界 LIKE，不是 FTS 排序。");
    }
    if capped {
        note.push_str(" 候选已达扫描预算，不是完整语料证明。");
    }
    Ok(MemorySearchPage {
        workspace_id: workspace_id.clone(),
        items,
        next_cursor,
        match_mode: match_mode.to_string(),
        like_fallback_terms: like_terms,
        fts_terms,
        used_or_fallback: used_or,
        note,
    })
}

fn like_ids(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    term: &str,
) -> Result<(Vec<String>, bool)> {
    let pattern = like_pattern(&fold_ascii(term));
    let mut stmt = conn.prepare(
        "SELECT id FROM memory_search_docs
         WHERE workspace_id = ?1 AND body LIKE ?2 ESCAPE '\\'
         ORDER BY historical ASC, trust DESC, recorded_at DESC, id
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![workspace_id.as_str(), pattern, MAX_SEARCH_CANDIDATES as i64],
        |row| row.get::<_, String>(0),
    )?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    let capped = ids.len() == MAX_SEARCH_CANDIDATES;
    Ok((ids, capped))
}

fn fts_ids(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    term: &str,
) -> Result<(Vec<String>, bool)> {
    let query = fts_query(&fold_ascii(term));
    let mut stmt = conn.prepare(
        "SELECT d.id
         FROM memory_search_fts
         JOIN memory_search_docs d ON d.rowid = memory_search_fts.rowid
         WHERE memory_search_fts MATCH ?1 AND d.workspace_id = ?2
         LIMIT ?3",
    )?;
    let rows = stmt.query_map(
        params![query, workspace_id.as_str(), MAX_SEARCH_CANDIDATES as i64],
        |row| row.get::<_, String>(0),
    )?;
    let mut ids = Vec::new();
    for row in rows {
        ids.push(row?);
    }
    let capped = ids.len() == MAX_SEARCH_CANDIDATES;
    Ok((ids, capped))
}

fn load_doc(
    conn: &rusqlite::Connection,
    workspace_id: &WorkspaceId,
    id: &str,
) -> Result<Option<DocRow>> {
    conn.query_row(
        "SELECT id, workspace_id, kind, title, snippet, recorded_at, status_label, historical,
                source_ref_id, opinion_id, conversation_id, target_id, trust
         FROM memory_search_docs WHERE id = ?1 AND workspace_id = ?2",
        params![id, workspace_id.as_str()],
        |row| {
            Ok(DocRow {
                id: row.get(0)?,
                workspace_id: row.get(1)?,
                kind: row.get(2)?,
                title: row.get(3)?,
                snippet: row.get(4)?,
                recorded_at: row.get(5)?,
                status_label: row.get(6)?,
                historical: row.get::<_, i64>(7)? == 1,
                source_ref_id: row.get(8)?,
                opinion_id: row.get(9)?,
                conversation_id: row.get(10)?,
                target_id: row.get(11)?,
                trust: row.get(12)?,
            })
        },
    )
    .optional()
    .map_err(CoreError::from)
}

fn workspace_root_active(conn: &rusqlite::Connection, workspace_id: &WorkspaceId) -> Result<bool> {
    match messages::root_for_workspace(conn, workspace_id) {
        Ok(root) => Ok(root.status == RootStatus::Active && grant::require_active(&root).is_ok()),
        Err(_) => Ok(false),
    }
}

fn empty_page(workspace_id: &WorkspaceId, note: &str) -> MemorySearchPage {
    MemorySearchPage {
        workspace_id: workspace_id.clone(),
        items: Vec::new(),
        next_cursor: None,
        match_mode: "empty".to_string(),
        like_fallback_terms: Vec::new(),
        fts_terms: Vec::new(),
        used_or_fallback: false,
        note: format!("{note} {SEARCH_NOTE}"),
    }
}

pub(crate) fn split_terms(query: &str) -> Vec<String> {
    let chars: Vec<char> = query.chars().collect();
    let mut terms = Vec::new();
    let mut current = String::new();
    for (index, ch) in chars.iter().copied().enumerate() {
        if ch.is_whitespace() || is_hard_split(ch) {
            push_term(&mut terms, &mut current);
            continue;
        }
        if matches!(ch, '.' | '+' | '#' | '/' | '-' | '_')
            && keep_connector(ch, &current, chars.get(index + 1).copied())
        {
            current.push(ch);
            continue;
        }
        if ch.is_alphanumeric() || is_cjk(ch) {
            current.push(ch);
            continue;
        }
        push_term(&mut terms, &mut current);
    }
    push_term(&mut terms, &mut current);
    terms
}

fn keep_connector(ch: char, current: &str, next: Option<char>) -> bool {
    let Some(prev) = current.chars().last() else {
        return false;
    };
    match ch {
        '+' => prev.is_ascii_alphanumeric() || prev == '+',
        '.' | '_' | '#' | '/' | '-' => {
            (prev.is_ascii_alphanumeric() || is_cjk(prev))
                && next.is_some_and(|n| n.is_ascii_alphanumeric() || is_cjk(n))
        }
        _ => false,
    }
}

fn is_hard_split(ch: char) -> bool {
    matches!(
        ch,
        '，' | '。'
            | '！'
            | '？'
            | '、'
            | '；'
            | '：'
            | ','
            | '!'
            | '?'
            | ';'
            | ':'
            | '（'
            | '）'
            | '('
            | ')'
            | '【'
            | '】'
            | '['
            | ']'
            | '"'
            | '\''
            | '“'
            | '”'
    )
}

fn push_term(terms: &mut Vec<String>, current: &mut String) {
    let token = std::mem::take(current);
    if !token.chars().any(|ch| ch.is_alphanumeric() || is_cjk(ch)) {
        return;
    }
    let folded = fold_ascii(token.trim());
    if folded.is_empty() || terms.iter().any(|existing| existing == &folded) {
        return;
    }
    if terms.len() < MAX_SEARCH_TERMS {
        terms.push(folded);
    }
}

fn term_needs_like(term: &str) -> bool {
    term.chars().count() < 3
}

fn like_pattern(term: &str) -> String {
    let mut out = String::from("%");
    for ch in term.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out.push('%');
    out
}

fn fts_query(term: &str) -> String {
    format!("\"{}\"", term.replace('"', "\"\""))
}

fn parse_cursor(cursor: Option<&str>) -> Result<usize> {
    let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(0);
    };
    let Some(raw) = cursor.strip_prefix("p:") else {
        return Err(CoreError::new(ErrorCode::InvalidMessage, "search cursor"));
    };
    let offset: usize = raw
        .parse()
        .map_err(|_| CoreError::new(ErrorCode::InvalidMessage, "search cursor"))?;
    if offset > MAX_SEARCH_OFFSET {
        return Err(CoreError::new(
            ErrorCode::InvalidMessage,
            "search cursor past budget",
        ));
    }
    Ok(offset)
}

fn normalize_kinds(kinds: Option<&[String]>) -> Result<Option<Vec<String>>> {
    let Some(kinds) = kinds else {
        return Ok(None);
    };
    if kinds.is_empty() {
        return Ok(Some(Vec::new()));
    }
    let mut out = Vec::new();
    for kind in kinds {
        let mapped = match kind.trim() {
            "decision" => "decision",
            "opinion" => "opinion",
            "conversation" | "conversation_milestone" => "conversation_milestone",
            "local_fact" => "local_fact",
            "identity" => "identity",
            "experience" => "experience",
            _ => {
                return Err(CoreError::new(
                    ErrorCode::InvalidMessage,
                    "unknown memory search kind",
                ))
            }
        };
        if !out.iter().any(|existing| existing == mapped) {
            out.push(mapped.to_string());
        }
    }
    Ok(Some(out))
}

fn kind_rank(kind: &str) -> i64 {
    match kind {
        "decision" => 0,
        "identity" => 1,
        "experience" => 2,
        "opinion" => 3,
        "conversation_milestone" => 4,
        "local_fact" => 5,
        _ => 6,
    }
}

fn term_match_label(via_like: bool, via_fts: bool) -> String {
    match (via_like, via_fts) {
        (true, true) => "mixed",
        (true, false) => "like_fallback",
        (false, true) => "fts5",
        (false, false) => "empty",
    }
    .to_string()
}

pub(crate) fn snippet_of(text: &str) -> String {
    text.chars().take(180).collect()
}

pub(crate) fn memory_doc_id(revision_id: &str) -> String {
    format!("mem:{revision_id}")
}

pub(crate) fn opinion_doc_id(revision_id: &str) -> String {
    format!("opn:{revision_id}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_cjk_and_keeps_technical_tokens() {
        assert_eq!(split_terms("目录 权限 撤销"), vec!["目录", "权限", "撤销"]);
        assert_eq!(
            split_terms("Windows 打包 进程"),
            vec!["windows", "打包", "进程"]
        );
        assert_eq!(split_terms("C++ Next.js"), vec!["c++", "next.js"]);
        assert_eq!(split_terms("foo/bar"), vec!["foo/bar"]);
        assert!(split_terms("  ，。 ").is_empty());
    }

    #[test]
    fn like_pattern_escapes_wildcards() {
        assert_eq!(like_pattern("100%_ok"), "%100\\%\\_ok%");
        assert!(term_needs_like("权限"));
        assert!(!term_needs_like("windows"));
    }
}
