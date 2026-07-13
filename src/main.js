import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMarketItem } from "./dataProvider.js";
import { buildMarketRegimeAssessment } from "./regime.js";
import { renderReport } from "./report.js";
import { buildStockSignal } from "./signals.js";
import { readJson, todayIso, unique, writeJson, writeText } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

async function main() {
  const watchlist = await readJson(path.join(root, "config", "watchlist.json"));
  const marketProfiles = {
    us: await readJson(path.join(root, "config", "markets", "us.json")),
    kr: await readJson(path.join(root, "config", "markets", "kr.json"))
  };

  validateWatchlist(watchlist);

  const tickers = collectTickers(watchlist, marketProfiles);
  const marketData = {};
  for (const ticker of tickers) {
    marketData[ticker] = await fetchMarketItem(ticker);
  }

  const previous = await readPreviousSnapshot();
  const regimes = {
    us: buildMarketRegimeAssessment(marketProfiles.us, marketData, previous?.regimes?.us),
    kr: buildMarketRegimeAssessment(marketProfiles.kr, marketData, previous?.regimes?.kr)
  };

  const stocks = watchlist.items.map((item) => buildStockSignal(item, marketData[item.ticker], regimes[item.market]));
  const tradingDate = latestTradingDate(stocks, regimes);
  const generatedAt = new Date().toISOString();
  const report = {
    generatedAt,
    generatedAtKst: new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      dateStyle: "medium",
      timeStyle: "short"
    }).format(new Date(generatedAt)),
    tradingDate,
    watchlistMaxItems: watchlist.maxItems,
    marketProfiles,
    regimes,
    stocks
  };

  await writeJson(path.join(root, "data", "latest-report.json"), report);
  await writeJson(path.join(root, "docs", "latest-report.json"), report);
  await writeText(path.join(root, "docs", "index.html"), renderReport(report));
  await writeText(path.join(root, "docs", ".nojekyll"), "");

  console.log(`Generated report for ${stocks.length} stocks (${todayIso()}).`);
}

function validateWatchlist(watchlist) {
  if (!Array.isArray(watchlist.items)) throw new Error("config/watchlist.json must include items array.");
  if (watchlist.items.length > Number(watchlist.maxItems || 10)) {
    throw new Error(`Watchlist has ${watchlist.items.length} items, max is ${watchlist.maxItems}.`);
  }
  for (const item of watchlist.items) {
    if (!item.ticker || !["us", "kr"].includes(item.market)) {
      throw new Error(`Invalid watchlist item: ${JSON.stringify(item)}`);
    }
  }
}

function collectTickers(watchlist, marketProfiles) {
  return unique([
    ...watchlist.items.map((item) => item.ticker),
    ...Object.values(marketProfiles).flatMap((profile) => [
      ...(profile.benchmarkTickers || []),
      ...(profile.regimeBenchmarks || []).flatMap((row) => [row.ticker, row.fallbackTicker]),
      ...(profile.macroSignals || []).map((row) => row.ticker)
    ])
  ]);
}

async function readPreviousSnapshot() {
  try {
    return await readJson(path.join(root, "data", "latest-report.json"));
  } catch {
    return null;
  }
}

function latestTradingDate(stocks, regimes) {
  const dates = [
    ...stocks.map((row) => row.dataDate),
    ...Object.values(regimes).flatMap((regime) => (regime.technical?.benchmarks || []).map((row) => row.dataDate))
  ].filter(Boolean);
  return dates.sort().at(-1) || null;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
