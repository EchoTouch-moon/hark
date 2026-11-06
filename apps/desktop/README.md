# Hark R1 native shell

This directory is the F3 native lane. It calls the already-built `hark-core` crate in process. It does not start a Pi sidecar and it is not the product UI.

```sh
cd apps/desktop
cargo test -p hark-native-shell
cargo build -p hark-desktop
```

`cargo run -p hark-desktop` opens a real window and writes SQLite under Tauri `app_data_dir` for identifier `dev.hark.r1.native-shell`. Do not use the picker on a private directory. Automated tests use synthetic temp directories and `NativeShell::stage_native_pick`; they do not open the picker.

Installer, signing, window clicks, and Windows are not verified by `cargo build`. See `docs/r1/FRONTEND-HANDOFF.md`.
