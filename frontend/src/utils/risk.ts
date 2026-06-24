import { RiskSettings } from '../context/AppContext';

export type RiskLevel = 'normal' | 'warn' | 'danger' | 'critical';

export function growthPercent(current?: number | null, initial?: number | null): number | null {
  if (current == null || initial == null) return null;
  if (initial === 0) return current === 0 ? 0 : 100;
  return ((current - initial) / Math.abs(initial)) * 100;
}

export function riskLevel(percent: number | null, settings: RiskSettings): RiskLevel {
  if (percent == null || percent < settings.warnPercent) return 'normal';
  if (percent >= settings.criticalPercent) return 'critical';
  if (percent >= settings.dangerPercent) return 'danger';
  return 'warn';
}

export function riskLabel(level: RiskLevel): string {
  if (level === 'critical') return '严重';
  if (level === 'danger') return '危险';
  if (level === 'warn') return '预警';
  return '正常';
}

export function riskPercentText(percent: number | null): string {
  if (percent == null) return '-';
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`;
}
