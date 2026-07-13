import { escapeHtml, money, pct, rounded } from "./utils.js";

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
        <h2>차트 기반 매수 타이밍</h2>
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
    ${renderPriceChart(stock, currency)}
    ${renderPriceChart(stock, currency, { days: 5, title: "최근 1주 확대", variant: "week-zoom" })}
    <div class="stage-row">
      <span>${escapeHtml(stock.stage)}</span>
      <strong>${escapeHtml(stock.confidence)}</strong>
    </div>
    <p class="action">${escapeHtml(stock.action)}</p>
    <dl class="metric-list">
      <div><dt>다음 목표</dt><dd>${escapeHtml(trigger.label || "n/a")} ${trigger.price ? money(trigger.price, currency) : ""}</dd></div>
      <div><dt>목표까지</dt><dd>${distanceToTrigger(stock, trigger)}</dd></div>
      <div><dt>20일 수익률</dt><dd>${pct(stock.return20dPct)}</dd></div>
      <div><dt>12주 고점 대비</dt><dd>${pct(stock.drawdownFromTrackingHighPct)}</dd></div>
    </dl>
    ${renderTargetStack(stock, currency)}
    <p class="muted small">${escapeHtml(stock.reason)}</p>
  </article>`;
}

function renderPriceChart(stock, currency, options = {}) {
  const fullChart = Array.isArray(stock.chart) ? stock.chart.filter((bar) => Number.isFinite(Number(bar.close))) : [];
  const chart = options.days ? fullChart.slice(-options.days) : fullChart;
  if (chart.length < 2) return `<div class="chart-empty">차트 데이터 없음</div>`;

  const width = 720;
  const height = options.days ? 360 : 250;
  const pad = { top: options.title ? 34 : 20, right: 120, bottom: 32, left: 12 };
  const levels = chartLevels(stock);
  const prices = [
    ...chart.flatMap((bar) => [bar.high, bar.low, bar.close]),
    ...levels.map((level) => level.price)
  ].map(Number).filter(Number.isFinite);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const yMin = min - span * 0.08;
  const yMax = max + span * 0.12;
  const x = (index) => pad.left + (index / (chart.length - 1)) * (width - pad.left - pad.right);
  const y = (price) => pad.top + ((yMax - Number(price)) / (yMax - yMin)) * (height - pad.top - pad.bottom);
  const linePath = chart.map((bar, index) => `${index === 0 ? "M" : "L"}${rounded(x(index), 2)} ${rounded(y(bar.close), 2)}`).join(" ");
  const areaPath = `${linePath} L${rounded(x(chart.length - 1), 2)} ${height - pad.bottom} L${pad.left} ${height - pad.bottom} Z`;
  const firstDate = chart[0].date;
  const lastDate = chart.at(-1).date;
  const markerSvg = renderPivotMarkers(stock, chart, x, y, { exactOnly: Boolean(options.days) });
  const chartId = `${safeId(stock.ticker)}-${options.variant || "full"}`;

  return `<div class="chart-wrap ${options.variant || "full"}">
    <svg class="price-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(stock.ticker)} price chart with buy trigger levels">
      <defs>
        <linearGradient id="area-${chartId}" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#1c5d99" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#1c5d99" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" rx="8" class="chart-bg"/>
      ${options.title ? `<text x="${pad.left}" y="20" class="chart-title">${escapeHtml(options.title)}</text>` : ""}
      ${[0.25, 0.5, 0.75].map((ratio) => `<line x1="${pad.left}" x2="${width - pad.right}" y1="${rounded(pad.top + ratio * (height - pad.top - pad.bottom), 2)}" y2="${rounded(pad.top + ratio * (height - pad.top - pad.bottom), 2)}" class="grid-line"/>`).join("")}
      <path d="${areaPath}" fill="url(#area-${chartId})"/>
      <path d="${linePath}" class="price-path"/>
      ${renderLevelLines(levels, y, width, height, pad, currency)}
      ${markerSvg}
      <circle cx="${rounded(x(chart.length - 1), 2)}" cy="${rounded(y(stock.lastClose), 2)}" r="4.5" class="current-dot"/>
      <text x="${width - pad.right + 12}" y="${rounded(y(stock.lastClose), 2) + 4}" class="current-label">${escapeHtml(money(stock.lastClose, currency))}</text>
      <text x="${pad.left}" y="${height - 10}" class="axis-label">${escapeHtml(firstDate)}</text>
      <text x="${width - pad.right}" y="${height - 10}" text-anchor="end" class="axis-label">${escapeHtml(lastDate)}</text>
    </svg>
    <div class="legend">
      <span><i class="legend-line price"></i>종가</span>
      <span><i class="legend-line buy1"></i>1차 목표</span>
      <span><i class="legend-line buy2"></i>2차 목표</span>
      <span><i class="legend-line buy3"></i>3차 목표</span>
      <span><i class="legend-line breakout"></i>신고가 목표</span>
      <span><i class="legend-dot"></i>바닥</span>
    </div>
  </div>`;
}

function renderLevelLines(levels, y, width, height, pad, currency) {
  const rows = levels
    .map((level) => ({ ...level, yPos: y(level.price) }))
    .sort((a, b) => a.yPos - b.yPos);
  let nextLabelY = pad.top + 8;

  return rows.map((level) => {
    const labelY = Math.min(Math.max(level.yPos, nextLabelY), height - pad.bottom - 18);
    nextLabelY = labelY + 24;
    return renderLevelLine(level, labelY, width, pad, currency);
  }).join("");
}

function renderLevelLine(level, labelY, width, pad, currency) {
  return `<g>
    <line x1="${pad.left}" x2="${width - pad.right}" y1="${rounded(level.yPos, 2)}" y2="${rounded(level.yPos, 2)}" class="level-line ${level.className}"/>
    <text x="${width - pad.right + 12}" y="${rounded(labelY, 2) - 4}" class="level-label">${escapeHtml(level.label)}</text>
    <text x="${width - pad.right + 12}" y="${rounded(labelY, 2) + 11}" class="level-price">${escapeHtml(money(level.price, currency))}</text>
  </g>`;
}

function renderPivotMarkers(stock, chart, x, y, options = {}) {
  const markers = [
    { ...stock.bottom, kind: "bottom", label: "바닥" },
    ...(stock.targets || []).map((target) => ({
      ...target,
      kind: "high",
      label: `${target.targetNumber}차`
    }))
  ].filter((marker) => marker.date && Number.isFinite(Number(marker.price)));

  return markers.map((marker) => {
    const index = options.exactOnly ? chart.findIndex((bar) => bar.date === marker.date) : nearestDateIndex(chart, marker.date);
    if (index < 0) return "";
    const cx = rounded(x(index), 2);
    const cy = rounded(y(marker.price), 2);
    const cls = marker.kind === "bottom" ? "pivot-low" : "pivot-high";
    const textY = marker.kind === "bottom" ? cy + 18 : cy - 10;
    return `<g>
      <circle cx="${cx}" cy="${cy}" r="4" class="${cls}"/>
      <text x="${cx}" y="${textY}" text-anchor="middle" class="pivot-label">${escapeHtml(marker.label)}</text>
    </g>`;
  }).join("");
}

function renderTargetStack(stock, currency) {
  const rows = chartLevels(stock);
  if (!rows.length) return "";
  return `<div class="target-stack">
    ${rows.map((row) => `<div>
      <span>${escapeHtml(row.label)}</span>
      <strong>${money(row.price, currency)}</strong>
    </div>`).join("")}
  </div>`;
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

function chartLevels(stock) {
  const rows = [];
  const addLevel = (next) => {
    const existing = rows.find((row) => Math.abs((row.price - next.price) / row.price) < 0.001);
    if (existing) {
      existing.label = `${existing.label} / ${next.label}`;
      if (next.className === "breakout") existing.className = "breakout";
      return;
    }
    rows.push(next);
  };
  (stock.targets || []).forEach((target) => {
    addLevel({
      label: `${target.targetNumber}차 목표`,
      price: Number(target.price),
      className: `buy${target.targetNumber}`
    });
  });
  if (stock.breakoutTarget?.price) {
    addLevel({ label: "신고가 목표", price: Number(stock.breakoutTarget.price), className: "breakout" });
  }
  return rows.filter((row) => Number.isFinite(row.price));
}

function nearestDateIndex(chart, date) {
  const exact = chart.findIndex((bar) => bar.date === date);
  if (exact >= 0) return exact;
  const target = new Date(date).getTime();
  if (!Number.isFinite(target)) return -1;
  let best = -1;
  let bestDelta = Infinity;
  chart.forEach((bar, index) => {
    const delta = Math.abs(new Date(bar.date).getTime() - target);
    if (delta < bestDelta) {
      best = index;
      bestDelta = delta;
    }
  });
  return best;
}

function distanceToTrigger(stock, trigger) {
  if (!trigger?.price || !Number.isFinite(Number(stock.lastClose))) return "n/a";
  return pct(((Number(trigger.price) - Number(stock.lastClose)) / Number(stock.lastClose)) * 100);
}

function toneClass(label) {
  if (label === "강세장" || label === "중립-상승") return "positive";
  if (label === "중립") return "neutral";
  return "negative";
}

function stageClass(stage) {
  if (/(전량|2차)/.test(stage)) return "stage-hot";
  if (/1차/.test(stage)) return "stage-watch";
  if (/데이터/.test(stage)) return "stage-missing";
  return "stage-calm";
}

function safeId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
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
  --violet: #6b4fd6;
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
  grid-template-columns: repeat(auto-fit, minmax(420px, 1fr));
  gap: 16px;
}
.stock-card { border-left: 5px solid var(--line); }
.stock-card.stage-hot { border-left-color: var(--green); }
.stock-card.stage-watch { border-left-color: var(--blue); }
.stock-card.stage-missing { border-left-color: var(--red); }
.stock-head { align-items: start; }
.price-line { margin: 16px 0 10px; }
.price-line strong { font-size: 26px; }
.up { color: var(--green); }
.down { color: var(--red); }
.chart-wrap {
  margin: 10px 0 14px;
  border: 1px solid var(--line);
  border-radius: 8px;
  overflow: hidden;
  background: #fbfcfa;
}
.price-chart {
  display: block;
  width: 100%;
  height: auto;
}
.chart-wrap.full .price-chart {
  aspect-ratio: 720 / 250;
}
.chart-wrap.week-zoom .price-chart {
  aspect-ratio: 720 / 360;
}
.chart-title {
  fill: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.chart-bg { fill: #fbfcfa; }
.grid-line { stroke: #e6ecef; stroke-width: 1; }
.price-path {
  fill: none;
  stroke: var(--blue);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.level-line {
  stroke-width: 1.6;
  stroke-dasharray: 6 5;
}
.level-line.buy1 { stroke: var(--blue); }
.level-line.buy2 { stroke: var(--violet); }
.level-line.buy3 { stroke: var(--amber); }
.level-line.breakout { stroke: var(--green); }
.level-label {
  fill: var(--muted);
  font-size: 12px;
  font-weight: 700;
}
.level-price, .current-label {
  fill: var(--ink);
  font-size: 11px;
  font-weight: 700;
}
.current-dot {
  fill: var(--ink);
  stroke: #fff;
  stroke-width: 2;
}
.pivot-low {
  fill: var(--amber);
  stroke: #fff;
  stroke-width: 2;
}
.pivot-high {
  fill: var(--blue);
  stroke: #fff;
  stroke-width: 2;
}
.pivot-label, .axis-label {
  fill: var(--muted);
  font-size: 11px;
  font-weight: 700;
}
.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 14px;
  padding: 8px 10px 10px;
  color: var(--muted);
  font-size: 12px;
}
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend-line {
  display: inline-block;
  width: 18px;
  height: 0;
  border-top: 2px solid var(--blue);
}
.legend-line.buy1 { border-top-style: dashed; border-top-color: var(--blue); }
.legend-line.buy2 { border-top-style: dashed; border-top-color: var(--violet); }
.legend-line.buy3 { border-top-style: dashed; border-top-color: var(--amber); }
.legend-line.breakout { border-top-style: dashed; border-top-color: var(--green); }
.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--amber);
}
.chart-empty {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 32px;
  color: var(--muted);
  text-align: center;
}
.stage-row {
  padding: 10px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  margin-bottom: 12px;
}
.metric-list, .target-stack {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}
.metric-list div, .target-stack div {
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 10px;
  min-height: 62px;
}
.target-stack {
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}
.target-stack span, dt { color: var(--muted); font-size: 12px; }
.target-stack strong, dd { display: block; margin: 4px 0 0; font-weight: 700; }
.details { margin-top: 30px; }
.details h2 { margin-bottom: 14px; }
.detail-panel { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; border-top: 1px solid var(--line); padding: 9px 8px; vertical-align: top; }
th { color: var(--muted); font-size: 12px; }
@media (max-width: 900px) {
  .stock-grid { grid-template-columns: 1fr; }
  .metric-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 780px) {
  .topbar, .section-header { align-items: start; flex-direction: column; }
  .timestamp { text-align: left; }
  .summary-grid, .details-grid { grid-template-columns: 1fr; }
}
`;
}
