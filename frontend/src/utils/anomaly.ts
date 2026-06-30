import { TrendItem } from '../types';

export interface TrendAnomaly {
  index: number;
  item: TrendItem;
  previous: TrendItem;
  changeRatio: number;
  reason: string;
}

function formatThreshold(thresholdPercent: number): string {
  return Number.isInteger(thresholdPercent) ? String(thresholdPercent) : thresholdPercent.toFixed(1).replace(/\.0$/, '');
}

function thresholdRatio(thresholdPercent: number): number {
  return Math.max(0, thresholdPercent) / 100;
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

  const anomalies: TrendAnomaly[] = [];
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1].item;
    const current = valid[index].item;
    const previousAmplitude = previous.amplitude_strain_ue as number;
    const currentAmplitude = current.amplitude_strain_ue as number;
    if (previousAmplitude === 0) continue;

    const changeRatio = Math.abs(currentAmplitude - previousAmplitude) / Math.abs(previousAmplitude);
    if (changeRatio > threshold) {
      anomalies.push({
        index: valid[index].index,
        item: current,
        previous,
        changeRatio,
        reason: `应变幅相对上一轮变化超过 ${formatThreshold(thresholdPercent)}%`,
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
