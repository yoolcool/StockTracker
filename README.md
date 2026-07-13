# Stock Tracker

Daily stock timing tracker for a small US/KR watchlist.

The project generates a static report in `docs/` so it can be published with GitHub Pages. A scheduled GitHub Actions workflow refreshes market data, evaluates market regime, detects per-stock staged buy signals, and updates the report.

## Local Run

```bash
npm run daily
```

## Watchlist

Edit `config/watchlist.json` to add or remove symbols. Use Yahoo Finance symbols, such as `AAPL`, `NVDA`, `005930.KS`, or `035420.KS`.
