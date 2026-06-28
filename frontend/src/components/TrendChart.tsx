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
      grid: { left: 52, right: 24, top: 32, bottom: 74 },
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
          height: 32,
          bottom: 12,
          backgroundColor: '#f1f5f9',
          borderColor: '#cbd5e1',
          borderRadius: 8,
          fillerColor: 'rgba(37, 99, 235, 0.18)',
          handleIcon: 'path://M10.7,0C4.8,0,0,4.8,0,10.7s4.8,10.7,10.7,10.7s10.7-4.8,10.7-10.7S16.6,0,10.7,0z M10.7,17.9c-4,0-7.2-3.2-7.2-7.2c0-4,3.2-7.2,7.2-7.2c4,0,7.2,3.2,7.2,7.2C17.9,14.7,14.7,17.9,10.7,17.9z',
          handleSize: '100%',
          handleStyle: {
            color: '#2563eb',
            borderColor: '#ffffff',
            borderWidth: 2,
            shadowBlur: 6,
            shadowColor: 'rgba(37, 99, 235, 0.35)',
            shadowOffsetY: 2,
          },
          moveHandleSize: 7,
          moveHandleStyle: {
            color: '#3b82f6',
          },
          selectedDataBackground: {
            lineStyle: { color: '#2563eb', width: 2 },
            areaStyle: { color: 'rgba(37, 99, 235, 0.25)' },
          },
          dataBackground: {
            lineStyle: { color: '#94a3b8', width: 1 },
            areaStyle: { color: 'rgba(148, 163, 184, 0.1)' },
          },
          textStyle: { color: '#475569', fontSize: 11, fontWeight: 'bold' },
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
