use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use clap::Parser;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row, SqlitePool,
};
use similar::TextDiff;

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
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    let pool = open_pool(&args.db, args.readonly_only).await?;
    sqlx::query("PRAGMA foreign_keys=ON;")
        .execute(&pool)
        .await?;

    let db_schema = load_db_schema(&pool, args.strict, args.include_migrations).await?;
    if let Some(dump) = &args.dump {
        std::fs::write(dump, &db_schema)?;
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
        std::fs::write(&args.schema, &db_schema)?;
        println!("schema.sql updated");
        return Ok(());
    }

    Err(anyhow!("schema mismatch"))
}

async fn open_pool(path: &Path, ro_only: bool) -> Result<SqlitePool> {
    if !path.exists() {
        return Err(anyhow!(
            "database not found at {} (run migrations first)",
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
