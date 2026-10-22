//! The plumbing every exported function shares: statuses, the last error and the last result on the calling thread,
//! text in, handles out.
//!
//! The statuses, the buffer rules and the handle rules are those of the Gil decider's C ABI, so that a .NET host that
//! binds both reads them the same way. Until Gil's shared plumbing crate is on crates.io, this library keeps its own.

use std::cell::{Cell, RefCell};
use std::panic::{AssertUnwindSafe, catch_unwind};

/// The call succeeded.
pub const OK: i32 = 0;
/// The engine refused its input; the message says what was wrong.
pub const INVALID_INPUT: i32 = 1;
/// The call itself was malformed: a null pointer, text that is not UTF-8.
pub const INVALID_ARGUMENT: i32 = 2;
/// The engine panicked — a defect, or a call its contract rules out — reported instead of unwinding into the caller.
pub const PANIC: i32 = 3;
/// A buffer the caller gave is too small. Kept for the numbering shared with Gil; no function here returns it, since
/// text comes out through [`copy_last_result`], which says the length it needs.
pub const BUFFER_TOO_SMALL: i32 = 4;
/// A handle is unusable: an earlier call that changed it panicked partway. Free it and build it again.
pub const BROKEN: i32 = 5;

/// UTF-8 text the caller owns, for the length of one call: a pointer and a length in bytes, no terminator.
#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct LowlineStr {
    pub ptr: *const u8,
    pub len: usize,
}

thread_local! {
    static LAST_ERROR: RefCell<String> = const { RefCell::new(String::new()) };
    static LAST_RESULT: RefCell<String> = const { RefCell::new(String::new()) };
    static IN_CALL: Cell<bool> = const { Cell::new(false) };
}

/// A refused call: its status and the message the last error gives.
#[derive(Debug)]
pub struct Failure(pub i32, pub String);

pub fn argument(message: impl Into<String>) -> Failure {
    Failure(INVALID_ARGUMENT, message.into())
}

pub fn input(message: impl Into<String>) -> Failure {
    Failure(INVALID_INPUT, message.into())
}

/// Runs one exported call: clears the last error and result, keeps a panic from crossing the boundary, and gives the
/// status. A panic inside a call reaches the host as the last error, so the panic hook says nothing of it on the
/// host's stderr; a panic anywhere else in the process — a Rust host's own — still goes to the hook that was there.
pub fn call(body: impl FnOnce() -> Result<(), Failure>) -> i32 {
    static QUIET: std::sync::Once = std::sync::Once::new();
    QUIET.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !IN_CALL.with(Cell::get) {
                previous(info);
            }
        }));
    });
    LAST_ERROR.with(|e| e.borrow_mut().clear());
    LAST_RESULT.with(|r| r.borrow_mut().clear());
    let outer = IN_CALL.with(|c| c.replace(true));
    let caught = catch_unwind(AssertUnwindSafe(body));
    IN_CALL.with(|c| c.set(outer));
    let outcome = caught.unwrap_or_else(|panic| {
        let message = panic
            .downcast_ref::<&str>()
            .map(|s| (*s).to_owned())
            .or_else(|| panic.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "the engine panicked".to_owned());
        Err(Failure(PANIC, message))
    });
    match outcome {
        Ok(()) => OK,
        Err(Failure(status, message)) => {
            LAST_RESULT.with(|r| r.borrow_mut().clear());
            LAST_ERROR.with(|e| *e.borrow_mut() = message);
            status
        }
    }
}

/// Keeps `text` as this call's result and writes its length in bytes to `result_len`.
///
/// # Safety
/// `result_len` is null or points to one writable `usize`.
pub unsafe fn set_result(text: String, result_len: *mut usize) -> Result<(), Failure> {
    if result_len.is_null() {
        return Err(argument("result_len is null"));
    }
    // SAFETY: non-null, and the caller guarantees one writable usize.
    unsafe { result_len.write(text.len()) };
    LAST_RESULT.with(|r| *r.borrow_mut() = text);
    Ok(())
}

/// # Safety
/// `buffer` is null with `capacity` 0, or points to `capacity` writable bytes.
unsafe fn copy_out(text: &str, buffer: *mut u8, capacity: usize) -> usize {
    let bytes = text.as_bytes();
    if !buffer.is_null() && capacity >= bytes.len() {
        // SAFETY: the caller guarantees `capacity` writable bytes, and the text fits.
        unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer, bytes.len()) };
    }
    bytes.len()
}

/// # Safety
/// As [`copy_out`].
pub unsafe fn copy_last_error(buffer: *mut u8, capacity: usize) -> usize {
    // SAFETY: forwarded from the caller.
    LAST_ERROR.with(|e| unsafe { copy_out(&e.borrow(), buffer, capacity) })
}

/// # Safety
/// As [`copy_out`].
pub unsafe fn copy_last_result(buffer: *mut u8, capacity: usize) -> usize {
    // SAFETY: forwarded from the caller.
    LAST_RESULT.with(|r| unsafe { copy_out(&r.borrow(), buffer, capacity) })
}

/// The text behind `s`.
///
/// # Safety
/// `s.ptr` is null with `s.len` 0, or points to `s.len` readable bytes valid for `'a`.
pub unsafe fn text<'a>(s: LowlineStr, what: &str) -> Result<&'a str, Failure> {
    if s.len == 0 {
        return Ok("");
    }
    if s.ptr.is_null() {
        return Err(argument(format!(
            "{what} is null but its length is {}",
            s.len
        )));
    }
    // SAFETY: non-null, and the caller guarantees `len` readable bytes for 'a.
    let bytes = unsafe { std::slice::from_raw_parts(s.ptr, s.len) };
    std::str::from_utf8(bytes).map_err(|_| argument(format!("{what} is not UTF-8")))
}

/// Hands `value` out as a new handle through `out`.
///
/// # Safety
/// `out` is null or points to one writable pointer.
pub unsafe fn hand_out<T>(out: *mut *mut T, value: T) -> Result<(), Failure> {
    if out.is_null() {
        return Err(argument("out is null"));
    }
    // SAFETY: non-null, and the caller guarantees one writable pointer.
    unsafe { out.write(Box::into_raw(Box::new(value))) };
    Ok(())
}

/// Releases a handle [`hand_out`] gave; null does nothing.
///
/// # Safety
/// `handle` is null or a live handle of this type, released once and not used after.
pub unsafe fn release<T>(handle: *mut T) {
    if !handle.is_null() {
        // SAFETY: the caller guarantees a live handle from `Box::into_raw`, released once.
        drop(unsafe { Box::from_raw(handle) });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn last_error() -> String {
        let len = unsafe { copy_last_error(std::ptr::null_mut(), 0) };
        let mut buffer = vec![0u8; len];
        unsafe { copy_last_error(buffer.as_mut_ptr(), buffer.len()) };
        String::from_utf8(buffer).unwrap()
    }

    #[test]
    fn a_panic_in_a_call_becomes_its_status_and_message() {
        assert_eq!(
            call(|| panic!("asked about a field that is not decided")),
            PANIC
        );
        assert_eq!(last_error(), "asked about a field that is not decided");
        let line = 7;
        assert_eq!(call(|| panic!("line {line}")), PANIC);
        assert_eq!(last_error(), "line 7");
        assert_eq!(call(|| Ok(())), OK);
        assert_eq!(last_error(), "");
    }

    #[test]
    fn a_panic_outside_a_call_still_reaches_the_hook() {
        call(|| Ok(()));
        assert!(!IN_CALL.with(Cell::get));
        assert!(std::panic::catch_unwind(|| panic!("the host's own")).is_err());
    }

    #[test]
    fn a_buffer_too_small_is_left_untouched() {
        call(|| Err(argument("twelve bytes")));
        let mut buffer = [0u8; 4];
        assert_eq!(
            unsafe { copy_last_error(buffer.as_mut_ptr(), buffer.len()) },
            12
        );
        assert_eq!(buffer, [0; 4]);
    }
}
