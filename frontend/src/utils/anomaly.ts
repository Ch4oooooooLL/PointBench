import { TrendItem } from '../types';

export interface TrendAnomaly {
  index: number;
  item: TrendItem;
  baseline: TrendItem;
  deltaMpa: number;
  reason: string;
}

function formatRange(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

export function getTrendAnomalies(trend: TrendItem[], rangeMpa: number): TrendAnomaly[] {
  const range = Math.max(0, rangeMpa);
  const valid = trend
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.stress_amplitude_mpa != null)
    .sort((left, right) => {
      const cycleDiff = left.item.cycle_count - right.item.cycle_count;
      if (cycleDiff !== 0) return cycleDiff;
      return left.item.run_id - right.item.run_id;
    });

  const baseline = valid[0]?.item;
  const initialStress = baseline?.stress_amplitude_mpa;
  if (baseline == null || initialStress == null) return [];

  const anomalies: TrendAnomaly[] = [];
  for (let index = 1; index < valid.length; index += 1) {
    const current = valid[index].item;
    const currentStress = current.stress_amplitude_mpa as number;
    const deltaMpa = currentStress - initialStress;
    if (Math.abs(deltaMpa) > range) {
      const direction = deltaMpa >= 0 ? '大于' : '小于';
      anomalies.push({
        index: valid[index].index,
        item: current,
        baseline,
        deltaMpa,
        reason: `应力幅${direction}初始值 ${formatRange(Math.abs(deltaMpa))} MPa，超过设置范围 ${formatRange(range)} MPa`,
      });
    }
  }
  return anomalies;
}

export function hasTrendAnomaly(trend: TrendItem[], rangeMpa: number): boolean {
  return getTrendAnomalies(trend, rangeMpa).length > 0;
}

export function getTrendAnomalyIndexSet(trend: TrendItem[], rangeMpa: number): Set<number> {
  return new Set(getTrendAnomalies(trend, rangeMpa).map((item) => item.index));
}
