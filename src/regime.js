import { average, clamp, rounded, weightedAverage } from "./utils.js";

export function buildMarketRegimeAssessment(profile, marketData, previousRegime = null) {
  const benchmarks = profile.regimeBenchmarks
    .map((config) => buildRegimeBenchmark(config, marketData))
    .filter(Boolean);
  const macroSignals = profile.macroSignals
    .map((config) => buildMacroSignal(config, marketData))
    .filter(Boolean);

  const technicalScore = weightedAverage(
    benchmarks.map((row) => ({ value: row.score, weight: row.weight })),
    50
  );
  const macroScore = weightedAverage(macroSignals.map((row) => ({ value: row.score, weight: 1 })), 50);
  const finalScore = rounded(technicalScore * 0.65 + macroScore * 0.35);
  const label = marketRegimeLabel(finalScore, benchmarks, macroScore);

  return {
    market: profile.id,
    label,
    score: finalScore,
    actionBias: marketRegimeActionBias(label),
    conclusion: marketRegimeConclusion(label, technicalScore, macroScore),
    change: marketRegimeChange({ label, score: finalScore }, previousRegime),
    technical: {
      score: rounded(technicalScore),
      label: technicalRegimeLabel(technicalScore),
      benchmarks
    },
    macro: {
      score: rounded(macroScore),
      label: macroRegimeLabel(macroScore),
      signals: macroSignals
    },
    coverage: {
      technical: benchmarks.filter((row) => row.dataStatus === "ok").length,
      technicalTotal: benchmarks.length,
      macro: macroSignals.filter((row) => row.dataStatus === "ok").length,
      macroTotal: macroSignals.length
    },
    weights: { technical: 0.65, macro: 0.35 }
  };
}

function buildRegimeBenchmark(config, marketData) {
  const primary = marketData[config.ticker];
  const fallback = config.fallbackTicker ? marketData[config.fallbackTicker] : null;
  const market = primary?.dataStatus === "ok" ? primary : fallback;

  if (!market || market.dataStatus !== "ok") {
    return {
      ticker: config.ticker,
      label: config.label || config.ticker,
      fallbackTicker: config.fallbackTicker,
      weight: Number(config.weight || 1),
      dataStatus: "missing",
      score: 50,
      reason: "Index data unavailable"
    };
  }

  const stats = regimeMarketStats(market);
  const trendScore =
    (stats.aboveMa50 ? 16 : -10) +
    (stats.aboveMa200 ? 20 : -18) +
    clamp(Number(market.return20dPct || 0) * 1.1, -12, 14) +
    clamp(Number(stats.return60dPct || 0) * 0.65, -14, 16) +
    clamp((Number(market.drawdownFrom52wHighPct || -20) + 12) * 1.4, -14, 14) +
    (Number(market.return5dPct || 0) > 0 ? 5 : -4);
  const score = rounded(clamp(50 + trendScore, 0, 100));

  return {
    ticker: market.ticker || config.ticker,
    sourceTicker: config.ticker,
    label: config.label || config.ticker,
    fallbackTicker: config.fallbackTicker,
    usingFallback: market.ticker === config.fallbackTicker || primary?.dataStatus !== "ok",
    weight: Number(config.weight || 1),
    dataStatus: "ok",
    dataFreshness: market.dataFreshness,
    score,
    lastClose: market.lastClose,
    dataDate: market.dataDate,
    dailyChangePct: market.dailyChangePct,
    return5dPct: market.return5dPct,
    return20dPct: market.return20dPct,
    return60dPct: stats.return60dPct,
    drawdownFrom52wHighPct: market.drawdownFrom52wHighPct,
    ma50: stats.ma50,
    ma200: stats.ma200,
    aboveMa50: stats.aboveMa50,
    aboveMa200: stats.aboveMa200,
    reason: benchmarkRegimeReason(market, stats, score)
  };
}

function buildMacroSignal(config, marketData) {
  const market = marketData[config.ticker];
  if (!market || market.dataStatus !== "ok") {
    return {
      ticker: config.ticker,
      label: config.label || config.ticker,
      type: config.type || "macro",
      riskOnWhen: config.riskOnWhen || "up",
      dataStatus: "missing",
      score: 50,
      reason: "Macro data unavailable"
    };
  }

  const direction = config.riskOnWhen === "neutral" ? 0 : config.riskOnWhen === "down" ? -1 : 1;
  const score = rounded(
    clamp(50 + direction * Number(market.return20dPct || 0) * 1.6 + direction * Number(market.return5dPct || 0) * 0.8, 0, 100)
  );

  return {
    ticker: market.ticker || config.ticker,
    label: config.label || config.ticker,
    type: config.type || "macro",
    riskOnWhen: config.riskOnWhen || "up",
    dataStatus: "ok",
    dataFreshness: market.dataFreshness,
    score,
    dataDate: market.dataDate,
    return5dPct: market.return5dPct,
    return20dPct: market.return20dPct,
    reason: macroSignalReason(config, market, score)
  };
}

function regimeMarketStats(market) {
  const closes = (market.history || []).map((bar) => Number(bar.close)).filter(Number.isFinite);
  const last = Number(market.lastClose ?? closes.at(-1));
  const close60 = closes.length >= 61 ? closes.at(-61) : null;
  const ma50 = closes.length >= 50 ? average(closes.slice(-50)) : null;
  const ma200 = closes.length >= 200 ? average(closes.slice(-200)) : null;

  return {
    return60dPct: close60 ? rounded(((last - close60) / close60) * 100) : market.return60dPct,
    ma50: ma50 === null ? null : rounded(ma50, 2),
    ma200: ma200 === null ? null : rounded(ma200, 2),
    aboveMa50: ma50 !== null ? last >= ma50 : Number(market.return20dPct || 0) >= 0,
    aboveMa200: ma200 !== null ? last >= ma200 : Number(market.drawdownFrom52wHighPct || -100) >= -12
  };
}

function marketRegimeLabel(score, benchmarks = [], macroScore = 50) {
  const validBenchmarks = benchmarks.filter((row) => row.dataStatus === "ok");
  const hasBenchmarks = validBenchmarks.length > 0;
  const allAboveMa50 = hasBenchmarks && validBenchmarks.every((row) => row.aboveMa50);
  const allAboveMa200 = hasBenchmarks && validBenchmarks.every((row) => row.aboveMa200);
  const allPositive20d = hasBenchmarks && validBenchmarks.every((row) => Number(row.return20dPct) > 0);
  const mostlyPositive60d =
    hasBenchmarks &&
    validBenchmarks.filter((row) => Number(row.return60dPct) > 0).length >= Math.ceil(validBenchmarks.length / 2);
  const longTermTrendAlive = hasBenchmarks && validBenchmarks.filter((row) => row.aboveMa200).length >= Math.ceil(validBenchmarks.length / 2);
  const shortTermStalling =
    hasBenchmarks &&
    validBenchmarks.some((row) => !row.aboveMa50 || Number(row.return20dPct) <= 0 || Number(row.return5dPct) <= 0);

  if (score >= 70 && allAboveMa50 && allAboveMa200 && allPositive20d && mostlyPositive60d && macroScore >= 52) {
    return "강세장";
  }
  if (score >= 60 && longTermTrendAlive && (shortTermStalling || macroScore < 52)) return "기간 조정";
  if (score >= 55) return "중립-상승";
  if (score >= 40) return "중립";
  if (score >= 25) return "중립-하락";
  return "약세장";
}

function technicalRegimeLabel(score) {
  if (score >= 70) return "상승 추세 우위";
  if (score >= 55) return "상승 추세 유지";
  if (score >= 40) return "방향성 중립";
  if (score >= 25) return "하락 압력 우위";
  return "하락 추세";
}

function macroRegimeLabel(score) {
  if (score >= 65) return "매크로 우호";
  if (score >= 52) return "매크로 중립-우호";
  if (score >= 45) return "매크로 중립";
  if (score >= 35) return "매크로 부담";
  return "매크로 위험";
}

function marketRegimeActionBias(label) {
  if (label === "강세장") return "상승 추세 우위";
  if (label === "기간 조정") return "추격 보류, 돌파 확인";
  if (label === "중립-상승") return "선별 매수 우위";
  if (label === "중립") return "방향성 확인";
  if (label === "중립-하락") return "반등 확인 우선";
  return "신규 매수 보류";
}

function marketRegimeConclusion(label, technicalScore, macroScore) {
  const tech = rounded(technicalScore);
  const macro = rounded(macroScore);
  if (label === "강세장") return `주요 지수가 단기·장기 추세를 모두 유지하고 있다. 기술 ${tech}점, 매크로 ${macro}점.`;
  if (label === "기간 조정") return `장기 추세는 유지되지만 단기 추세가 둔화되어 기간 조정으로 본다. 기술 ${tech}점, 매크로 ${macro}점.`;
  if (label === "중립-상승") return `상승 우위지만 추격보다 종목별 돌파 확인이 필요하다. 기술 ${tech}점, 매크로 ${macro}점.`;
  if (label === "중립") return `시장 방향성이 중립이다. 종목별 트리거와 현금 비중을 함께 확인한다.`;
  if (label === "중립-하락") return `시장 국면이 방어 쪽으로 기울었다. 반등 확인 전까지 매수 속도를 낮춘다.`;
  return `시장 국면이 약세장이다. 현금 우위와 개별 종목 회복 신호 확인이 우선이다.`;
}

function marketRegimeChange(current, previous) {
  if (!previous?.label) return { status: "new", summary: "No previous regime snapshot." };
  const delta = rounded(Number(current.score) - Number(previous.score));
  if (current.label !== previous.label) {
    return { status: "changed", scoreDelta: delta, summary: `${previous.label} -> ${current.label}` };
  }
  return { status: "unchanged", scoreDelta: delta, summary: `${current.label} maintained (${delta > 0 ? "+" : ""}${delta} pts).` };
}

function benchmarkRegimeReason(market, stats, score) {
  const ma50 = stats.aboveMa50 ? "above MA50" : "below MA50";
  const ma200 = stats.aboveMa200 ? "above MA200" : "below MA200";
  return `${ma50}, ${ma200}, 20d ${market.return20dPct ?? "n/a"}%, score ${score}`;
}

function macroSignalReason(config, market, score) {
  const directionText = config.riskOnWhen === "down" ? "lower is risk-on" : config.riskOnWhen === "up" ? "higher is risk-on" : "context signal";
  return `${directionText}; 20d ${market.return20dPct ?? "n/a"}%, 5d ${market.return5dPct ?? "n/a"}%, score ${score}`;
}
