# Development Scripts

Seed a deterministic dev database:

```
VITE_ENV=development npm run dev:seed -- --households 2 --rows 1000 --seed 7 --reset
```

Run the seed script and profile common queries in one go:

```
VITE_ENV=development npm run dev:profile -- --households 2 --rows 1000 --seed 7 --reset
```

