import { TrendItem } from '../types';

export interface TrendAnomaly {
  index: number;
  item: TrendItem;
  baseline: TrendItem;
  changeRatio: number;
  reason: string;
}

function formatThreshold(thresholdPercent: number): string {
  return Number.isInteger(thresholdPercent) ? String(thresholdPercent) : thresholdPercent.toFixed(1).replace(/\.0$/, '');
}

function thresholdRatio(thresholdPercent: number): number {
  return Math.max(0, thresholdPercent) / 100;
}

function relativeChangeRatio(current: number, initial: number): number {
  if (initial === 0) {
    if (current === 0) return 0;
    return current > 0 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  }
  return (current - initial) / Math.abs(initial);
}

function formatChangePercent(changeRatio: number): string {
  if (!Number.isFinite(changeRatio)) return '无限大';
  return `${(Math.abs(changeRatio) * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function getTrendAnomalies(trend: TrendItem[], thresholdPercent: number): TrendAnomaly[] {
  const threshold = thresholdRatio(thresholdPercent);
  const valid = trend
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.amplitude_strain_ue != null)
    .sort((left, right) => {
      const cycleDiff = left.item.cycle_count - right.item.cycle_count;
      if (cycleDiff !== 0) return cycleDiff;
      return left.item.run_id - right.item.run_id;
    });

  const baseline = valid[0]?.item;
  const initialAmplitude = baseline?.amplitude_strain_ue;
  if (baseline == null || initialAmplitude == null) return [];

  const anomalies: TrendAnomaly[] = [];
  for (let index = 1; index < valid.length; index += 1) {
    const current = valid[index].item;
    const currentAmplitude = current.amplitude_strain_ue as number;
    const changeRatio = relativeChangeRatio(currentAmplitude, initialAmplitude);
    if (Math.abs(changeRatio) >= threshold) {
      const direction = changeRatio >= 0 ? '增大' : '减小';
      anomalies.push({
        index: valid[index].index,
        item: current,
        baseline,
        changeRatio,
        reason: `应变幅相对首次有效数据${direction} ${formatChangePercent(changeRatio)}，达到最低预警阈值 ${formatThreshold(thresholdPercent)}%`,
      });
    }
  }
  return anomalies;
}

export function hasTrendAnomaly(trend: TrendItem[], thresholdPercent: number): boolean {
  return getTrendAnomalies(trend, thresholdPercent).length > 0;
}

export function getTrendAnomalyIndexSet(trend: TrendItem[], thresholdPercent: number): Set<number> {
  return new Set(getTrendAnomalies(trend, thresholdPercent).map((item) => item.index));
}
