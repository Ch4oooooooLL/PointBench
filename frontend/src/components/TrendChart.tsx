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
    const chartDom = ref.current;
    const chart = echarts.init(chartDom);
    chart.setOption({
      tooltip: { trigger: 'axis' },
      grid: { left: 52, right: 24, top: 32, bottom: 62 },
      xAxis: { type: 'category', data: data.map((item) => item.cycle_count) },
      yAxis: { type: 'value', name: labels[metric] },
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          zoomOnMouseWheel: 'ctrl',
          moveOnMouseWheel: 'shift',
          moveOnMouseMove: true,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          height: 24,
          bottom: 8,
          borderColor: '#e2e8f0',
          fillerColor: 'rgba(15,118,110,0.08)',
          handleStyle: { color: '#0f766e' },
          textStyle: { fontSize: 10 },
        },
      ],
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

    // 滚轮事件：无修饰键时不劫持滚动
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.stopPropagation();
      }
    };
    chartDom.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      chartDom.removeEventListener('wheel', handleWheel, { capture: true });
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [data, metric, hasData]);

  if (!hasData) return <div className="empty chart-empty">暂无趋势数据</div>;
  return (
    <div>
      <div className="chart" ref={ref} />
      <div className="chart-zoom-hint">
        <span>Ctrl+滚轮 横向缩放</span>
        <span className="hint-sep">|</span>
        <span>Shift+滚轮 左右平移</span>
        <span className="hint-sep">|</span>
        <span>拖拽滑块 选择区间</span>
      </div>
    </div>
  );
}
