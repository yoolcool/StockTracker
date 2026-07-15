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
assert(html.includes("중요도 순서"), "stage priority legend missing");
assert(html.includes("시장 국면 세부"), "HTML regime details missing");
assert(report.regimes?.us?.label, "US regime missing");
assert(report.regimes?.kr?.label, "KR regime missing");
assert(Array.isArray(report.stocks), "stocks array missing");
assert(report.stocks.length > 0, "no stock signals generated");

const renderedStageRanks = [...html.matchAll(/data-stage-rank="(\d+)"/g)].map((match) => Number(match[1]));
assert(renderedStageRanks.length === report.stocks.length, "rendered stock card count mismatch");
for (let index = 1; index < renderedStageRanks.length; index += 1) {
  assert(renderedStageRanks[index - 1] <= renderedStageRanks[index], "stock cards are not sorted by stage priority");
}

for (const stock of report.stocks) {
  assert(stock.ticker, "stock ticker missing");
  assert(stock.dataStatus === "ok", `market data missing for ${stock.ticker}: ${stock.reason || "unknown reason"}`);
  assert(Number(stock.lastClose) > 0, `invalid last close for ${stock.ticker}: ${stock.lastClose}`);
  assert(stock.stage, `stage missing for ${stock.ticker}`);
  assert(stock.nextTrigger, `nextTrigger missing for ${stock.ticker}`);
  assert(Array.isArray(stock.chart), `chart data missing for ${stock.ticker}`);
  assert(stock.chart.length <= 60, `chart data exceeds 12-week window for ${stock.ticker}`);
  const bottomWindow = stock.chart.slice(-30);
  const expectedBottom = bottomWindow.reduce(
    (lowest, bar) => (!lowest || Number(bar.close) <= Number(lowest.close) ? bar : lowest),
    null
  );
  assert(stock.bottom?.date === expectedBottom?.date, `bottom is not the latest 30-day low for ${stock.ticker}`);
  assert(Number(stock.bottom?.price) === Number(expectedBottom?.close), `bottom price mismatch for ${stock.ticker}`);
  assert(stock.trackingWindow?.weeks === 12, `tracking window missing for ${stock.ticker}`);
  assert(Array.isArray(stock.targets), `target levels missing for ${stock.ticker}`);
  assert(stock.breakoutTarget, `breakout target missing for ${stock.ticker}`);
}

console.log(`Verified report: ${report.stocks.length} stocks, US ${report.regimes.us.label}, KR ${report.regimes.kr.label}.`);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
