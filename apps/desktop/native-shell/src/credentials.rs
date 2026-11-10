//! The provider secret belongs in the operating system credential store.
//! Errors deliberately contain no credential values or OS-provided text.
use crate::ShellError;

pub trait CredentialStore: Send + Sync {
    fn load(&self) -> Result<Option<String>, ShellError>;
    fn save(&self, value: &str) -> Result<(), ShellError>;
    fn clear(&self) -> Result<(), ShellError>;
}

pub struct SystemCredentialStore;

fn unavailable() -> ShellError {
    ShellError::new("credential_store_unavailable", "无法访问系统凭据存储")
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{unavailable, CredentialStore, SystemCredentialStore};
    use crate::ShellError;
    use std::ffi::c_void;
    use std::ptr;

    // Dedicated item; no lookups of other applications' credentials.
    const SERVICE: &[u8] = b"dev.hark.desktop.stepfun";
    const ACCOUNT: &[u8] = b"default";
    const NOT_FOUND: i32 = -25300;
    const DUPLICATE: i32 = -25299;

    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecKeychainFindGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const c_void,
            account_len: u32,
            account: *const c_void,
            password_len: *mut u32,
            password: *mut *mut c_void,
            item: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainAddGenericPassword(
            keychain: *const c_void,
            service_len: u32,
            service: *const c_void,
            account_len: u32,
            account: *const c_void,
            password_len: u32,
            password: *const c_void,
            item: *mut *mut c_void,
        ) -> i32;
        fn SecKeychainItemModifyAttributesAndData(
            item: *mut c_void,
            attributes: *const c_void,
            length: u32,
            data: *const c_void,
        ) -> i32;
        fn SecKeychainItemDelete(item: *mut c_void) -> i32;
        fn SecKeychainItemFreeContent(attributes: *mut c_void, data: *mut c_void) -> i32;
    }
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(value: *const c_void);
    }

    struct Item(*mut c_void);
    impl Drop for Item {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn find(with_password: bool) -> Result<Option<(Item, Option<String>)>, ShellError> {
        let mut item = ptr::null_mut();
        let mut data = ptr::null_mut();
        let mut len = 0u32;
        let status = unsafe {
            SecKeychainFindGenericPassword(
                ptr::null(),
                SERVICE.len() as u32,
                SERVICE.as_ptr().cast(),
                ACCOUNT.len() as u32,
                ACCOUNT.as_ptr().cast(),
                if with_password {
                    &mut len
                } else {
                    ptr::null_mut()
                },
                if with_password {
                    &mut data
                } else {
                    ptr::null_mut()
                },
                &mut item,
            )
        };
        if status == NOT_FOUND {
            return Ok(None);
        }
        if status != 0 {
            return Err(unavailable());
        }
        let item = Item(item);
        if !with_password {
            return Ok(Some((item, None)));
        }
        if data.is_null() {
            return Err(unavailable());
        }
        let bytes = unsafe { std::slice::from_raw_parts(data.cast::<u8>(), len as usize) };
        let value = String::from_utf8(bytes.to_vec()).map_err(|_| unavailable());
        unsafe {
            SecKeychainItemFreeContent(ptr::null_mut(), data);
        }
        Ok(Some((item, Some(value?))))
    }

    impl CredentialStore for SystemCredentialStore {
        fn load(&self) -> Result<Option<String>, ShellError> {
            Ok(find(true)?.and_then(|(_, value)| value))
        }
        fn save(&self, value: &str) -> Result<(), ShellError> {
            let update = |item: Item| unsafe {
                SecKeychainItemModifyAttributesAndData(
                    item.0,
                    ptr::null(),
                    value.len() as u32,
                    value.as_ptr().cast(),
                )
            };
            if let Some((item, _)) = find(false)? {
                return if update(item) == 0 {
                    Ok(())
                } else {
                    Err(unavailable())
                };
            }
            let status = unsafe {
                SecKeychainAddGenericPassword(
                    ptr::null(),
                    SERVICE.len() as u32,
                    SERVICE.as_ptr().cast(),
                    ACCOUNT.len() as u32,
                    ACCOUNT.as_ptr().cast(),
                    value.len() as u32,
                    value.as_ptr().cast(),
                    ptr::null_mut(),
                )
            };
            if status == 0 {
                return Ok(());
            }
            if status == DUPLICATE {
                if let Some((item, _)) = find(false)? {
                    return if update(item) == 0 {
                        Ok(())
                    } else {
                        Err(unavailable())
                    };
                }
            }
            Err(unavailable())
        }
        fn clear(&self) -> Result<(), ShellError> {
            match find(false)? {
                None => Ok(()),
                Some((item, _)) => match unsafe { SecKeychainItemDelete(item.0) } {
                    0 | NOT_FOUND => Ok(()),
                    _ => Err(unavailable()),
                },
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
impl CredentialStore for SystemCredentialStore {
    fn load(&self) -> Result<Option<String>, ShellError> {
        Err(unavailable())
    }
    fn save(&self, _: &str) -> Result<(), ShellError> {
        Err(unavailable())
    }
    fn clear(&self) -> Result<(), ShellError> {
        Err(unavailable())
    }
}
