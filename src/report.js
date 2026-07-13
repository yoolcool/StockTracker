import { escapeHtml, money, pct } from "./utils.js";

export function renderReport(report) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stock Tracker</title>
  <style>${styles()}</style>
</head>
<body>
  <header class="topbar">
    <div>
      <p class="eyebrow">Daily Timing Tracker</p>
      <h1>Stock Tracker</h1>
    </div>
    <div class="timestamp">
      <span>${escapeHtml(report.generatedAtKst)}</span>
      <strong>${escapeHtml(report.tradingDate || "n/a")}</strong>
    </div>
  </header>

  <main>
    <section class="summary-grid">
      ${renderMarketCard(report.regimes.us, "US")}
      ${renderMarketCard(report.regimes.kr, "KR")}
    </section>

    <section class="section-header">
      <div>
        <p class="eyebrow">Watchlist</p>
        <h2>매수 타이밍 신호</h2>
      </div>
      <div class="pill">${report.stocks.length}/${report.watchlistMaxItems} tracked</div>
    </section>

    <section class="stock-grid">
      ${report.stocks.map((stock) => renderStockCard(stock, report.marketProfiles[stock.market])).join("")}
    </section>

    <section class="details">
      <h2>시장 국면 세부</h2>
      <div class="details-grid">
        ${renderRegimeDetails(report.regimes.us, report.marketProfiles.us)}
        ${renderRegimeDetails(report.regimes.kr, report.marketProfiles.kr)}
      </div>
    </section>
  </main>
</body>
</html>
`;
}

function renderMarketCard(regime, label) {
  const allocation = regime?.targetAllocation || { stocks: 0, cash: 0 };
  return `<article class="market-card ${toneClass(regime?.label)}">
    <div class="market-card-head">
      <span>${label}</span>
      <strong>${escapeHtml(regime?.label || "데이터 없음")}</strong>
    </div>
    <div class="score-row">
      <div>
        <p>Regime Score</p>
        <strong>${regime?.score ?? "n/a"}</strong>
      </div>
      <div>
        <p>Target</p>
        <strong>${allocation.stocks}:${allocation.cash}</strong>
      </div>
    </div>
    <p class="bias">${escapeHtml(regime?.actionBias || "데이터 확인 필요")}</p>
    <p class="muted">${escapeHtml(regime?.conclusion || "")}</p>
  </article>`;
}

function renderStockCard(stock, profile) {
  const trigger = stock.nextTrigger || {};
  const currency = profile?.currency || "USD";
  return `<article class="stock-card ${stageClass(stock.stage)}">
    <div class="stock-head">
      <div>
        <span class="ticker">${escapeHtml(stock.ticker)}</span>
        <h3>${escapeHtml(stock.name)}</h3>
      </div>
      <span class="market-badge">${escapeHtml((stock.market || "").toUpperCase())}</span>
    </div>
    <div class="price-line">
      <strong>${money(stock.lastClose, currency)}</strong>
      <span class="${Number(stock.dailyChangePct) >= 0 ? "up" : "down"}">${pct(stock.dailyChangePct)}</span>
    </div>
    <div class="stage-row">
      <span>${escapeHtml(stock.stage)}</span>
      <strong>${escapeHtml(stock.confidence)}</strong>
    </div>
    <p class="action">${escapeHtml(stock.action)}</p>
    <dl class="metric-list">
      <div><dt>Next</dt><dd>${escapeHtml(trigger.label || "n/a")} ${trigger.price ? money(trigger.price, currency) : ""}</dd></div>
      <div><dt>20D</dt><dd>${pct(stock.return20dPct)}</dd></div>
      <div><dt>52W DD</dt><dd>${pct(stock.drawdownFrom52wHighPct)}</dd></div>
      <div><dt>Target</dt><dd>${stock.targetWeight ?? 0}%</dd></div>
    </dl>
    <p class="muted small">${escapeHtml(stock.reason)}</p>
  </article>`;
}

function renderRegimeDetails(regime, profile) {
  const benchmarks = regime?.technical?.benchmarks || [];
  const signals = regime?.macro?.signals || [];
  return `<article class="detail-panel">
    <h3>${escapeHtml(profile.label)}</h3>
    <div class="mini-grid">
      <div><span>기술</span><strong>${regime?.technical?.score ?? "n/a"}</strong></div>
      <div><span>매크로</span><strong>${regime?.macro?.score ?? "n/a"}</strong></div>
      <div><span>커버리지</span><strong>${regime?.coverage?.technical ?? 0}/${regime?.coverage?.technicalTotal ?? 0}</strong></div>
    </div>
    <h4>Benchmarks</h4>
    <table>
      <thead><tr><th>자산</th><th>점수</th><th>20D</th><th>상태</th></tr></thead>
      <tbody>${benchmarks.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.score}</td><td>${pct(row.return20dPct)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join("")}</tbody>
    </table>
    <h4>Macro</h4>
    <table>
      <thead><tr><th>지표</th><th>점수</th><th>20D</th><th>해석</th></tr></thead>
      <tbody>${signals.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.score}</td><td>${pct(row.return20dPct)}</td><td>${escapeHtml(row.reason)}</td></tr>`).join("")}</tbody>
    </table>
  </article>`;
}

function toneClass(label) {
  if (label === "강세장" || label === "중립-상승") return "positive";
  if (label === "중립") return "neutral";
  return "negative";
}

function stageClass(stage) {
  if (/전량|2차/.test(stage)) return "stage-hot";
  if (/1차/.test(stage)) return "stage-watch";
  if (/데이터/.test(stage)) return "stage-missing";
  return "stage-calm";
}

function styles() {
  return `
:root {
  color-scheme: light;
  --ink: #172026;
  --muted: #66727a;
  --line: #d9e0e4;
  --bg: #f5f7f4;
  --panel: #ffffff;
  --green: #177245;
  --red: #b33a3a;
  --amber: #9a6700;
  --blue: #1c5d99;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: Arial, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif;
}
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 24px;
  padding: 28px clamp(16px, 4vw, 48px);
  border-bottom: 1px solid var(--line);
  background: #fbfcfa;
}
h1, h2, h3, h4, p { margin: 0; }
h1 { font-size: clamp(32px, 5vw, 56px); letter-spacing: 0; }
h2 { font-size: 24px; }
h3 { font-size: 18px; }
h4 { margin-top: 22px; margin-bottom: 8px; font-size: 14px; color: var(--muted); }
main { padding: 24px clamp(16px, 4vw, 48px) 48px; }
.eyebrow { color: var(--muted); font-size: 12px; text-transform: uppercase; font-weight: 700; }
.timestamp { text-align: right; color: var(--muted); display: grid; gap: 4px; }
.timestamp strong { color: var(--ink); }
.summary-grid, .details-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.market-card, .stock-card, .detail-panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 18px;
}
.market-card { border-top: 5px solid var(--blue); }
.market-card.positive { border-top-color: var(--green); }
.market-card.negative { border-top-color: var(--red); }
.market-card.neutral { border-top-color: var(--amber); }
.market-card-head, .stock-head, .section-header, .stage-row, .price-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
}
.market-card-head span, .ticker { color: var(--muted); font-size: 13px; font-weight: 700; }
.market-card-head strong { font-size: 22px; }
.score-row, .mini-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 18px 0;
}
.score-row div, .mini-grid div {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
}
.score-row p, .mini-grid span { color: var(--muted); font-size: 12px; }
.score-row strong, .mini-grid strong { display: block; margin-top: 4px; font-size: 24px; }
.bias, .action { font-weight: 700; margin-bottom: 8px; }
.muted { color: var(--muted); line-height: 1.5; }
.small { font-size: 12px; }
.section-header { margin: 28px 0 14px; }
.pill, .market-badge {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 6px 10px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.stock-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.stock-card { border-left: 5px solid var(--line); }
.stock-card.stage-hot { border-left-color: var(--green); }
.stock-card.stage-watch { border-left-color: var(--blue); }
.stock-card.stage-missing { border-left-color: var(--red); }
.stock-head { align-items: start; }
.price-line { margin: 16px 0; }
.price-line strong { font-size: 26px; }
.up { color: var(--green); }
.down { color: var(--red); }
.stage-row {
  padding: 10px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.metric-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}
.metric-list div {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  min-height: 62px;
}
dt { color: var(--muted); font-size: 12px; }
dd { margin: 4px 0 0; font-weight: 700; }
.details { margin-top: 30px; }
.details h2 { margin-bottom: 14px; }
.detail-panel { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; border-top: 1px solid var(--line); padding: 9px 8px; vertical-align: top; }
th { color: var(--muted); font-size: 12px; }
@media (max-width: 780px) {
  .topbar, .section-header { align-items: start; flex-direction: column; }
  .timestamp { text-align: left; }
  .summary-grid, .details-grid { grid-template-columns: 1fr; }
}
`;
}
