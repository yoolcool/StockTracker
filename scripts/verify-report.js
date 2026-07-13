import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const htmlPath = path.join(root, "docs", "index.html");
const jsonPath = path.join(root, "docs", "latest-report.json");

assert(fs.existsSync(htmlPath), "docs/index.html is missing");
assert(fs.existsSync(jsonPath), "docs/latest-report.json is missing");

const html = fs.readFileSync(htmlPath, "utf8");
const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

assert(html.includes("Stock Tracker"), "HTML title/header missing");
assert(html.includes("차트 기반 매수 타이밍"), "HTML stock signal section missing");
assert(html.includes("price-chart"), "HTML price chart missing");
assert(html.includes("시장 국면 세부"), "HTML regime details missing");
assert(report.regimes?.us?.label, "US regime missing");
assert(report.regimes?.kr?.label, "KR regime missing");
assert(Array.isArray(report.stocks), "stocks array missing");
assert(report.stocks.length > 0, "no stock signals generated");

for (const stock of report.stocks) {
  assert(stock.ticker, "stock ticker missing");
  assert(stock.stage, `stage missing for ${stock.ticker}`);
  assert(stock.nextTrigger, `nextTrigger missing for ${stock.ticker}`);
  assert(Array.isArray(stock.chart), `chart data missing for ${stock.ticker}`);
  assert(stock.chart.length <= 60, `chart data exceeds 12-week window for ${stock.ticker}`);
  assert(stock.trackingWindow?.weeks === 12, `tracking window missing for ${stock.ticker}`);
  assert(Array.isArray(stock.targets), `target levels missing for ${stock.ticker}`);
  assert(stock.breakoutTarget, `breakout target missing for ${stock.ticker}`);
}

console.log(`Verified report: ${report.stocks.length} stocks, US ${report.regimes.us.label}, KR ${report.regimes.kr.label}.`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
