use anyhow::Result;
use arklowdun_lib::db::with_tx;

#[path = "util.rs"]
mod util;

#[tokio::test]
async fn commit_happy_path() -> Result<()> {
    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;
    with_tx(&pool, |tx| async move {
        sqlx::query("INSERT INTO t (val) VALUES ('ok');")
            .execute(tx)
            .await?;
        Ok(())
    })
    .await?;
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 1);
    Ok(())
}

#[tokio::test]
async fn rollback_on_unique_violation() -> Result<()> {
    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;
    let res = with_tx(&pool, |tx| async move {
        sqlx::query("INSERT INTO t (val) VALUES ('dup');")
            .execute(tx)
            .await?;
        sqlx::query("INSERT INTO t (val) VALUES ('dup');")
            .execute(tx)
            .await?;
        Ok(())
    })
    .await;
    assert!(res.is_err());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}

#[tokio::test]
async fn rollback_on_panic() -> Result<()> {
    use std::panic::{catch_unwind, AssertUnwindSafe};

    let pool = util::temp_pool().await;
    sqlx::query("CREATE TABLE t (val TEXT UNIQUE);")
        .execute(&pool)
        .await?;

    let pool_clone = pool.clone();
    let res = catch_unwind(AssertUnwindSafe(|| {
        tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                let _ = with_tx(&pool_clone, |tx| async move {
                    sqlx::query("INSERT INTO t (val) VALUES ('p');")
                        .execute(tx)
                        .await
                        .unwrap();
                    panic!("boom");
                    #[allow(unreachable_code)]
                    Ok::<(), anyhow::Error>(())
                })
                .await;
            });
        });
    }));
    assert!(res.is_err());
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM t;")
        .fetch_one(&pool)
        .await?;
    assert_eq!(count, 0);
    Ok(())
}
