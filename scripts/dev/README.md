# Development Scripts

Run the app once to create the dev database and apply migrations:

```
npm run tauri dev
```

Then seed a deterministic dev database:

```
VITE_ENV=development npm run dev:seed -- --households 2 --rows 1000 --seed 7 --reset
```

Run the seed script and profile common queries in one go:

```
VITE_ENV=development npm run dev:profile -- --households 2 --rows 1000 --seed 7 --reset
```

The development database lives at:

- macOS: `~/Library/Application Support/com.paula.arklowdun-dev/arklowdun.sqlite3`
- Windows: `%APPDATA%\com.paula.arklowdun-dev\arklowdun.sqlite3`
- Linux: `~/.local/share/com.paula.arklowdun-dev/arklowdun.sqlite3`

## Coverage

Frontend coverage:

```
npm run test:coverage
```

Open `coverage/index.html` for the report.

Rust backend coverage (uses `cargo llvm-cov` when available):

```
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov
npm run cov:rs
```

The report will be in `coverage-rust/html/index.html` and `coverage-rust/lcov.info`.

If `cargo-llvm-cov` isn't installed, the script prints fallback commands using `cargo tarpaulin`:

```
cargo install cargo-tarpaulin
cargo tarpaulin -v --timeout 120 --out Html --out Lcov --engine SourceAnalysis
```

Run both coverage suites in one go with:

```
npm run cov:all
```

Coverage is non-blocking and only for local development.

