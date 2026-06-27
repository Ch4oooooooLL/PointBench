import * as echarts from 'echarts';
import { useEffect, useRef } from 'react';
import { TrendItem } from '../types';

interface Props {
  data: TrendItem[];
  metric: 'max_strain_ue' | 'min_strain_ue' | 'amplitude_strain_ue' | 'stress_amplitude_mpa';
}

const labels: Record<Props['metric'], string> = {
  max_strain_ue: '最大应变 ue',
  min_strain_ue: '最小应变 ue',
  amplitude_strain_ue: '应变幅 ue',
  stress_amplitude_mpa: '应力幅 MPa',
};

export function TrendChart({ data, metric }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hasData = data.some((item) => item[metric] != null);

  useEffect(() => {
    if (!ref.current || !hasData) return;
    const chart = echarts.init(ref.current);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 52, right: 24, top: 32, bottom: 42 },
      xAxis: { type: 'category', data: data.map((item) => item.cycle_count) },
      yAxis: { type: 'value', name: labels[metric] },
      series: [
        {
          type: 'line',
          smooth: true,
          symbolSize: 9,
          data: data.map((item) => item[metric] ?? null),
          markPoint: {
            data: data
              .map((item, index) => ({ item, index }))
              .filter(({ item }) => item.is_abnormal && item[metric] != null)
              .map(({ item, index }) => ({ name: '异常', coord: [index, item[metric] ?? 0], value: '异常' })),
          },
        },
      ],
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [data, metric, hasData]);

  if (!hasData) return <div className="empty chart-empty">暂无趋势数据</div>;
  return <div className="chart" ref={ref} />;
}
