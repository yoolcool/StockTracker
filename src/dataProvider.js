import { rounded } from "./utils.js";

const YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart";

export async function fetchMarketItem(ticker, range = "2y") {
  const params = new URLSearchParams({
    range,
    interval: "1d",
    includePrePost: "false",
    events: "div,splits"
  });
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?${params}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 StockTracker/0.1"
      }
    });
    if (!response.ok) {
      return missingItem(ticker, `HTTP ${response.status}`);
    }
    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const bars = parseBars(result);
    if (!bars.length) return missingItem(ticker, "No price history");
    return buildMarketItem(ticker, bars);
  } catch (error) {
    return missingItem(ticker, error.message);
  }
}

function parseBars(result) {
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  return timestamps
    .map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: quote.open?.[index],
      high: quote.high?.[index],
      low: quote.low?.[index],
      close: quote.close?.[index],
      volume: quote.volume?.[index]
    }))
    // Yahoo can briefly publish an unfinished daily bar with a zero close.
    // Treat it as missing so it cannot create a false 100% drawdown signal.
    .filter((bar) => Number.isFinite(Number(bar.close)) && Number(bar.close) > 0)
    .map((bar) => ({
      date: bar.date,
      open: Number(bar.open ?? bar.close),
      high: Number(bar.high ?? bar.close),
      low: Number(bar.low ?? bar.close),
      close: Number(bar.close),
      volume: Number(bar.volume || 0)
    }));
}

function buildMarketItem(ticker, history) {
  const last = history.at(-1);
  const prev = history.at(-2);
  const closes = history.map((bar) => bar.close);
  const high52w = Math.max(...history.slice(-252).map((bar) => bar.high));
  const low52w = Math.min(...history.slice(-252).map((bar) => bar.low));

  return {
    ticker,
    dataStatus: "ok",
    dataFreshness: "LIVE",
    dataDate: last.date,
    lastClose: rounded(last.close, 4),
    dailyChangePct: prev ? rounded(((last.close - prev.close) / prev.close) * 100) : null,
    return5dPct: returnPct(closes, 5),
    return20dPct: returnPct(closes, 20),
    return60dPct: returnPct(closes, 60),
    drawdownFrom52wHighPct: high52w ? rounded(((last.close - high52w) / high52w) * 100) : null,
    high52w: rounded(high52w, 4),
    low52w: rounded(low52w, 4),
    history
  };
}

function returnPct(closes, days) {
  if (closes.length <= days) return null;
  const last = closes.at(-1);
  const then = closes.at(-1 - days);
  return then ? rounded(((last - then) / then) * 100) : null;
}

function missingItem(ticker, reason) {
  return {
    ticker,
    dataStatus: "missing",
    dataFreshness: "MISSING",
    reason,
    history: []
  };
}
