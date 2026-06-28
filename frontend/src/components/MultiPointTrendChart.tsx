import * as echarts from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
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
  loading?: boolean;
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
        value: [record.cycle_count, trend.stress_amplitude_mpa] as [number, number],
        crackRecordId: record.id,
      };
    })
    .filter(isCrackPointData);
}

function buildOption(
  trends: PointTrend[],
  focusPointId: number | null,
  crackRecords: CrackRecord[],
  onPointClick?: (pointId: number) => void,
) {
  const cracksByPoint: Record<number, CrackRecord[]> = {};
  for (const record of crackRecords) {
    if (!cracksByPoint[record.point_db_id]) cracksByPoint[record.point_db_id] = [];
    cracksByPoint[record.point_db_id].push(record);
  }
  // 为每条折线预留前两张照片的 media ID 列表
  const pointMediaIds: number[] = [];
  for (const { point } of trends) {
    const firstTwo = point.media_files?.slice(0, 2).map((m) => m.id) ?? [];
    pointMediaIds.push(firstTwo.length);
  }

  return {
    color: palette,
    tooltip: {
      trigger: 'item',
      appendToBody: true,
      confine: true,
      extraCssText: 'max-width: 280px; white-space: normal;',
      formatter: (rawParams: unknown) => {
        const p = rawParams as {
          seriesIndex: number;
          seriesName: string;
          value: [number, number];
          color: string;
          data?: { crackRecordId?: number; pointDbId?: number };
        } | null;
        if (!p) return '';

        // 裂纹散点系列：seriesIndex === trends.length
        if (p.seriesIndex === trends.length && p.data?.crackRecordId) {
          const record = crackRecords.find((r) => r.id === p.data!.crackRecordId);
          if (record) return `<div style="padding:4px;font-size:12px"><b>${record.point_id}</b> 裂纹 · ${record.cycle_count} 次<br/>${record.remark ?? ''}</div>`;
          return '';
        }

        // 折线数据点：seriesIndex < trends.length
        if (p.seriesIndex >= trends.length) return '';
        const pt = trends[p.seriesIndex];
        if (!pt) return '';
        const point = pt.point;
        const cracks = cracksByPoint[point.id] ?? [];
        const photos = point.media_files?.slice(0, 2) ?? [];
        const cycleCount = p.value?.[0] ?? '-';
        const stress = p.value?.[1] != null ? `${Number(p.value[1]).toFixed(2)} MPa` : '-';

        let photoHtml = '';
        if (photos.length) {
          photoHtml = `<div style="display:flex;gap:4px;margin-top:6px">${photos
            .map((m) => `<img src="/api/media/${m.id}" style="width:64px;height:48px;object-fit:cover;border-radius:4px;border:1px solid #e2e8f0" />`)
            .join('')}</div>`;
        }

        const crackBadge = cracks.length
          ? `<span style="display:inline-block;background:#fef2f2;color:#dc2626;border-radius:3px;padding:0 4px;font-size:11px;margin-left:6px">裂纹×${cracks.length}</span>`
          : '';

        const crackList = cracks.length
          ? `<div style="font-size:11px;color:#dc2626;margin-top:4px">裂纹记录: ${cracks.map((c) => `${c.cycle_count}次`).join(' · ')}</div>`
          : '';

        return `<div style="font-size:12px;line-height:1.5">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:4px">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0"></span>
            <b>${point.point_id}</b>
            <span style="color:#64748b;font-size:11px">${point.point_name}</span>
            ${crackBadge}
          </div>
          <div style="font-size:11px;color:#475569;margin:2px 0">
            循环次数: ${cycleCount} · 应力幅: ${stress}
          </div>
          ${point.component ? `<div style="font-size:11px;color:#64748b">部件: ${point.component}${point.side ? ' · ' + point.side : ''}${point.direction ? ' · ' + point.direction : ''}</div>` : ''}
          ${point.position_description ? `<div style="font-size:11px;color:#64748b">位置: ${point.position_description}</div>` : ''}
          ${crackList}
          ${photoHtml}
          <div style="color:#94a3b8;font-size:10px;margin-top:6px;text-align:center;border-top:1px solid #f1f5f9;padding-top:4px">🖱 点击跳转点位详情</div>
        </div>`;
      },
    },
    grid: { left: 58, right: 24, top: 24, bottom: 62 },
    xAxis: { type: 'value', name: '循环次数' },
    yAxis: { type: 'value', name: '应力幅 MPa' },
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
          // 在每个数据点附带 point_db_id，供点击事件使用
          data: trend
            .filter((item) => item.stress_amplitude_mpa != null)
            .map((item) => ({
              value: [item.cycle_count, item.stress_amplitude_mpa],
              pointDbId: point.id,
            })),
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
  onPointClick,
  loading,
}: {
  trends: PointTrend[];
  height: number;
  focusPointId: number | null;
  crackRecords: CrackRecord[];
  onCrackSelect?: (record: CrackRecord) => void;
  onChartClick?: () => void;
  onPointClick?: (pointId: number) => void;
  loading?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || loading) return;
    const chartDom = ref.current;
    const chart = echarts.init(chartDom);
    chart.setOption(buildOption(trends, focusPointId, crackRecords), true);

    // 点击事件：区分折线数据点、裂纹散点、空白区域
    chart.off('click');
    chart.on('click', (params) => {
      if (!params || !('seriesIndex' in params)) return;
      const seriesIndex = params.seriesIndex as number;
      // 裂纹散点系列排在最后
      if (seriesIndex === trends.length) {
        const data = params.data as { crackRecordId?: number } | undefined;
        const crackRecord = crackRecords.find((record) => record.id === data?.crackRecordId);
        if (crackRecord) onCrackSelect?.(crackRecord);
        return;
      }
      // 折线数据点 → 跳转点位详情
      if (seriesIndex < trends.length) {
        const data = params.data as { pointDbId?: number } | undefined;
        if (data?.pointDbId) onPointClick?.(data.pointDbId);
      }
    });

    // 空白区域点击 → 展开模态框
    chart.getZr().off('click');
    chart.getZr().on('click', (event: { target?: unknown }) => {
      if (!event.target) onChartClick?.();
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
  }, [trends, focusPointId, crackRecords, onCrackSelect, onChartClick, onPointClick, loading]);

  if (loading) {
    return (
      <div>
        <div className="chart chart-loading" style={{ height }}>
          <div className="chart-loading-spinner" />
          <span>趋势图加载中…</span>
        </div>
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

  return (
    <div>
      <div className="chart multi-chart" style={{ height }} ref={ref} />
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
  const navigate = useNavigate();

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
              if (interactive && !active) {
                onFocus?.(point.id);
              } else if (interactive && active) {
                onFocus?.(null);
              } else {
                navigate(`/points/${point.id}`);
              }
            }}
            title={interactive ? '点击突出折线 · 再次点击跳转详情' : '点击跳转点位详情'}
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
  loading = false,
}: Props) {
  const { chartSettings } = useAppContext();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);
  const [focusPointId, setFocusPointId] = useState<number | null>(null);
  const availableTrends = useMemo(() => trends.filter((item) => item.trend.length), [trends]);

  const handlePointClick = (pointId: number) => {
    navigate(`/points/${pointId}`);
  };

  // 加载中状态
  if (loading) {
    return (
      <div>
        <div className="chart chart-loading" style={{ height }}>
          <div className="chart-loading-spinner" />
          <span>趋势数据加载中…</span>
        </div>
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
          title={expandable ? '点击空白区域放大图表 · 点击曲线跳转点位详情' : '点击曲线跳转点位详情'}
        >
          <ChartCanvas
            trends={availableTrends}
            height={height}
            focusPointId={null}
            crackRecords={crackRecords}
            onCrackSelect={onCrackSelect}
            onPointClick={handlePointClick}
            onChartClick={expandable ? () => setExpanded(true) : undefined}
          />
        </div>
        <SideLegend trends={availableTrends} focusPointId={null} maxHeight={height} />
      </div>

      {expanded && (
        <div className="modal-backdrop" onClick={() => setExpanded(false)}>
          <div className="modal chart-modal" onClick={(event) => event.stopPropagation()} style={{ width: `min(${chartSettings.expandedChartWidth}px, 98vw)` }}>
            <div className="section-head">
              <div>
                <h2>全项目点位应力趋势</h2>
                <p>Ctrl+滚轮缩放 · Shift+滚轮平移 · 拖拽下方滑块选取区间 · 点击曲线跳转点位详情 · 点击右侧标注突出折线</p>
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
                onPointClick={handlePointClick}
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
