import * as echarts from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CrackRecord, Point, TrendItem } from '../types';

export interface PointTrend {
  point: Point;
  trend: TrendItem[];
}

interface Props {
  trends: PointTrend[];
  height?: number;
  expandedHeight?: number;
  expandable?: boolean;
  crackRecords?: CrackRecord[];
  onCrackSelect?: (record: CrackRecord) => void;
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

interface CrackPointData {
  name: string;
  value: [number, number];
  crackRecordId: number;
}

function colorForIndex(index: number): string {
  return palette[index % palette.length];
}

function isCrackPointData(value: CrackPointData | null): value is CrackPointData {
  return value !== null;
}

function buildCrackData(trends: PointTrend[], crackRecords: CrackRecord[]): CrackPointData[] {
  return crackRecords
    .map((record) => {
      const pointTrend = trends.find((item) => item.point.id === record.point_db_id);
      const trend = pointTrend?.trend.find(
        (item) => item.cycle_count === record.cycle_count && item.stress_amplitude_mpa != null,
      );
      if (!trend || trend.stress_amplitude_mpa == null) return null;
      return {
        name: `${record.point_id} 裂纹`,
        value: [record.cycle_count, trend.stress_amplitude_mpa],
        crackRecordId: record.id,
      };
    })
    .filter(isCrackPointData);
}

function buildOption(trends: PointTrend[], focusPointId: number | null, crackRecords: CrackRecord[]) {
  return {
    color: palette,
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: number) => `${Number(value).toFixed(2)} MPa`,
    },
    grid: { left: 58, right: 24, top: 24, bottom: 42 },
    xAxis: { type: 'value', name: '循环次数' },
    yAxis: { type: 'value', name: '应力幅 MPa' },
    series: [
      ...trends.map(({ point, trend }, index) => {
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
      {
        name: '裂纹记录',
        type: 'scatter',
        symbol: 'circle',
        symbolSize: 18,
        z: 8,
        itemStyle: {
          color: 'rgba(255,255,255,0.08)',
          borderColor: '#dc2626',
          borderWidth: 3,
        },
        emphasis: {
          itemStyle: {
            color: 'rgba(220,38,38,0.12)',
            borderColor: '#b91c1c',
            borderWidth: 4,
          },
        },
        data: buildCrackData(trends, crackRecords),
      },
    ],
  };
}

function ChartCanvas({
  trends,
  height,
  focusPointId,
  crackRecords,
  onCrackSelect,
  onChartClick,
}: {
  trends: PointTrend[];
  height: number;
  focusPointId: number | null;
  crackRecords: CrackRecord[];
  onCrackSelect?: (record: CrackRecord) => void;
  onChartClick?: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    chart.setOption(buildOption(trends, focusPointId, crackRecords), true);
    chart.on('click', (params) => {
      const data = params.data as { crackRecordId?: number } | undefined;
      const crackRecord = crackRecords.find((record) => record.id === data?.crackRecordId);
      if (crackRecord) onCrackSelect?.(crackRecord);
      else onChartClick?.();
    });
    chart.getZr().on('click', (event) => {
      if (!event.target) onChartClick?.();
    });
    const resize = () => chart.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.dispose();
    };
  }, [trends, focusPointId, crackRecords, onCrackSelect, onChartClick]);

  return <div className="chart multi-chart" style={{ height }} ref={ref} />;
}

function SideLegend({
  trends,
  focusPointId,
  onFocus,
  maxHeight,
  interactive = false,
}: {
  trends: PointTrend[];
  focusPointId: number | null;
  onFocus?: (pointId: number | null) => void;
  maxHeight: number;
  interactive?: boolean;
}) {
  return (
    <div className="side-legend" aria-label="点位标注" style={{ maxHeight }}>
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

export function MultiPointTrendChart({
  trends,
  height = 520,
  expandedHeight = 660,
  expandable = true,
  crackRecords = [],
  onCrackSelect,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [focusPointId, setFocusPointId] = useState<number | null>(null);
  const availableTrends = useMemo(() => trends.filter((item) => item.trend.length), [trends]);

  if (!availableTrends.length) {
    return <div className="empty chart-empty">暂无趋势数据</div>;
  }

  return (
    <>
      <div className={expandable ? 'trend-chart-layout clickable' : 'trend-chart-layout'}>
        <div
          className="chart-click-layer"
          role={expandable ? 'button' : undefined}
          tabIndex={expandable ? 0 : undefined}
          onKeyDown={(event) => {
            if (expandable && (event.key === 'Enter' || event.key === ' ')) setExpanded(true);
          }}
          title={expandable ? '点击放大图表' : undefined}
        >
          <ChartCanvas
            trends={availableTrends}
            height={height}
            focusPointId={null}
            crackRecords={crackRecords}
            onCrackSelect={onCrackSelect}
            onChartClick={expandable ? () => setExpanded(true) : undefined}
          />
        </div>
        <SideLegend trends={availableTrends} focusPointId={null} maxHeight={height} />
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
              <ChartCanvas
                trends={availableTrends}
                height={expandedHeight}
                focusPointId={focusPointId}
                crackRecords={crackRecords}
                onCrackSelect={onCrackSelect}
              />
              <SideLegend
                trends={availableTrends}
                focusPointId={focusPointId}
                onFocus={setFocusPointId}
                maxHeight={expandedHeight}
                interactive
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
