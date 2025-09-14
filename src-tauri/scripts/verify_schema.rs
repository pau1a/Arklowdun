use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use arklowdun_lib::db::write_atomic;
use clap::Parser;
use serde::Serialize;
use similar::TextDiff;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use std::collections::HashSet;

#[derive(Parser)]
struct Args {
    #[arg(long)]
    db: PathBuf,
    #[arg(long, default_value = "schema.sql")]
    schema: PathBuf,
    #[arg(long)]
    strict: bool,
    #[arg(long)]
    include_migrations: bool,
    #[arg(long)]
    update: bool,
    #[arg(long)]
    dump: Option<PathBuf>,
    #[arg(long)]
    verbose: bool,
    #[arg(long = "readonly-only")]
    readonly_only: bool,
    #[arg(long = "strict-fk")]
    strict_fk: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let pool = open_pool(&args.db, args.readonly_only).await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    run_integrity_checks(&pool).await?;
    audit_foreign_keys(args.strict_fk).await?;

    let db_schema = load_db_schema(&pool, args.strict, args.include_migrations).await?;
    if let Some(dump) = &args.dump {
        write_atomic(dump, db_schema.as_bytes())?;
    }

    let file_raw = std::fs::read_to_string(&args.schema).ok();
    let file_schema = file_raw
        .as_deref()
        .map(|s| normalize_all(split_statements(s)))
        .unwrap_or_default();

    if db_schema == file_schema {
        println!("schema OK");
        return Ok(());
    }

    if file_schema.is_empty() {
        eprintln!(
            "No canonical schema found at {}; run `npm run schema:update` after migrations.",
            args.schema.display()
        );
    }

    if args.verbose {
        print!("{}", unified_diff(&file_schema, &db_schema));
    }

    if args.update {
        write_atomic(&args.schema, db_schema.as_bytes())?;
        println!("schema.sql updated");
        return Ok(());
    }

    Err(anyhow!("schema mismatch"))
}

async fn open_pool(path: &Path, ro_only: bool) -> Result<SqlitePool> {
    if !path.exists()
        || std::fs::metadata(path)
            .map(|m| m.len() == 0)
            .unwrap_or(true)
    {
        return Err(anyhow!(
            "database not found at {}; run `cargo run --bin migrate -- --db {} up` first",
            path.display(),
            path.display()
        ));
    }
    let abs = path.canonicalize().context("canonicalize db path")?;
    let ro_opts = SqliteConnectOptions::default()
        .filename(&abs)
        .read_only(true);
    match SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(ro_opts)
        .await
    {
        Ok(pool) => Ok(pool),
        Err(e) if !ro_only => {
            eprintln!("read-only connection failed, retrying with rw: {e}");
            let rw_opts = SqliteConnectOptions::default()
                .filename(&abs)
                .read_only(false)
                .create_if_missing(true);
            Ok(SqlitePoolOptions::new()
                .max_connections(1)
                .connect_with(rw_opts)
                .await?)
        }
        Err(e) => Err(e.into()),
    }
}

async fn run_integrity_checks(pool: &SqlitePool) -> Result<()> {
    let fk_violations = sqlx::query("PRAGMA foreign_key_check")
        .fetch_all(pool)
        .await?;
    if !fk_violations.is_empty() {
        return Err(anyhow!(
            "foreign_key_check failed with {} violations",
            fk_violations.len()
        ));
    }
    let integrity: String = sqlx::query_scalar("PRAGMA integrity_check")
        .fetch_one(pool)
        .await?;
    if integrity.to_lowercase() != "ok" {
        return Err(anyhow!("integrity_check failed: {integrity}"));
    }
    Ok(())
}

#[derive(Serialize)]
struct MissingFk {
    table: String,
    column: String,
    parent: String,
    parent_key: String,
}

async fn audit_foreign_keys(strict: bool) -> Result<()> {
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::new()
                .filename(":memory:")
                .create_if_missing(true),
        )
        .await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;
    sqlx::migrate!("../migrations").run(&pool).await?;

    let mut missing = Vec::new();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .fetch_all(&pool)
    .await?;
    let table_set: HashSet<String> = tables.iter().cloned().collect();
    for table in &tables {
        let fk_rows = sqlx::query(&format!("PRAGMA foreign_key_list('{table}')"))
            .fetch_all(&pool)
            .await?;
        let existing: HashSet<String> = fk_rows
            .iter()
            .filter_map(|r| r.try_get("from").ok())
            .collect();
        let cols = sqlx::query(&format!("PRAGMA table_info('{table}')"))
            .fetch_all(&pool)
            .await?;
        for col in cols {
            let name: String = col.get("name");
            if name == "id" || !name.ends_with("_id") || existing.contains(&name) {
                continue;
            }
            if let Some(parent) = infer_parent(&name, &table_set) {
                missing.push(MissingFk {
                    table: table.clone(),
                    column: name,
                    parent,
                    parent_key: "id".into(),
                });
            }
        }
    }
    if !missing.is_empty() {
        println!("{}", serde_json::to_string_pretty(&missing)?);
        if strict {
            return Err(anyhow!("missing foreign keys"));
        }
    } else if strict {
        println!("[]");
    }
    Ok(())
}

fn infer_parent(col: &str, tables: &HashSet<String>) -> Option<String> {
    let base = col.trim_end_matches("_id");
    if base.is_empty() {
        return None;
    }
    // explicit overrides
    if col == "category_id" && tables.contains("budget_categories") {
        return Some("budget_categories".into());
    }
    if tables.contains(base) {
        return Some(base.to_string());
    }
    let plural = if let Some(stem) = base.strip_suffix('y') {
        format!("{}ies", stem)
    } else {
        format!("{}s", base)
    };
    if tables.contains(&plural) {
        return Some(plural);
    }
    None
}

async fn load_db_schema(
    pool: &SqlitePool,
    strict: bool,
    include_migrations: bool,
) -> Result<String> {
    let rows = sqlx::query(
        "SELECT type, name, tbl_name, sql
         FROM sqlite_master
         WHERE sql IS NOT NULL
           AND (?1 OR name NOT LIKE 'sqlite_%')
           AND (?2 OR name <> 'schema_migrations')
         ORDER BY type, name",
    )
    // bind booleans as integers 0/1
    .bind(strict as i32)
    .bind(include_migrations as i32)
    .fetch_all(pool)
    .await?;

    let stmts = rows
        .into_iter()
        .map(|r| r.get::<String, _>("sql"))
        .collect();
    Ok(normalize_all(stmts))
}

fn split_statements(input: &str) -> Vec<String> {
    #[derive(PartialEq)]
    enum State {
        Normal,
        InSingle,
        InDouble,
        InLineComment,
        InBlockComment,
    }
    let mut stmts = Vec::new();
    let mut buf = String::new();
    let mut state = State::Normal;
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        match state {
            State::Normal => match c {
                '\'' => {
                    state = State::InSingle;
                    buf.push(c);
                }
                '"' => {
                    state = State::InDouble;
                    buf.push(c);
                }
                '-' if chars.peek() == Some(&'-') => {
                    chars.next();
                    state = State::InLineComment;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    state = State::InBlockComment;
                }
                ';' => {
                    if !buf.trim().is_empty() {
                        stmts.push(buf.clone());
                    }
                    buf.clear();
                }
                _ => buf.push(c),
            },
            State::InSingle => {
                buf.push(c);
                if c == '\'' {
                    if chars.peek() == Some(&'\'') {
                        buf.push(chars.next().unwrap());
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::InDouble => {
                buf.push(c);
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        buf.push(chars.next().unwrap());
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::InLineComment => {
                if c == '\n' {
                    state = State::Normal;
                    buf.push(c);
                }
            }
            State::InBlockComment => {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    state = State::Normal;
                }
            }
        }
    }
    if !buf.trim().is_empty() {
        stmts.push(buf);
    }
    stmts
}

fn normalize_all(stmts: Vec<String>) -> String {
    let mut out = String::new();
    for stmt in stmts {
        let mut n = normalize_stmt(&stmt);
        if !n.ends_with(';') {
            n.push(';');
        }
        out.push_str(&n);
        out.push('\n');
    }
    out
}

fn normalize_stmt(input: &str) -> String {
    #[derive(PartialEq)]
    enum State {
        Normal,
        InSingle,
        InDouble,
        InLineComment,
        InBlockComment,
    }
    let mut out = String::new();
    let mut state = State::Normal;
    let mut chars = input.chars().peekable();
    let mut last_space = false;
    while let Some(c) = chars.next() {
        match state {
            State::Normal => match c {
                '\'' => {
                    state = State::InSingle;
                    out.push(c);
                    last_space = false;
                }
                '"' => {
                    state = State::InDouble;
                    out.push(c);
                    last_space = false;
                }
                '-' if chars.peek() == Some(&'-') => {
                    chars.next();
                    state = State::InLineComment;
                }
                '/' if chars.peek() == Some(&'*') => {
                    chars.next();
                    state = State::InBlockComment;
                }
                c if c.is_ascii_whitespace() => {
                    if !last_space {
                        out.push(' ');
                        last_space = true;
                    }
                }
                _ => {
                    out.push(c);
                    last_space = false;
                }
            },
            State::InSingle => {
                out.push(c);
                if c == '\'' {
                    if chars.peek() == Some(&'\'') {
                        out.push(chars.next().unwrap());
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::InDouble => {
                out.push(c);
                if c == '"' {
                    if chars.peek() == Some(&'"') {
                        out.push(chars.next().unwrap());
                    } else {
                        state = State::Normal;
                    }
                }
            }
            State::InLineComment => {
                if c == '\n' {
                    state = State::Normal;
                    if !last_space {
                        out.push(' ');
                        last_space = true;
                    }
                }
            }
            State::InBlockComment => {
                if c == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    state = State::Normal;
                }
            }
        }
    }
    out.trim().to_string()
}

fn unified_diff(old: &str, new: &str) -> String {
    let diff = TextDiff::from_lines(old, new);
    let mut buf: Vec<u8> = Vec::new();
    diff.unified_diff()
        .header("schema.sql", "schema")
        .context_radius(3)
        .to_writer(&mut buf)
        .expect("write unified diff");
    String::from_utf8(buf).expect("utf8 diff")
}
