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

