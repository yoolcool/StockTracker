import { rounded } from "./utils.js";

const DEFAULT_PIVOT_WINDOW = 5;
const DEFAULT_MIN_SWING_PCT = 5;
const TARGET_PEAK_WINDOW = 2;
const TRACKING_WEEKS = 12;
const TRACKING_TRADING_DAYS = TRACKING_WEEKS * 5;
const BOTTOM_LOOKBACK_TRADING_DAYS = 30;

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
  const trackingHistory = history.slice(-TRACKING_TRADING_DAYS);
  const pivots = detectPivots(trackingHistory, DEFAULT_PIVOT_WINDOW, DEFAULT_MIN_SWING_PCT);
  const targetPeaks = detectLocalHighs(trackingHistory, TARGET_PEAK_WINDOW);
  const targetLows = detectLocalLows(trackingHistory, TARGET_PEAK_WINDOW);
  const latestClose = Number(marketItem.lastClose);
  const latestDate = marketItem.dataDate;
  const lastLow = resolveCurrentBottom(trackingHistory);
  const targets = buildReclaimTargets(trackingHistory, lastLow);
  const firstReclaim = targets[0] || null;
  const secondReclaim = targets[1] || null;
  const thirdReclaim = targets[2] || null;
  const breakoutTarget = buildBreakoutTarget(trackingHistory, latestDate);
  const trackingHigh = Math.max(...trackingHistory.map((bar) => Number(bar.close)).filter(Number.isFinite));
  const drawdownFromTrackingHighPct = Number.isFinite(trackingHigh)
    ? rounded(((latestClose - trackingHigh) / trackingHigh) * 100)
    : null;
  const nearBreakoutPct = firstReclaim ? distancePct(latestClose, firstReclaim.price) : null;
  const achievedTargets = targets.filter((target) => latestClose >= Number(target.price));
  const isNewHigh = breakoutTarget ? latestClose >= Number(breakoutTarget.price) : false;

  let stage = "관망";
  let action = "다음 돌파 가격 대기";
  let confidence = firstReclaim ? "MEDIUM" : "LOW";

  if (isNewHigh) {
    stage = "최대 모멘텀";
    action = "이전 최고점 돌파: 신고가 모멘텀 확인";
    confidence = "HIGH";
  } else if (achievedTargets.length >= 3) {
    stage = "3차 매수";
    action = "3차 목표가 돌파: 최대 모멘텀 전 단계";
    confidence = "HIGH";
  } else if (achievedTargets.length === 2) {
    stage = "2차 매수";
    action = "2차 목표가 돌파: 추가 분할 매수 후보";
    confidence = "HIGH";
  } else if (achievedTargets.length === 1) {
    stage = "1차 매수";
    action = "1차 목표가 돌파: V자 반등 1차 분할 매수 후보";
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
    drawdownFromTrackingHighPct,
    high52w: marketItem.high52w,
    trackingWindow: {
      weeks: TRACKING_WEEKS,
      tradingDays: trackingHistory.length,
      startDate: trackingHistory[0]?.date || null,
      endDate: trackingHistory.at(-1)?.date || null,
      high: Number.isFinite(trackingHigh) ? rounded(trackingHigh, 4) : null
    },
    priorPeak: breakoutTarget,
    stage,
    action,
    confidence,
    nextTrigger,
    bottom: lastLow ? serializePivot(lastLow) : null,
    firstReclaim: firstReclaim ? serializePivot(firstReclaim) : null,
    secondReclaim: secondReclaim ? serializePivot(secondReclaim) : null,
    thirdReclaim: thirdReclaim ? serializePivot(thirdReclaim) : null,
    targets: targets.map(serializeTarget),
    breakoutTarget: breakoutTarget ? serializeTarget(breakoutTarget) : null,
    distanceToFirstReclaimPct: nearBreakoutPct,
    chart: compactChartData(trackingHistory),
    pivots: {
      lows: pivots.lows.slice(-5).map(serializePivot),
      highs: pivots.highs.slice(-5).map(serializePivot),
      targetLows: targetLows.slice(-8).map(serializePivot),
      targetPeaks: targetPeaks.slice(-8).map(serializePivot)
    },
    reason: signalReason({ stage, lastLow, targets, breakoutTarget, isNewHigh })
  };
}

export function detectPivots(history, window = DEFAULT_PIVOT_WINDOW, minSwingPct = DEFAULT_MIN_SWING_PCT) {
  const highs = [];
  const lows = [];

  for (let index = window; index < history.length - window; index += 1) {
    const bar = history[index];
    const slice = history.slice(index - window, index + window + 1);
    const isHigh = bar.close >= Math.max(...slice.map((row) => row.close));
    const isLow = bar.close <= Math.min(...slice.map((row) => row.close));
    if (isHigh) appendPivot(highs, { type: "high", index, date: bar.date, price: rounded(bar.close, 4) }, minSwingPct);
    if (isLow) appendPivot(lows, { type: "low", index, date: bar.date, price: rounded(bar.close, 4) }, minSwingPct);
  }

  return { highs, lows };
}

function detectLocalHighs(history, window = TARGET_PEAK_WINDOW) {
  const highs = [];
  for (let index = window; index < history.length - window; index += 1) {
    const bar = history[index];
    const before = history.slice(index - window, index);
    const after = history.slice(index + 1, index + window + 1);
    const isLocalHigh =
      before.every((row) => Number(bar.close) >= Number(row.close)) &&
      after.every((row) => Number(bar.close) > Number(row.close));
    if (isLocalHigh) {
      highs.push({
        type: "high",
        index,
        date: bar.date,
        price: rounded(bar.close, 4)
      });
    }
  }
  return highs;
}

function detectLocalLows(history, window = TARGET_PEAK_WINDOW) {
  const lows = [];
  for (let index = window; index < history.length - window; index += 1) {
    const bar = history[index];
    const before = history.slice(index - window, index);
    const after = history.slice(index + 1, index + window + 1);
    const isLocalLow =
      before.every((row) => Number(bar.close) <= Number(row.close)) &&
      after.every((row) => Number(bar.close) < Number(row.close));
    if (isLocalLow) {
      lows.push({
        type: "low",
        index,
        date: bar.date,
        price: rounded(bar.close, 4)
      });
    }
  }
  return lows;
}

function resolveCurrentBottom(history) {
  const startIndex = Math.max(0, history.length - BOTTOM_LOOKBACK_TRADING_DAYS);
  return history.slice(startIndex).reduce((low, bar, offset) => {
    const close = Number(bar.close);
    if (!Number.isFinite(close)) return low;
    if (!low || close <= Number(low.price)) {
      return {
        type: "low",
        index: startIndex + offset,
        date: bar.date,
        price: rounded(close, 4)
      };
    }
    return low;
  }, null);
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

function buildReclaimTargets(history, lastLow) {
  if (!lastLow) return [];
  const targets = [];
  let cursorIndex = lastLow.index;
  let minimumPrice = 0;

  while (targets.length < 3) {
    const next = findNearestPriorHigh(history, cursorIndex, minimumPrice);
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

function findNearestPriorHigh(history, cursorIndex, minimumPrice) {
  for (let index = cursorIndex - 1; index >= 0; index -= 1) {
    const close = Number(history[index]?.close);
    if (!Number.isFinite(close) || close <= minimumPrice) continue;
    if (isTurningHigh(history, index)) {
      return {
        type: "high",
        index,
        date: history[index].date,
        price: rounded(close, 4)
      };
    }
  }
  return null;
}

function isTurningHigh(history, index) {
  const close = Number(history[index]?.close);
  const previous = Number(history[index - 1]?.close);
  const next = Number(history[index + 1]?.close);
  const higherThanPrevious = !Number.isFinite(previous) || close >= previous;
  const higherThanNext = !Number.isFinite(next) || close > next;
  return Number.isFinite(close) && higherThanPrevious && higherThanNext;
}

function buildBreakoutTarget(history, latestDate) {
  const priorBars = history.filter((bar) => bar.date !== latestDate);
  if (!priorBars.length) return null;
  const best = priorBars.reduce((peak, bar, index) => {
    if (!peak || Number(bar.close) > Number(peak.price)) {
      return {
        type: "high",
        index,
        date: bar.date,
        price: rounded(bar.close, 4),
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

function signalReason({ stage, lastLow, targets, breakoutTarget, isNewHigh }) {
  const parts = [];
  if (lastLow) parts.push(`bottom ${lastLow.date} @ ${lastLow.price}`);
  targets.forEach((target) => parts.push(`${target.targetNumber}차 ${target.date} @ ${target.price}`));
  if (breakoutTarget) parts.push(`breakout ${breakoutTarget.date} @ ${breakoutTarget.price}`);
  if (isNewHigh) parts.push("prior peak reached");
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
  return history.slice(-TRACKING_TRADING_DAYS).map((bar) => ({
    date: bar.date,
    open: rounded(bar.open, 4),
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
