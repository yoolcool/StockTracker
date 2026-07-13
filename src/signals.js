import { rounded } from "./utils.js";

const DEFAULT_PIVOT_WINDOW = 5;
const DEFAULT_MIN_SWING_PCT = 5;

export function buildStockSignal(item, marketItem, regime) {
  if (!marketItem || marketItem.dataStatus !== "ok") {
    return {
      ...identity(item),
      dataStatus: "missing",
      stage: "데이터 없음",
      action: "가격 데이터 확인 필요",
      confidence: "LOW",
      reason: marketItem?.reason || "No data"
    };
  }

  const history = marketItem.history || [];
  const pivots = detectPivots(history, DEFAULT_PIVOT_WINDOW, DEFAULT_MIN_SWING_PCT);
  const latestClose = Number(marketItem.lastClose);
  const latestDate = marketItem.dataDate;
  const lastLow = pivots.lows.at(-1);
  const highsAfterLow = lastLow ? pivots.highs.filter((pivot) => pivot.index > lastLow.index) : [];
  const highsBeforeLow = lastLow ? pivots.highs.filter((pivot) => pivot.index < lastLow.index) : pivots.highs;
  const firstReclaim = highsAfterLow.at(-1) || highsBeforeLow.at(-1) || null;
  const secondReclaim = highsBeforeLow.at(-1) || highsAfterLow.at(-2) || null;
  const high52w = Number(marketItem.high52w);
  const nearBreakoutPct = firstReclaim ? distancePct(latestClose, firstReclaim.price) : null;
  const isNewHigh = Number.isFinite(high52w) && latestClose >= high52w * 0.999;
  const firstTriggered = firstReclaim ? latestClose >= firstReclaim.price : false;
  const secondTriggered = secondReclaim ? latestClose >= secondReclaim.price : false;
  const defensiveMarket = regime?.targetAllocation?.stocks <= 30;

  let stage = "관망";
  let action = defensiveMarket ? "시장 방어 국면: 신호가 켜져도 분할 규모 축소" : "다음 돌파 가격 대기";
  let targetWeight = defensiveMarket ? 0 : 0;
  let confidence = firstReclaim ? "MEDIUM" : "LOW";

  if (isNewHigh) {
    stage = "전량 투입 후보";
    action = "신고가 갱신: 잔여 현금 투입 후보";
    targetWeight = 100;
    confidence = "HIGH";
  } else if (secondTriggered) {
    stage = "2차 매수";
    action = "상위 전고점 돌파: 2차 분할 매수 후보";
    targetWeight = defensiveMarket ? 30 : 70;
    confidence = "HIGH";
  } else if (firstTriggered) {
    stage = "1차 매수";
    action = "바닥 이후 전고점 돌파: 1차 분할 매수 후보";
    targetWeight = defensiveMarket ? 20 : 40;
    confidence = "MEDIUM";
  }

  const nextTrigger = nextTriggerFor({ firstTriggered, secondTriggered, isNewHigh, firstReclaim, secondReclaim, high52w });

  return {
    ...identity(item),
    dataStatus: "ok",
    dataDate: latestDate,
    lastClose: marketItem.lastClose,
    dailyChangePct: marketItem.dailyChangePct,
    return5dPct: marketItem.return5dPct,
    return20dPct: marketItem.return20dPct,
    drawdownFrom52wHighPct: marketItem.drawdownFrom52wHighPct,
    high52w: marketItem.high52w,
    stage,
    action,
    targetWeight,
    confidence,
    nextTrigger,
    bottom: lastLow ? serializePivot(lastLow) : null,
    firstReclaim: firstReclaim ? serializePivot(firstReclaim) : null,
    secondReclaim: secondReclaim ? serializePivot(secondReclaim) : null,
    distanceToFirstReclaimPct: nearBreakoutPct,
    chart: compactChartData(history),
    pivots: {
      lows: pivots.lows.slice(-5).map(serializePivot),
      highs: pivots.highs.slice(-5).map(serializePivot)
    },
    reason: signalReason({ stage, lastLow, firstReclaim, secondReclaim, isNewHigh, defensiveMarket })
  };
}

export function detectPivots(history, window = DEFAULT_PIVOT_WINDOW, minSwingPct = DEFAULT_MIN_SWING_PCT) {
  const highs = [];
  const lows = [];

  for (let index = window; index < history.length - window; index += 1) {
    const bar = history[index];
    const slice = history.slice(index - window, index + window + 1);
    const isHigh = bar.high >= Math.max(...slice.map((row) => row.high));
    const isLow = bar.low <= Math.min(...slice.map((row) => row.low));
    if (isHigh) appendPivot(highs, { type: "high", index, date: bar.date, price: rounded(bar.high, 4) }, minSwingPct);
    if (isLow) appendPivot(lows, { type: "low", index, date: bar.date, price: rounded(bar.low, 4) }, minSwingPct);
  }

  return { highs, lows };
}

function appendPivot(pivots, pivot, minSwingPct) {
  const previous = pivots.at(-1);
  if (!previous) {
    pivots.push(pivot);
    return;
  }
  const move = Math.abs(((pivot.price - previous.price) / previous.price) * 100);
  if (move >= minSwingPct) {
    pivots.push(pivot);
  } else if (pivot.type === "high" && pivot.price > previous.price) {
    pivots[pivots.length - 1] = pivot;
  } else if (pivot.type === "low" && pivot.price < previous.price) {
    pivots[pivots.length - 1] = pivot;
  }
}

function nextTriggerFor({ firstTriggered, secondTriggered, isNewHigh, firstReclaim, secondReclaim, high52w }) {
  if (!firstTriggered && firstReclaim) return { label: "1차 매수", price: firstReclaim.price, date: firstReclaim.date };
  if (!secondTriggered && secondReclaim) return { label: "2차 매수", price: secondReclaim.price, date: secondReclaim.date };
  if (!isNewHigh && Number.isFinite(high52w)) return { label: "신고가", price: rounded(high52w, 4), date: null };
  return { label: "추가 트리거 없음", price: null, date: null };
}

function signalReason({ stage, lastLow, firstReclaim, secondReclaim, isNewHigh, defensiveMarket }) {
  const parts = [];
  if (lastLow) parts.push(`bottom ${lastLow.date} @ ${lastLow.price}`);
  if (firstReclaim) parts.push(`first reclaim ${firstReclaim.date} @ ${firstReclaim.price}`);
  if (secondReclaim) parts.push(`second reclaim ${secondReclaim.date} @ ${secondReclaim.price}`);
  if (isNewHigh) parts.push("52-week high reached");
  if (defensiveMarket) parts.push("market allocation is defensive");
  return `${stage}: ${parts.join("; ") || "insufficient pivot structure"}`;
}

function distancePct(current, trigger) {
  if (!Number.isFinite(current) || !Number.isFinite(trigger) || trigger === 0) return null;
  return rounded(((current - trigger) / trigger) * 100);
}

function serializePivot(pivot) {
  return {
    date: pivot.date,
    price: pivot.price
  };
}

function compactChartData(history) {
  return history.slice(-180).map((bar) => ({
    date: bar.date,
    close: rounded(bar.close, 4),
    high: rounded(bar.high, 4),
    low: rounded(bar.low, 4)
  }));
}

function identity(item) {
  return {
    ticker: item.ticker,
    name: item.name || item.ticker,
    market: item.market
  };
}
