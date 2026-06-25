import { ClipboardPlus, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, crackImageUrl } from '../api/client';
import { DebugCsvImporter } from '../components/DebugCsvImporter';
import { MultiPointTrendChart, PointTrend } from '../components/MultiPointTrendChart';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { CrackRecord, Point, TrendItem } from '../types';

type SummaryValue = string | number | null | undefined;

interface SummaryPoint {
  point_db_id: number;
  point_id: string;
  point_name: string;
  point_type?: string | null;
  component?: string | null;
  side?: string | null;
  position_description?: string | null;
  direction?: string | null;
  bridge_type?: string | null;
  resistance_ohm?: number | null;
  install_status?: string | null;
  check_status?: string | null;
  remark?: string | null;
  channel_name?: string | null;
  channel_device?: string | null;
  channel_unit?: string | null;
  sample_rate_hz?: number | null;
  cae_point_id?: string | null;
  cae_component?: string | null;
  cae_result_type?: string | null;
  danger_level?: string | null;
  photo_count?: number | null;
  tags?: string | null;
  custom_fields?: string | null;
  metadata_created_time?: string | null;
  metadata_updated_time?: string | null;
  run_id?: number | null;
  run_name?: string | null;
  cycle_count?: number | null;
  amplitude_strain_ue?: number | null;
  stress_amplitude_mpa?: number | null;
  previous_run_name?: string | null;
  latest_run_name?: string | null;
  previous_cycle_count?: number | null;
  latest_cycle_count?: number | null;
  previous_amplitude_strain_ue?: number | null;
  latest_amplitude_strain_ue?: number | null;
  previous_stress_amplitude_mpa?: number | null;
  latest_stress_amplitude_mpa?: number | null;
  growth_ratio?: number | null;
  [key: string]: SummaryValue;
}

interface Summary {
  point_count: number;
  run_count: number;
  measurement_count: number;
  abnormal_count: number;
  max_amplitude_points: SummaryPoint[];
  fastest_growth_points: SummaryPoint[];
}

export function ProjectOverviewPage() {
  const { selectedProject, selectedProjectId, chartSettings, debugMode } = useAppContext();
  const [points, setPoints] = useState<Point[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<PointTrend[]>([]);
  const [crackRecords, setCrackRecords] = useState<CrackRecord[]>([]);
  const [selectedCrackRecord, setSelectedCrackRecord] = useState<CrackRecord | null>(null);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selectedProjectId) {
      setPoints([]);
      setSummary(null);
      setTrends([]);
      setCrackRecords([]);
      return;
    }
    setPoints([]);
    setSummary(null);
    setTrends([]);
    setCrackRecords([]);
    setError('');
    Promise.all([
      api.get<Point[]>(`/api/projects/${selectedProjectId}/points`),
      api.get<Summary>(`/api/projects/${selectedProjectId}/analysis/summary`),
      api.get<CrackRecord[]>(`/api/projects/${selectedProjectId}/crack-records`),
    ])
      .then(async ([pointData, summaryData, crackData]) => {
        setPoints(pointData);
        setSummary(summaryData);
        setCrackRecords(crackData);
        const trendData = await Promise.all(
          pointData.map(async (point) => ({
            point,
            trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
          })),
        );
        setTrends(trendData);
      })
      .catch((err) => setError(err.message));
  }, [selectedProjectId, reloadKey]);

  const latestCycle = useMemo(() => {
    const cycles = trends.flatMap((item) => item.trend.map((trend) => trend.cycle_count));
    return cycles.length ? Math.max(...cycles) : null;
  }, [trends]);

  const topPoint = summary?.max_amplitude_points[0];

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>项目概览</h1>
          <p>选择当前项目，查看点位规模、测试进展、异常状态和全点位应力趋势。</p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}

      {selectedProject && summary && (
        <>
          <div className="overview-band">
            <div>
              <span>项目名称</span>
              <strong>{selectedProject.project_name}</strong>
              <p>{selectedProject.project_id}</p>
            </div>
            <div>
              <span>测试对象</span>
              <strong>{selectedProject.test_object || '-'}</strong>
              <p>{selectedProject.test_type || '-'}</p>
            </div>
            <div>
              <span>当前阶段</span>
              <strong>{selectedProject.test_stage || '-'}</strong>
              <p>{selectedProject.department || '-'}</p>
            </div>
          </div>

          <div className="metric-grid">
            <div><span>点位数量</span><strong>{summary.point_count}</strong></div>
            <div><span>测试轮次</span><strong>{summary.run_count}</strong></div>
            <div><span>测量记录</span><strong>{summary.measurement_count}</strong></div>
            <div><span>异常点位</span><strong>{summary.abnormal_count}</strong></div>
            <div><span>最新循环次数</span><strong>{latestCycle ?? '-'}</strong></div>
            <div><span>当前最大应力幅</span><strong>{topPoint?.stress_amplitude_mpa ? Number(topPoint.stress_amplitude_mpa).toFixed(1) : '-'}</strong></div>
          </div>

          <div className="overview-actions">
            <Link className="button primary" to={`/projects/${selectedProject.id}/test-runs/new`}>
              <ClipboardPlus size={18} />
              录入测试数据
            </Link>
            <a className="button" href={`/api/projects/${selectedProject.id}/export.json`}>
              <Download size={18} />
              导出 JSON
            </a>
            <a className="button" href={`/api/projects/${selectedProject.id}/export.csv`}>
              <Download size={18} />
              导出 CSV
            </a>
          </div>

          {debugMode && (
            <DebugCsvImporter
              projectId={selectedProject.id}
              points={points}
              onImported={() => setReloadKey((key) => key + 1)}
            />
          )}

          <div className="panel">
            <div className="section-head">
              <div>
                <h2>全点位应力幅趋势</h2>
                <p>每个点位一条折线；红圈表示该点位在对应循环次数记录了裂纹，点击红圈可查看详情。</p>
              </div>
            </div>
            <MultiPointTrendChart
              trends={trends}
              height={chartSettings.overviewHeight}
              expandedHeight={chartSettings.overviewExpandedHeight}
              crackRecords={crackRecords}
              onCrackSelect={setSelectedCrackRecord}
            />
          </div>

          <div className="overview-columns">
            <DataPanel title="应力幅最大的点位" rows={summary.max_amplitude_points} mode="amplitude" />
            <DataPanel title="增长最快的点位" rows={summary.fastest_growth_points} mode="growth" />
          </div>
        </>
      )}

      {selectedCrackRecord && (
        <CrackOverviewModal record={selectedCrackRecord} onClose={() => setSelectedCrackRecord(null)} />
      )}
    </section>
  );
}

function CrackOverviewModal({ record, onClose }: { record: CrackRecord; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal crack-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>{record.point_id} 裂纹详情</h2>
            <p>{record.point_name} · {record.cycle_count} 次</p>
          </div>
          <button className="button" onClick={onClose}>关闭</button>
        </div>
        <img src={crackImageUrl(record.id)} alt={`${record.point_id} 裂纹详情`} />
        <div className="kv-grid compact">
          <div><span>点位</span><strong>{record.point_id}</strong></div>
          <div><span>点位名称</span><strong>{record.point_name}</strong></div>
          <div><span>循环次数</span><strong>{record.cycle_count}</strong></div>
          <div><span>轮次</span><strong>{record.run_name || '-'}</strong></div>
          <div><span>记录时间</span><strong>{formatDateTime(record.created_at)}</strong></div>
          <div><span>文件名</span><strong>{record.filename}</strong></div>
        </div>
        {record.remark && <div className="crack-remark">{record.remark}</div>}
      </div>
    </div>
  );
}

function DataPanel({ title, rows, mode }: { title: string; rows: SummaryPoint[]; mode: 'amplitude' | 'growth' }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="compact-list">
        {rows.slice(0, 5).map((row, index) => (
          <SummaryPointCard key={`${row.point_db_id}-${index}`} row={row} mode={mode} />
        ))}
        {!rows.length && <p className="empty">暂无数据</p>}
      </div>
    </div>
  );
}

function SummaryPointCard({ row, mode }: { row: SummaryPoint; mode: 'amplitude' | 'growth' }) {
  const metricItems =
    mode === 'amplitude'
      ? [
          ['应力幅', formatNumber(row.stress_amplitude_mpa, ' MPa')],
          ['应变幅', formatNumber(row.amplitude_strain_ue, ' ue')],
          ['循环次数', formatInteger(row.cycle_count)],
          ['轮次', row.run_name],
        ]
      : [
          ['增长率', formatPercent(row.growth_ratio)],
          ['最新应力幅', formatNumber(row.latest_stress_amplitude_mpa, ' MPa')],
          ['上一轮应力幅', formatNumber(row.previous_stress_amplitude_mpa, ' MPa')],
          ['循环变化', formatCycleRange(row.previous_cycle_count, row.latest_cycle_count)],
        ];

  const metadataItems = [
    ['部件', row.component],
    ['位置', joinText([row.side, row.position_description])],
    ['方向', row.direction],
    ['点位类型', row.point_type],
    ['桥路', row.bridge_type],
    ['电阻', formatNumber(row.resistance_ohm, ' Ω')],
    ['通道', joinText([row.channel_device, row.channel_name])],
    ['采样率', formatNumber(row.sample_rate_hz, ' Hz')],
    ['CAE', joinText([row.cae_point_id, row.cae_component, row.cae_result_type])],
    ['危险等级', row.danger_level],
    ['状态', joinText([row.install_status, row.check_status])],
    ['照片', row.photo_count === null || row.photo_count === undefined ? null : `${row.photo_count} 张`],
    ['标签', row.tags],
    ['自定义', row.custom_fields],
    ['备注', row.remark],
  ].filter(([, value]) => hasValue(value));

  return (
    <div className="summary-point-card">
      <div className="summary-point-title">
        <div>
          <Link to={`/points/${row.point_db_id}`}>
            <strong>{row.point_id || '-'}</strong>
          </Link>
          <span>{row.point_name || '-'}</span>
        </div>
        {hasValue(row.danger_level) && <em>{row.danger_level}</em>}
      </div>
      <div className="summary-metrics">
        {metricItems.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{hasValue(value) ? value : '-'}</strong>
          </div>
        ))}
      </div>
      <div className="summary-meta">
        {metadataItems.slice(0, 8).map(([label, value]) => (
          <span key={label}>
            <b>{label}</b>{value}
          </span>
        ))}
      </div>
    </div>
  );
}

function hasValue(value: SummaryValue): boolean {
  return value !== null && value !== undefined && value !== '';
}

function formatNumber(value: SummaryValue, suffix = ''): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${numeric.toFixed(1)}${suffix}`;
}

function formatInteger(value: SummaryValue): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return String(Math.round(numeric));
}

function formatPercent(value: SummaryValue): string | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatCycleRange(previous: SummaryValue, latest: SummaryValue): string | null {
  const previousText = formatInteger(previous);
  const latestText = formatInteger(latest);
  if (!previousText && !latestText) return null;
  return `${previousText || '-'} -> ${latestText || '-'}`;
}

function joinText(values: SummaryValue[]): string | null {
  const parts = values.filter(hasValue).map(String);
  return parts.length ? parts.join(' / ') : null;
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
