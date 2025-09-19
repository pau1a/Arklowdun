use std::any::Any;
use std::panic::{catch_unwind, AssertUnwindSafe};

use futures::Future;
use futures::FutureExt;

use crate::{
    error::{panic_payload, take_panic_crash_id, CrashId},
    AppError, AppResult,
};

fn app_error_from_panic(payload: Box<dyn Any + Send>) -> AppError {
    let message = panic_payload(payload.as_ref());
    let crash_id = take_panic_crash_id().unwrap_or_else(CrashId::new);

    let mut error = AppError::new("RUNTIME/PANIC", message);
    error.set_crash_id(crash_id);
    error.log_with_event("panic_caught");
    error
}

#[allow(clippy::result_large_err)]
pub fn dispatch_with_fence<T, F>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> T,
{
    match catch_unwind(AssertUnwindSafe(f)) {
        Ok(result) => Ok(result),
        Err(payload) => Err(app_error_from_panic(payload)),
    }
}

#[allow(clippy::result_large_err)]
pub async fn dispatch_async_with_fence<F, Fut, T>(f: F) -> Result<T, AppError>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = T>,
{
    let fut = dispatch_with_fence(|| AssertUnwindSafe(f()).catch_unwind())?;
    match fut.await {
        Ok(value) => Ok(value),
        Err(payload) => Err(app_error_from_panic(payload)),
    }
}

#[allow(clippy::result_large_err)]
pub fn dispatch_app_result<T, F>(f: F) -> AppResult<T>
where
    F: FnOnce() -> AppResult<T>,
{
    dispatch_with_fence(f)?
}

#[allow(clippy::result_large_err)]
pub async fn dispatch_async_app_result<F, Fut, T>(f: F) -> AppResult<T>
where
    F: FnOnce() -> Fut,
    Fut: Future<Output = AppResult<T>>,
{
    dispatch_async_with_fence(f).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::panic::panic_any;

    #[test]
    fn dispatch_with_fence_passes_through() {
        let value = dispatch_with_fence(|| 42).unwrap();
        assert_eq!(value, 42);
    }

    #[test]
    fn dispatch_with_fence_catches_str_panic() {
        let err = dispatch_with_fence(|| panic!("boom"))
            .err()
            .expect("should convert panic into error");
        assert_eq!(err.code(), "RUNTIME/PANIC");
        assert_eq!(err.message(), "boom");
        assert!(err.crash_id().is_some());
        assert!(err.context().is_empty());
    }

    #[test]
    fn dispatch_with_fence_catches_string_panic() {
        let err = dispatch_with_fence(|| panic_any(String::from("kaboom")))
            .err()
            .expect("should convert panic into error");
        assert_eq!(err.code(), "RUNTIME/PANIC");
        assert_eq!(err.message(), "kaboom");
        assert!(err.crash_id().is_some());
        assert!(err.context().is_empty());
    }

    #[test]
    fn dispatch_with_fence_catches_non_string_panic() {
        let err = dispatch_with_fence(|| panic_any(123_i32))
            .err()
            .expect("should convert panic into error");
        assert_eq!(err.code(), "RUNTIME/PANIC");
        assert_eq!(err.message(), "unknown panic payload");
        assert!(err.crash_id().is_some());
        assert!(err.context().is_empty());
    }
}
