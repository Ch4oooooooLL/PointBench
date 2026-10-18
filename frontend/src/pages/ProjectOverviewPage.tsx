import {
  AlertTriangle,
  ArrowRight,
  ActivitySquare,
  Box,
  Camera,
  CheckCircle2,
  ClipboardPlus,
  Download,
  ListChecks,
  RefreshCw,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, crackImageUrl, downloadFile } from '../api/client';
import { DebugCsvImporter } from '../components/DebugCsvImporter';
import { MultiPointTrendChart, PointTrend } from '../components/MultiPointTrendChart';
import { ProjectContextHeader } from '../components/ProjectContextHeader';
import { useAppContext } from '../context/AppContext';
import { CrackRecord, FemModelPayload, Point, PointElementBinding, TestRun, TrendItem } from '../types';
import { hasTrendAnomaly } from '../utils/anomaly';
import { loadVersionedProjectPage } from '../utils/versionedPageCache';

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

interface ProjectOverviewCacheData {
  points: Point[];
  summary: Summary;
  trends: PointTrend[];
  crackRecords: CrackRecord[];
  testRuns: TestRun[];
  femModel: FemModelPayload | null;
  bindings: PointElementBinding[];
}

export function ProjectOverviewPage() {
  const { selectedProject, selectedProjectId, chartSettings, anomalySettings, debugMode } = useAppContext();
  const [points, setPoints] = useState<Point[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<PointTrend[]>([]);
  const [crackRecords, setCrackRecords] = useState<CrackRecord[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [femModel, setFemModel] = useState<FemModelPayload | null>(null);
  const [bindings, setBindings] = useState<PointElementBinding[]>([]);
  const [selectedCrackRecord, setSelectedCrackRecord] = useState<CrackRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [abnormalOnly, setAbnormalOnly] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!selectedProjectId) {
      setPoints([]);
      setSummary(null);
      setTrends([]);
      setCrackRecords([]);
      setTestRuns([]);
      setFemModel(null);
      setBindings([]);
      return () => {
        cancelled = true;
      };
    }
    setPoints([]);
    setSummary(null);
    setTrends([]);
    setCrackRecords([]);
    setTestRuns([]);
    setFemModel(null);
    setBindings([]);
    setError('');
    setLoading(true);
    loadVersionedProjectPage<ProjectOverviewCacheData>({
      cacheKey: `project-overview:${selectedProjectId}`,
      projectId: selectedProjectId,
      scope: 'overview',
      loadFresh: async () => {
        const [pointData, summaryData, crackData, runData, femData, bindingData] = await Promise.all([
          api.get<Point[]>(`/api/projects/${selectedProjectId}/points`),
          api.get<Summary>(`/api/projects/${selectedProjectId}/analysis/summary`),
          api.get<CrackRecord[]>(`/api/projects/${selectedProjectId}/crack-records`),
          api.get<TestRun[]>(`/api/projects/${selectedProjectId}/test-runs`),
          api.get<FemModelPayload>(`/api/projects/${selectedProjectId}/fem`, { silent: true }).catch(() => null),
          api.get<PointElementBinding[]>(`/api/projects/${selectedProjectId}/point-bindings`, { silent: true }).catch(() => []),
        ]);
        const trendData = await Promise.all(
          pointData.map(async (point) => ({
            point,
            trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
          })),
        );
        return {
          points: pointData,
          summary: summaryData,
          trends: trendData,
          crackRecords: crackData,
          testRuns: runData,
          femModel: femData,
          bindings: bindingData,
        };
      },
    })
      .then(({ data }) => {
        if (cancelled) return;
        setPoints(data.points);
        setSummary(data.summary);
        setCrackRecords(data.crackRecords);
        setTrends(data.trends);
        setTestRuns(data.testRuns ?? []);
        setFemModel(data.femModel ?? null);
        setBindings(data.bindings ?? []);
        setLoading(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, reloadKey]);

  const latestCycle = useMemo(() => {
    const cycles = trends.flatMap((item) => item.trend.map((trend) => trend.cycle_count));
    return cycles.length ? Math.max(...cycles) : null;
  }, [trends]);

  const anomalyRangeMpa = Math.max(0, anomalySettings.rangeMpa);

  const displayTrends = useMemo(() => {
    if (!abnormalOnly) return trends;
    return trends.filter(({ trend }) => hasTrendAnomaly(trend, anomalyRangeMpa));
  }, [trends, abnormalOnly, anomalyRangeMpa]);

  const abnormalTrendCount = useMemo(
    () => trends.filter(({ trend }) => hasTrendAnomaly(trend, anomalyRangeMpa)).length,
    [trends, anomalyRangeMpa],
  );

  const topPoint = summary?.max_amplitude_points[0];
  const latestRun = useMemo(
    () => [...testRuns].sort((a, b) => b.cycle_count - a.cycle_count)[0] ?? null,
    [testRuns],
  );
  const readiness = useMemo(
    () => buildReadiness(points, summary, femModel, bindings),
    [points, summary, femModel, bindings],
  );
  const nextAction = useMemo(
    () => buildNextAction(selectedProjectId, summary, readiness, latestRun),
    [selectedProjectId, summary, readiness, latestRun],
  );

  async function downloadProjectExport(format: 'json' | 'csv') {
    if (!selectedProject) return;
    setError('');
    try {
      await downloadFile(
        `/api/projects/${selectedProject.id}/export.${format}`,
        `${selectedProject.project_id}.${format}`,
      );
    } catch (err) {
      setError(`导出失败：${(err as Error).message}`);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>项目总览</h1>
          <p>从项目阶段到下一步动作，集中判断数据完整度、异常风险和当前工作重点。</p>
        </div>
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}

      {selectedProject && summary && (
        <>
          <ProjectContextHeader active="overview" showTabs={false} />

          <div className="workbench-stage-strip">
            <div className="workbench-stage-copy">
              <span className="eyebrow">当前阶段</span>
              <strong>{readiness.stageLabel}</strong>
              <p>{selectedProject.test_stage ? `登记阶段：${selectedProject.test_stage} · ` : ''}{selectedProject.test_object || selectedProject.vehicle_or_product || '尚未填写测试对象'} · 最近更新 {formatDateTime(selectedProject.updated_at)}</p>
            </div>
            <div className="workbench-stages">
              {readiness.stages.map((stage, index) => (
                <div key={stage.key} className={`workbench-stage ${stage.state}`}>
                  <div className="workbench-stage-node">
                    <span>{stage.state === 'done' ? <CheckCircle2 size={16} /> : stage.index}</span>
                    {index < readiness.stages.length - 1 && <i />}
                  </div>
                  <div>
                    <strong>{stage.label}</strong>
                    <small>{stage.detail}</small>
                  </div>
                </div>
              ))}
            </div>
            <div className="workbench-stage-actions">
              <button className="button" type="button" onClick={() => setReloadKey((key) => key + 1)}>
                <RefreshCw size={17} />
                刷新状态
              </button>
              <button className="button" type="button" onClick={() => downloadProjectExport('json')}>
                <Download size={17} />
                导出
              </button>
            </div>
          </div>

          <div className="workbench-grid">
            <div className="panel workbench-pulse">
              <div className="section-head">
                <div>
                  <span className="eyebrow">PROJECT PULSE / 项目脉搏</span>
                  <h2>应力幅演化</h2>
                  <p>共 {summary.point_count} 个测点 · 已记录 {summary.run_count} 个轮次 · 异常规则阈值 ±{anomalyRangeMpa} MPa</p>
                </div>
                <div className="workbench-pill-row">
                  <span className="pill">最新 {latestCycle ?? '-'} 次</span>
                  <span className={abnormalTrendCount ? 'pill danger' : 'pill ok'}>{abnormalTrendCount} 个异常点位</span>
                </div>
              </div>
              <div className="workbench-metrics">
                <div><span>最新循环次数</span><strong>{latestCycle ?? '-'}</strong><small>{latestRun?.run_name || '暂无有效轮次'}</small></div>
                <div><span>最大应力幅</span><strong>{formatNumber(topPoint?.stress_amplitude_mpa) ?? '-'}</strong><small>{topPoint?.point_id ? `${topPoint.point_id} · ${topPoint.point_name}` : '暂无数据'}</small></div>
                <div><span>待复核点位</span><strong>{abnormalTrendCount}</strong><small>{abnormalTrendCount} 个点位 · {summary.abnormal_count} 条异常记录</small></div>
              </div>
              <p className="workbench-chart-hint">Ctrl+滚轮缩放 · Shift+滚轮平移 · 悬停查看点位与裂纹 · 点击曲线进入点位详情</p>
              <MultiPointTrendChart
                trends={displayTrends}
                height={chartSettings.overviewHeight}
                expandedHeight={chartSettings.overviewExpandedHeight}
                crackRecords={crackRecords}
                onCrackSelect={setSelectedCrackRecord}
                loading={loading}
              />
              <div className="workbench-chart-tools">
                <button
                  className={abnormalOnly ? 'button active' : 'button'}
                  type="button"
                  onClick={() => setAbnormalOnly((value) => !value)}
                >
                  <AlertTriangle size={16} />
                  {abnormalOnly ? `仅异常 (${abnormalTrendCount})` : '仅看异常'}
                </button>
                <Link className="text-link" to="/project-detail">查看全部点位 <ArrowRight size={15} /></Link>
              </div>
            </div>

            <aside className="panel workbench-next">
              <span className="eyebrow">NEXT BEST ACTION / 下一步建议</span>
              <div className={`workbench-next-icon ${nextAction.tone}`}>
                {nextAction.tone === 'ok' ? <CheckCircle2 size={23} /> : <AlertTriangle size={23} />}
              </div>
              <h2>{nextAction.title}</h2>
              <p>{nextAction.description}</p>
              <div className="workbench-action-list">
                {nextAction.items.map((item) => (
                  <Link key={item.label} to={item.to}>
                    <span>{item.label}</span>
                    <ArrowRight size={15} />
                  </Link>
                ))}
              </div>
              <Link className={`button primary workbench-next-button`} to={nextAction.primaryTo}>
                {nextAction.primaryLabel}
                <ArrowRight size={17} />
              </Link>
              <span className="workbench-next-note">{nextAction.note}</span>
            </aside>
          </div>

          <div className="workbench-summary-grid">
            <Link className="workbench-summary-card" to="/project-detail">
              <span>点位完整度</span>
              <strong>{readiness.completePoints} / {summary.point_count}</strong>
              <small>照片、通道、最新数据均有记录</small>
              <ProgressBar value={readiness.pointCompletion} />
            </Link>
            <Link className="workbench-summary-card" to="/data-entry">
              <span>最近数据</span>
              <strong>{latestRun?.run_name || '暂无轮次'}</strong>
              <small>{latestRun ? `循环 ${latestRun.cycle_count} 次 · ${formatDateTime(latestRun.test_time || latestRun.created_at)}` : '录入第一轮测试数据'}</small>
              <em className={latestRun ? 'ok' : 'warn'}>{latestRun ? '已入库' : '待录入'}</em>
            </Link>
            <Link className="workbench-summary-card" to={`/projects/${selectedProject.id}/analysis`}>
              <span>异常复核</span>
              <strong>{summary.abnormal_count}</strong>
              <small>{abnormalTrendCount} 个点位需要关注</small>
              <em className={summary.abnormal_count ? 'warn' : 'ok'}>{summary.abnormal_count ? '待处理' : '已完成'}</em>
            </Link>
            <Link className="workbench-summary-card" to="/crack-records">
              <span>裂纹记录</span>
              <strong>{crackRecords.length}</strong>
              <small>{new Set(crackRecords.map((record) => record.point_db_id)).size} 个点位存在记录</small>
              <em className="neutral">查看图库</em>
            </Link>
          </div>

          <div className="workbench-bottom-grid">
            <div className="panel">
              <div className="section-head">
                <div>
                  <h2>重点点位</h2>
                  <p>按最新应力幅与异常状态排序</p>
                </div>
                <Link className="text-link" to="/project-detail">查看全部 <ArrowRight size={15} /></Link>
              </div>
              <div className="workbench-point-list">
                {summary.max_amplitude_points.slice(0, 4).map((row) => (
                  <Link key={row.point_db_id} to={`/points/${row.point_db_id}`} className="workbench-point-row">
                    <span className="workbench-point-id">{row.point_id}</span>
                    <span>
                      <strong>{row.point_name}</strong>
                      <small>{row.component || '-'} · {row.latest_run_name || row.run_name || '-'}</small>
                    </span>
                    <b>{formatNumber(row.stress_amplitude_mpa, ' MPa')}</b>
                    <em className={row.danger_level ? 'danger' : 'warn'}>{row.danger_level || '待复核'}</em>
                  </Link>
                ))}
                {!summary.max_amplitude_points.length && <div className="empty">暂无点位数据</div>}
              </div>
            </div>
            <div className="panel">
              <div className="section-head">
                <div>
                  <h2>项目数据完整度</h2>
                  <p>用于判断是否具备完整复核条件</p>
                </div>
                <strong className="workbench-completion">{readiness.overall}%</strong>
              </div>
              <div className="workbench-readiness-list">
                {readiness.checks.map((check) => (
                  <div key={check.label}>
                    <div><span>{check.label}</span><strong>{check.value}</strong></div>
                    <ProgressBar value={check.percent} tone={check.percent === 100 ? 'ok' : 'warn'} />
                  </div>
                ))}
              </div>
              {summary.abnormal_count > 0 && (
                <div className="workbench-notice">
                  <AlertTriangle size={16} />
                  还有 {summary.abnormal_count} 条异常记录尚未完成复核
                </div>
              )}
            </div>
          </div>

          <div className="workbench-quick-actions">
            <Link className="button" to="/project-detail"><ListChecks size={17} />核对点位</Link>
            <Link className="button" to="/fem-preview"><Box size={17} />绑定模型</Link>
            <Link className="button" to="/data-entry"><ClipboardPlus size={17} />录入数据</Link>
            <Link className="button" to={`/projects/${selectedProject.id}/analysis`}><ActivitySquare size={17} />进入分析</Link>
            <Link className="button" to="/crack-records"><Camera size={17} />记录裂纹</Link>
          </div>

          {debugMode && (
            <DebugCsvImporter
              projectId={selectedProject.id}
              points={points}
              onImported={() => setReloadKey((key) => key + 1)}
            />
          )}

        </>
      )}

      {selectedCrackRecord && (
        <CrackOverviewModal record={selectedCrackRecord} onClose={() => setSelectedCrackRecord(null)} />
      )}
    </section>
  );
}

function CrackOverviewModal({ record, onClose }: { record: CrackRecord; onClose: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);

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
        {imageFailed ? (
          <div className="thumb-empty crack-image-fallback">图片加载失败</div>
        ) : (
          <img src={crackImageUrl(record.id)} alt={`${record.point_id} 裂纹详情`} onError={() => setImageFailed(true)} />
        )}
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

interface ReadinessCheck {
  label: string;
  value: string;
  percent: number;
}

interface Readiness {
  stageLabel: string;
  stages: Array<{ key: string; index: number; label: string; detail: string; state: 'done' | 'current' | 'todo' }>;
  completePoints: number;
  pointCompletion: number;
  overall: number;
  checks: ReadinessCheck[];
}

function buildReadiness(
  points: Point[],
  summary: Summary | null,
  femModel: FemModelPayload | null,
  bindings: PointElementBinding[],
): Readiness {
  const pointCount = points.length;
  const runCount = summary?.run_count ?? 0;
  const completePoints = points.filter(
    (point) => point.media_files.length > 0 && point.channels.length > 0 && Boolean(point.latest_measurement),
  ).length;
  const photoPoints = points.filter((point) => point.media_files.length > 0).length;
  const channelPoints = points.filter((point) => point.channels.length > 0).length;
  const calibratedPoints = points.filter((point) => point.latest_measurement).length;
  const modelReady = femModel?.status === 'ready' && Boolean(femModel.glb_url && femModel.mapping_url);
  const boundPoints = new Set(bindings.map((binding) => binding.point_db_id)).size;
  const percent = (value: number, total: number) => (total > 0 ? Math.round((value / total) * 100) : 0);
  const checks = [
    { label: '点位照片', value: `${photoPoints} / ${pointCount}`, percent: percent(photoPoints, pointCount) },
    { label: '通道映射', value: `${channelPoints} / ${pointCount}`, percent: percent(channelPoints, pointCount) },
    { label: '最新测量', value: `${calibratedPoints} / ${pointCount}`, percent: percent(calibratedPoints, pointCount) },
    { label: 'FEM 模型', value: modelReady ? '已就绪' : '未导入', percent: modelReady ? 100 : 0 },
    { label: '点位绑定', value: `${boundPoints} / ${pointCount}`, percent: percent(boundPoints, pointCount) },
  ];
  const overall = Math.round(checks.reduce((sum, check) => sum + check.percent, 0) / checks.length);
  const imported = pointCount > 0;
  const pointsReady = pointCount > 0 && percent(completePoints, pointCount) >= 80;
  const modelBound = modelReady && boundPoints >= pointCount && pointCount > 0;
  const dataReady = runCount > 0 && calibratedPoints > 0;
  const reviewed = dataReady && (summary?.abnormal_count ?? 0) === 0;
  const rawStages = [
    { key: 'import', index: 1, label: '导入', detail: imported ? `${pointCount} 个点位` : '等待项目数据', complete: imported },
    { key: 'points', index: 2, label: '点位核对', detail: pointsReady ? '基础信息齐全' : '需补充点位资料', complete: pointsReady },
    { key: 'model', index: 3, label: '模型绑定', detail: modelBound ? `${boundPoints} 个点位已绑定` : modelReady ? '部分点位未绑定' : '等待 FEM 模型', complete: modelBound },
    { key: 'data', index: 4, label: '数据采集', detail: dataReady ? `${runCount} 个轮次` : '等待测量数据', complete: dataReady },
    { key: 'review', index: 5, label: '复核归档', detail: reviewed ? '暂无待复核项' : `${summary?.abnormal_count ?? 0} 条异常`, complete: reviewed },
  ];
  const firstIncomplete = rawStages.findIndex((stage) => !stage.complete);
  const stages = rawStages.map((stage, index) => ({
    key: stage.key,
    index: stage.index,
    label: stage.label,
    detail: stage.detail,
    state: stage.complete ? 'done' : firstIncomplete === index ? 'current' : 'todo',
  })) as Readiness['stages'];
  const currentStage = stages.find((stage) => stage.state === 'current') ?? stages[stages.length - 1];
  return {
    stageLabel: currentStage.label,
    stages,
    completePoints,
    pointCompletion: percent(completePoints, pointCount),
    overall,
    checks,
  };
}

interface NextAction {
  tone: 'warn' | 'ok';
  title: string;
  description: string;
  primaryLabel: string;
  primaryTo: string;
  note: string;
  items: Array<{ label: string; to: string }>;
}

function buildNextAction(
  projectId: number | null,
  summary: Summary | null,
  readiness: Readiness,
  latestRun: TestRun | null,
): NextAction {
  if (!projectId || !summary) {
    return {
      tone: 'warn',
      title: '先选择一个项目',
      description: '选择项目后，这里会汇总当前阶段、异常风险和下一步建议。',
      primaryLabel: '返回项目台账',
      primaryTo: '/project-detail',
      note: '项目上下文会贯穿所有分析页面。',
      items: [],
    };
  }
  if (!summary.point_count) {
    return {
      tone: 'warn',
      title: '补充项目点位',
      description: '当前项目还没有可用点位，先完成点位核对或从项目数据包导入。',
      primaryLabel: '进入点位台账',
      primaryTo: '/project-detail',
      note: '点位是模型绑定、采集和复核的基础。',
      items: [{ label: '导入项目数据', to: '/import' }],
    };
  }
  if (summary.abnormal_count > 0) {
    return {
      tone: 'warn',
      title: '优先处理异常点位',
      description: `当前有 ${summary.abnormal_count} 条异常记录，建议先确认高风险测点，再决定是否补充采集。`,
      primaryLabel: '进入分析复核',
      primaryTo: `/projects/${projectId}/analysis`,
      note: latestRun ? `最近轮次：${latestRun.run_name}（${latestRun.cycle_count} 次）` : '暂无最近轮次',
      items: [
        { label: '查看点位台账', to: '/project-detail' },
        { label: '检查裂纹图库', to: '/crack-records' },
      ],
    };
  }
  if (readiness.overall < 100) {
    return {
      tone: 'warn',
      title: '补齐项目数据完整度',
      description: '项目基础数据仍有缺口，补齐照片、通道或模型绑定后再进入正式复核。',
      primaryLabel: '查看点位台账',
      primaryTo: '/project-detail',
      note: `当前完整度 ${readiness.overall}%`,
      items: [{ label: '绑定模型', to: '/fem-preview' }, { label: '录入新数据', to: `/projects/${projectId}/test-runs/new` }],
    };
  }
  return {
    tone: 'ok',
    title: '项目状态良好',
    description: '项目数据完整，当前没有待复核异常，可以继续查看趋势或导出归档。',
    primaryLabel: '查看分析复核',
    primaryTo: `/projects/${projectId}/analysis`,
    note: latestRun ? `最近轮次：${latestRun.run_name}` : '尚未记录有效轮次',
    items: [{ label: '查看裂纹图库', to: '/crack-records' }, { label: '返回项目总览', to: '/overview' }],
  };
}

function ProgressBar({ value, tone = 'ok' }: { value: number; tone?: 'ok' | 'warn' }) {
  return (
    <span className={`workbench-progress ${tone}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
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
