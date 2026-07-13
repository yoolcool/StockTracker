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
  const targets = buildReclaimTargets(pivots.highs, lastLow);
  const firstReclaim = targets[0] || null;
  const secondReclaim = targets[1] || null;
  const thirdReclaim = targets[2] || null;
  const breakoutTarget = buildBreakoutTarget(history, latestDate);
  const nearBreakoutPct = firstReclaim ? distancePct(latestClose, firstReclaim.price) : null;
  const achievedTargets = targets.filter((target) => latestClose >= Number(target.price));
  const isNewHigh = breakoutTarget ? latestClose >= Number(breakoutTarget.price) : false;
  const defensiveMarket = regime?.targetAllocation?.stocks <= 30;

  let stage = "관망";
  let action = defensiveMarket ? "시장 방어 국면: 신호가 켜져도 분할 규모 축소" : "다음 돌파 가격 대기";
  let targetWeight = defensiveMarket ? 0 : 0;
  let confidence = firstReclaim ? "MEDIUM" : "LOW";

  if (isNewHigh) {
    stage = "최대 모멘텀";
    action = "이전 최고점 돌파: 신고가 모멘텀, 잔여 현금 전량 투입 후보";
    targetWeight = 100;
    confidence = "HIGH";
  } else if (achievedTargets.length >= 3) {
    stage = "3차 매수";
    action = "3차 목표가 돌파: 최대 모멘텀 전 단계";
    targetWeight = defensiveMarket ? 40 : 90;
    confidence = "HIGH";
  } else if (achievedTargets.length === 2) {
    stage = "2차 매수";
    action = "2차 목표가 돌파: 추가 분할 매수 후보";
    targetWeight = defensiveMarket ? 30 : 70;
    confidence = "HIGH";
  } else if (achievedTargets.length === 1) {
    stage = "1차 매수";
    action = "1차 목표가 돌파: V자 반등 1차 분할 매수 후보";
    targetWeight = defensiveMarket ? 20 : 40;
    confidence = "MEDIUM";
  }

  const nextTrigger = nextTriggerFor({ targets, achievedTargets, isNewHigh, breakoutTarget });

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
    priorPeak: breakoutTarget,
    stage,
    action,
    targetWeight,
    confidence,
    nextTrigger,
    bottom: lastLow ? serializePivot(lastLow) : null,
    firstReclaim: firstReclaim ? serializePivot(firstReclaim) : null,
    secondReclaim: secondReclaim ? serializePivot(secondReclaim) : null,
    thirdReclaim: thirdReclaim ? serializePivot(thirdReclaim) : null,
    targets: targets.map(serializeTarget),
    breakoutTarget: breakoutTarget ? serializeTarget(breakoutTarget) : null,
    distanceToFirstReclaimPct: nearBreakoutPct,
    chart: compactChartData(history),
    pivots: {
      lows: pivots.lows.slice(-5).map(serializePivot),
      highs: pivots.highs.slice(-5).map(serializePivot)
    },
    reason: signalReason({ stage, lastLow, targets, breakoutTarget, isNewHigh, defensiveMarket })
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

function buildReclaimTargets(highs, lastLow) {
  if (!lastLow) return [];
  const targets = [];
  let cursorIndex = lastLow.index;
  let minimumPrice = 0;

  while (targets.length < 3) {
    const next = highs
      .filter((pivot) => pivot.index < cursorIndex && Number(pivot.price) > minimumPrice)
      .sort((a, b) => b.index - a.index)
      .find((pivot) => Number(pivot.price) > minimumPrice);
    if (!next) break;
    const targetNumber = targets.length + 1;
    targets.push({
      ...next,
      targetNumber,
      label: `${targetNumber}차 목표가`
    });
    cursorIndex = next.index;
    minimumPrice = Number(next.price);
  }

  return targets;
}

function buildBreakoutTarget(history, latestDate) {
  const priorBars = history.filter((bar) => bar.date !== latestDate);
  if (!priorBars.length) return null;
  const best = priorBars.reduce((peak, bar, index) => {
    if (!peak || Number(bar.high) > Number(peak.price)) {
      return {
        type: "high",
        index,
        date: bar.date,
        price: rounded(bar.high, 4),
        label: "신고가 목표"
      };
    }
    return peak;
  }, null);
  return best;
}

function nextTriggerFor({ targets, achievedTargets, isNewHigh, breakoutTarget }) {
  const achievedCount = achievedTargets.length;
  const nextTarget = targets[achievedCount];
  if (nextTarget) return { label: nextTarget.label, price: nextTarget.price, date: nextTarget.date };
  if (!isNewHigh && breakoutTarget) return { label: "신고가 목표", price: breakoutTarget.price, date: breakoutTarget.date };
  return { label: "추가 트리거 없음", price: null, date: null };
}

function signalReason({ stage, lastLow, targets, breakoutTarget, isNewHigh, defensiveMarket }) {
  const parts = [];
  if (lastLow) parts.push(`bottom ${lastLow.date} @ ${lastLow.price}`);
  targets.forEach((target) => parts.push(`${target.targetNumber}차 ${target.date} @ ${target.price}`));
  if (breakoutTarget) parts.push(`breakout ${breakoutTarget.date} @ ${breakoutTarget.price}`);
  if (isNewHigh) parts.push("prior peak reached");
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

function serializeTarget(target) {
  return {
    label: target.label,
    targetNumber: target.targetNumber || null,
    date: target.date,
    price: target.price
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
