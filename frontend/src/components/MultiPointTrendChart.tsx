import * as echarts from 'echarts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { crackImageUrl, mediaUrl } from '../api/client';
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

interface ChartClickEvent {
  target?: unknown;
  offsetX?: number;
  offsetY?: number;
  zrX?: number;
  zrY?: number;
}

interface CrackHitTarget {
  record: CrackRecord;
  dataIndex: number;
  distance: number;
}

interface LineHitTarget {
  pointId: number;
  seriesIndex: number;
  dataIndex: number;
  distance: number;
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

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  return value == null || Number.isNaN(Number(value)) ? '-' : Number(value).toFixed(digits);
}

function formatCycleCount(trend: TrendItem[]): string {
  const cycles = trend.map((item) => item.cycle_count).filter((value) => Number.isFinite(value));
  return cycles.length ? String(Math.max(...cycles)) : '-';
}

function buildPointTooltip(pointTrend: PointTrend, cracks: CrackRecord[], color: string): string {
  const { point, trend } = pointTrend;
  const latest = [...trend].reverse().find((item) => item.stress_amplitude_mpa != null);
  const photos = point.media_files?.slice(0, 2) ?? [];
  const photoHtml = photos.length
    ? photos
        .map(
          (media) => `
            <img
              class="line-tooltip-image"
              src="${mediaUrl(media.id)}"
              alt="${escapeHtml(point.point_name)}"
            />`,
        )
        .join('')
    : '<div class="line-tooltip-empty">暂无图片</div>';

  return `
    <div class="line-tooltip-card" style="--line-color:${color}">
      <div class="line-tooltip-main">
        <div class="line-tooltip-title">
          <span>${escapeHtml(point.point_id)}</span>
          <strong>${escapeHtml(point.point_name)}</strong>
        </div>
        <div class="line-tooltip-meta">
          <span>最新循环 ${escapeHtml(formatCycleCount(trend))} 次</span>
          <span>测试记录 ${trend.length} 次</span>
          <span>裂纹 ${cracks.length} 条</span>
          <span>最新应力幅 ${formatNumber(latest?.stress_amplitude_mpa)} MPa</span>
        </div>
        <div class="line-tooltip-sub">
          ${escapeHtml([point.component, point.side, point.direction, point.bridge_type].filter(Boolean).join(' / ') || '未填写部件信息')}
        </div>
      </div>
      <div class="line-tooltip-images">${photoHtml}</div>
    </div>
  `;
}

function buildCrackTooltip(record: CrackRecord): string {
  return `
    <div class="line-tooltip-card crack-tooltip-card">
      <div class="crack-tooltip-copy">
        <b>${escapeHtml(record.point_id)}</b>
        <strong>${escapeHtml(record.point_name)}</strong>
        <span>裂纹 · ${record.cycle_count} 次</span>
        ${record.run_name ? `<span>${escapeHtml(record.run_name)}</span>` : ''}
        ${record.remark ? `<p>${escapeHtml(record.remark)}</p>` : ''}
      </div>
      <img class="crack-tooltip-image" src="${crackImageUrl(record.id)}" alt="${escapeHtml(record.point_id)} 裂纹图片" />
    </div>
  `;
}

function distanceBetween(left: [number, number], right: [number, number]): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function distanceToSegment(point: [number, number], start: [number, number], end: [number, number]): number {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetween(point, start);
  const t = Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared));
  return distanceBetween(point, [start[0] + t * dx, start[1] + t * dy]);
}

function valueToPixel(chart: echarts.ECharts, value: [number, number]): [number, number] | null {
  const pixel = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, value) as number[] | undefined;
  if (!pixel || pixel.length < 2 || !Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) return null;
  return [pixel[0], pixel[1]];
}

function findCrackHitTarget(
  chart: echarts.ECharts,
  trends: PointTrend[],
  crackRecords: CrackRecord[],
  clickPixel: [number, number],
  threshold = 18,
): CrackHitTarget | null {
  let best: CrackHitTarget | null = null;
  for (const [dataIndex, crack] of buildCrackData(trends, crackRecords).entries()) {
    const pixel = valueToPixel(chart, crack.value);
    if (!pixel) continue;
    const distance = distanceBetween(clickPixel, pixel);
    const record = crackRecords.find((item) => item.id === crack.crackRecordId);
    if (record && distance <= threshold && (!best || distance < best.distance)) {
      best = { record, dataIndex, distance };
    }
  }
  return best;
}

function findClickedCrack(
  chart: echarts.ECharts,
  trends: PointTrend[],
  crackRecords: CrackRecord[],
  clickPixel: [number, number],
): CrackRecord | null {
  return findCrackHitTarget(chart, trends, crackRecords, clickPixel)?.record ?? null;
}

function findLineHitTarget(chart: echarts.ECharts, trends: PointTrend[], clickPixel: [number, number], threshold = 12): LineHitTarget | null {
  let best: LineHitTarget | null = null;
  for (const [seriesIndex, { point, trend }] of trends.entries()) {
    const pixels = trend
      .filter((item) => item.stress_amplitude_mpa != null)
      .map((item) => valueToPixel(chart, [item.cycle_count, item.stress_amplitude_mpa as number]))
      .filter((pixel): pixel is [number, number] => pixel !== null);
    if (!pixels.length) continue;

    let distance = distanceBetween(clickPixel, pixels[0]);
    let dataIndex = 0;
    for (let index = 1; index < pixels.length; index += 1) {
      const segmentDistance = distanceToSegment(clickPixel, pixels[index - 1], pixels[index]);
      if (segmentDistance < distance) {
        distance = segmentDistance;
        dataIndex = distanceBetween(clickPixel, pixels[index - 1]) <= distanceBetween(clickPixel, pixels[index]) ? index - 1 : index;
      }
    }
    if (distance <= threshold && (!best || distance < best.distance)) {
      best = { pointId: point.id, seriesIndex, dataIndex, distance };
    }
  }
  return best;
}

function findClickedLinePointId(chart: echarts.ECharts, trends: PointTrend[], clickPixel: [number, number]): number | null {
  return findLineHitTarget(chart, trends, clickPixel)?.pointId ?? null;
}

function buildOption(
  trends: PointTrend[],
  focusPointId: number | null,
  crackRecords: CrackRecord[],
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
      triggerOn: 'mousemove',
      appendToBody: true,
      confine: true,
      hideDelay: 80,
      extraCssText: 'padding:0;border:0;background:transparent;box-shadow:0 18px 50px rgba(15,23,27,.24);max-width:min(520px,82vw);max-height:min(520px,72vh);white-space:normal;',
      formatter: (rawParams: unknown) => {
        const activeParam = (Array.isArray(rawParams) ? rawParams[0] : rawParams) as
          | {
              seriesIndex?: number;
              color?: string;
              data?: { crackRecordId?: number };
            }
          | undefined;
        if (!activeParam || typeof activeParam.seriesIndex !== 'number') return '';
        const crackRecordId = activeParam.data?.crackRecordId;
        if (crackRecordId) {
          const record = crackRecords.find((item) => item.id === crackRecordId);
          return record ? buildCrackTooltip(record) : '';
        }
        if (activeParam.seriesIndex < trends.length) {
          const pointTrend = trends[activeParam.seriesIndex];
          return buildPointTooltip(
            pointTrend,
            cracksByPoint[pointTrend.point.id] ?? [],
            activeParam.color ?? colorForIndex(activeParam.seriesIndex),
          );
        }
        return '';
      },
    },
    grid: { left: 58, right: 24, top: 24, bottom: 74 },
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
          triggerLineEvent: true,
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
        z: 20,
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
    let activeTipKey = '';

    const hideActiveTip = () => {
      if (!activeTipKey) return;
      activeTipKey = '';
      chart.dispatchAction({ type: 'hideTip' });
    };

    const handlePointerMove = (event: ChartClickEvent) => {
      const x = event.offsetX ?? event.zrX;
      const y = event.offsetY ?? event.zrY;
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        hideActiveTip();
        return;
      }

      const hoverPixel: [number, number] = [x, y];
      const crackTarget = findCrackHitTarget(chart, trends, crackRecords, hoverPixel);
      if (crackTarget) {
        const key = `crack-${crackTarget.record.id}`;
        if (activeTipKey !== key) {
          activeTipKey = key;
          chart.dispatchAction({ type: 'showTip', seriesIndex: trends.length, dataIndex: crackTarget.dataIndex });
        }
        return;
      }

      const lineTarget = findLineHitTarget(chart, trends, hoverPixel);
      if (lineTarget) {
        const key = `line-${lineTarget.seriesIndex}`;
        if (activeTipKey !== key) {
          activeTipKey = key;
          chart.dispatchAction({ type: 'showTip', seriesIndex: lineTarget.seriesIndex, dataIndex: lineTarget.dataIndex });
        }
        return;
      }

      hideActiveTip();
    };

    chart.getZr().on('mousemove', handlePointerMove);
    chart.getZr().on('globalout', hideActiveTip);

    // 点击事件：红圈优先，其次折线，最后才是空白区域。
    chart.off('click');
    chart.getZr().off('click');
    chart.getZr().on('click', (event: ChartClickEvent) => {
      const x = event.offsetX ?? event.zrX;
      const y = event.offsetY ?? event.zrY;
      if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
        if (!event.target) onChartClick?.();
        return;
      }

      const clickPixel: [number, number] = [x, y];
      const crackRecord = findClickedCrack(chart, trends, crackRecords, clickPixel);
      if (crackRecord) {
        onCrackSelect?.(crackRecord);
        return;
      }

      const pointId = findClickedLinePointId(chart, trends, clickPixel);
      if (pointId) {
        onPointClick?.(pointId);
        return;
      }

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
      chart.getZr().off('mousemove', handlePointerMove);
      chart.getZr().off('globalout', hideActiveTip);
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
            onMouseEnter={() => {
              if (interactive) onFocus?.(point.id);
            }}
            onMouseLeave={() => {
              if (interactive) onFocus?.(null);
            }}
            onClick={() => navigate(`/points/${point.id}`)}
            title="点击跳转点位详情"
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
                <p>Ctrl+滚轮缩放 · Shift+滚轮平移 · 拖拽下方滑块选取区间 · 点击曲线跳转点位详情 · 悬停右侧标注突出折线</p>
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
