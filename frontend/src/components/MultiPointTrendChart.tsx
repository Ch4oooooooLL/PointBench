import * as echarts from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Point, TrendItem } from '../types';

export interface PointTrend {
  point: Point;
  trend: TrendItem[];
}

interface Props {
  trends: PointTrend[];
  height?: number;
  expandable?: boolean;
}

const palette = [
  '#0f766e',
  '#2563eb',
  '#d97706',
  '#dc2626',
  '#7c3aed',
  '#059669',
  '#c026d3',
  '#475569',
  '#ea580c',
  '#0891b2',
  '#be123c',
  '#0d9488',
  '#9333ea',
  '#65a30d',
  '#0284c7',
];

function colorForIndex(index: number): string {
  return palette[index % palette.length];
}

function buildOption(trends: PointTrend[], focusPointId: number | null) {
  return {
    color: palette,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => `${Number(value).toFixed(2)} MPa`,
    },
    grid: { left: 58, right: 24, top: 24, bottom: 42 },
    xAxis: { type: 'value', name: '循环次数' },
    yAxis: { type: 'value', name: '应力幅 MPa' },
    series: trends.map(({ point, trend }, index) => {
      const focused = focusPointId == null || focusPointId === point.id;
      return {
        name: `${point.point_id} ${point.point_name}`,
        type: 'line',
        smooth: true,
        showSymbol: true,
        symbolSize: focused ? 8 : 5,
        lineStyle: { color: colorForIndex(index), width: focused ? 3 : 1.5, opacity: focused ? 1 : 0.14 },
        itemStyle: { color: colorForIndex(index), opacity: focused ? 1 : 0.22 },
        emphasis: { focus: 'series' },
        data: trend
          .filter((item) => item.stress_amplitude_mpa != null)
          .map((item) => [item.cycle_count, item.stress_amplitude_mpa]),
      };
    }),
  };
}

function ChartCanvas({
  trends,
  height,
  focusPointId,
}: {
  trends: PointTrend[];
  height: number;
  focusPointId: number | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(buildOption(trends, focusPointId), true);
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [trends, focusPointId]);

  return <div className="chart multi-chart" style={{ height }} ref={ref} />;
}

function SideLegend({
  trends,
  focusPointId,
  onFocus,
  interactive = false,
}: {
  trends: PointTrend[];
  focusPointId: number | null;
  onFocus?: (pointId: number | null) => void;
  interactive?: boolean;
}) {
  return (
    <div className="side-legend" aria-label="点位标注">
      {trends.map(({ point, trend }, index) => {
        const latest = [...trend].reverse().find((item) => item.stress_amplitude_mpa != null);
        const active = focusPointId === point.id;
        const dimmed = focusPointId != null && !active;
        return (
          <button
            key={point.id}
            className={`side-legend-item ${interactive ? 'interactive' : ''} ${active ? 'active' : ''} ${dimmed ? 'dimmed' : ''}`}
            type="button"
            onClick={() => {
              if (interactive) onFocus?.(active ? null : point.id);
            }}
            title={interactive ? '点击突出该点位折线' : undefined}
          >
            <span className="legend-dot" style={{ background: colorForIndex(index) }} />
            <span className="legend-text">
              <strong>{point.point_id}</strong>
              <small>{point.point_name}</small>
            </span>
            <span className="legend-value">{latest?.stress_amplitude_mpa?.toFixed(1) ?? '-'} MPa</span>
          </button>
        );
      })}
    </div>
  );
}

export function MultiPointTrendChart({ trends, height = 420, expandable = true }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [focusPointId, setFocusPointId] = useState<number | null>(null);
  const availableTrends = useMemo(() => trends.filter((item) => item.trend.length), [trends]);

  if (!availableTrends.length) {
    return <div className="empty chart-empty">暂无趋势数据</div>;
  }

  return (
    <>
      <div className={expandable ? 'trend-chart-layout clickable' : 'trend-chart-layout'}>
        <button
          className="chart-click-layer"
          type="button"
          disabled={!expandable}
          onClick={() => setExpanded(true)}
          title={expandable ? '点击放大图表' : undefined}
        >
          <ChartCanvas trends={availableTrends} height={height} focusPointId={null} />
        </button>
        <SideLegend trends={availableTrends} focusPointId={null} />
      </div>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal chart-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <div>
                <h2>全项目点位应力趋势</h2>
                <p>点击右侧标注可突出对应折线，再次点击取消突出；标注列表可上下滚动。</p>
              </div>
              <button className="button" onClick={() => setExpanded(false)}>关闭</button>
            </div>
            <div className="trend-chart-layout expanded">
              <ChartCanvas trends={availableTrends} height={560} focusPointId={focusPointId} />
              <SideLegend
                trends={availableTrends}
                focusPointId={focusPointId}
                onFocus={setFocusPointId}
                interactive
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
