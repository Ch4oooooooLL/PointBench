import { BarChart3, ClipboardPlus, ImageOff, Pencil, Plus, Save, Search, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { ProjectSelector } from '../components/ProjectSelector';
import { TrendChart } from '../components/TrendChart';
import { useAppContext, type RiskSettings } from '../context/AppContext';
import { Point, PointMeasurementRow, Project, TestRun, TrendItem } from '../types';
import { growthPercent, riskLevel, riskPercentText } from '../utils/risk';

export interface PointRow {
  point: Point;
  trend: TrendItem[];
}

interface ProjectForm {
  project_name: string;
  test_object: string;
  test_type: string;
  department: string;
  vehicle_or_product: string;
  test_stage: string;
  description: string;
}

interface PointForm {
  point_id: string;
  point_name: string;
  point_type: string;
  component: string;
  side: string;
  position_description: string;
  direction: string;
  bridge_type: string;
  resistance_ohm: string;
  install_status: string;
  check_status: string;
  remark: string;
}

interface EditableMeasurementRow {
  localKey: string;
  id?: number;
  run_name: string;
  cycle_count: string;
  max_strain_ue: string;
  min_strain_ue: string;
  is_abnormal: boolean;
  abnormal_reason: string;
  remark: string;
}

type PointEditTab = 'main' | 'optional' | 'photos' | 'cycles';
type MediaType = 'overall' | 'local';
type QuickFilter = 'all' | 'review' | 'photo-missing' | 'channel-missing' | 'latest-missing' | 'data-abnormal' | 'manual-abnormal';

interface PointLedgerState {
  label: string;
  tone: 'normal' | 'review' | 'missing' | 'abnormal' | 'manual' | 'insufficient';
  reason: string;
  trendStatus: string;
  photoCount: number;
  photoComplete: boolean;
  channelComplete: boolean;
  latest: TrendItem | null;
  initialStress: number | null;
  latestStress: number | null;
  percent: number | null;
  needsReview: boolean;
  dataAbnormal: boolean;
  manualAbnormal: boolean;
  latestCycleHasData: boolean;
}

const quickFilters: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'review', label: '待复核' },
  { key: 'photo-missing', label: '照片缺失' },
  { key: 'channel-missing', label: '通道缺失' },
  { key: 'latest-missing', label: '最新数据缺失' },
  { key: 'data-abnormal', label: '数据异常' },
  { key: 'manual-abnormal', label: '人工异常' },
];

function toProjectForm(project: Project | null): ProjectForm {
  return {
    project_name: project?.project_name ?? '',
    test_object: project?.test_object ?? '',
    test_type: project?.test_type ?? '',
    department: project?.department ?? '',
    vehicle_or_product: project?.vehicle_or_product ?? '',
    test_stage: project?.test_stage ?? '',
    description: project?.description ?? '',
  };
}

function toPointForm(point: Point): PointForm {
  return {
    point_id: point.point_id,
    point_name: point.point_name,
    point_type: point.point_type || 'strain',
    component: point.component ?? '',
    side: point.side ?? '',
    position_description: point.position_description ?? '',
    direction: point.direction ?? '',
    bridge_type: point.bridge_type ?? '',
    resistance_ohm: point.resistance_ohm == null ? '' : String(point.resistance_ohm),
    install_status: point.install_status || 'planned',
    check_status: point.check_status ?? '',
    remark: point.remark ?? '',
  };
}

function toEditableRows(rows: PointMeasurementRow[]): EditableMeasurementRow[] {
  return rows.map((row) => ({
    localKey: String(row.id),
    id: row.id,
    run_name: row.run_name,
    cycle_count: String(row.cycle_count),
    max_strain_ue: row.max_strain_ue == null ? '' : String(row.max_strain_ue),
    min_strain_ue: row.min_strain_ue == null ? '' : String(row.min_strain_ue),
    is_abnormal: row.is_abnormal,
    abnormal_reason: row.abnormal_reason ?? '',
    remark: row.remark ?? '',
  }));
}

function numberOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value: string): number | null {
  if (value.trim() === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function mediaTypeLabel(type: string): string {
  if (type === 'overall') return '整体';
  if (type === 'local') return '局部';
  return '未分类';
}

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function ProjectRowsPage() {
  const { selectedProject, selectedProjectId, riskSettings, refreshProjects } = useAppContext();
  const [rows, setRows] = useState<PointRow[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const [modalRow, setModalRow] = useState<PointRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectForm>(toProjectForm(selectedProject));
  const [query, setQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [componentGroup, setComponentGroup] = useState('');
  const [installGroup, setInstallGroup] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setProjectForm(toProjectForm(selectedProject));
  }, [selectedProject]);

  useEffect(() => {
    loadRows();
  }, [selectedProjectId]);

  async function loadRows() {
    if (!selectedProjectId) {
      setRows([]);
      setTestRuns([]);
      setSelectedRowId(null);
      setLoading(false);
      return;
    }
    setRows([]);
    setError('');
    setLoading(true);
    try {
      const [points, runs] = await Promise.all([
        api.get<Point[]>(`/api/projects/${selectedProjectId}/points`),
        api.get<TestRun[]>(`/api/projects/${selectedProjectId}/test-runs`),
      ]);
      const data = await Promise.all(
        points.map(async (point) => ({
          point,
          trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
        })),
      );
      setRows(data);
      setTestRuns(runs);
      setSelectedRowId((current) => (current && data.some((row) => row.point.id === current) ? current : data[0]?.point.id ?? null));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function saveProject() {
    if (!selectedProject) return;
    setBusy(true);
    setMessage('');
    try {
      await api.put<Project>(`/api/projects/${selectedProject.id}`, projectForm);
      await refreshProjects();
      setMessage('项目基础信息已保存。');
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function addPoint() {
    if (!selectedProjectId) return;
    setBusy(true);
    setMessage('');
    try {
      const point = await api.post<Point>(`/api/projects/${selectedProjectId}/points`);
      const nextRow = { point, trend: [] };
      setSelectedRowId(point.id);
      setModalRow(nextRow);
      await loadRows();
    } catch (err) {
      setMessage(`新增点位失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const latestValidCycle = useMemo(() => maxNumber(rows.flatMap((row) => validTrendItems(row.trend).map((item) => item.cycle_count))), [rows]);
  const latestProjectCycle = latestValidCycle ?? maxNumber(testRuns.map((run) => run.cycle_count));
  const latestRun = useMemo(() => {
    if (latestProjectCycle == null) return null;
    return [...testRuns].reverse().find((run) => run.cycle_count === latestProjectCycle) ?? null;
  }, [latestProjectCycle, testRuns]);
  const states = useMemo(() => new Map(rows.map((row) => [row.point.id, pointLedgerState(row, riskSettings, latestProjectCycle)])), [rows, riskSettings, latestProjectCycle]);
  const ledgerSummary = useMemo(() => summarizeLedger(rows, states), [rows, states]);
  const components = useMemo(() => uniqueValues(rows.map((row) => row.point.component)), [rows]);
  const installStatuses = useMemo(() => uniqueValues(rows.map((row) => row.point.install_status)), [rows]);
  const filteredRows = useMemo(
    () => rows.filter((row) => matchesLedgerFilters(row, states.get(row.point.id), query, quickFilter, componentGroup, installGroup)),
    [rows, states, query, quickFilter, componentGroup, installGroup],
  );
  const selectedRow = filteredRows.find((row) => row.point.id === selectedRowId) ?? rows.find((row) => row.point.id === selectedRowId) ?? filteredRows[0] ?? rows[0] ?? null;
  const latestAcquiredAt = latestRun?.test_time || latestRun?.created_at || (latestValidCycle == null ? null : selectedProject?.updated_at);

  return (
    <section>
      <div className="page-head project-detail-head">
        <div>
          <h1>{selectedProject?.project_name || '项目详情'}</h1>
          <p>点位台账用于核对测点位置、照片、通道、安装状态和最新数据摘要；完整趋势和历史数据请进入点位详情或分析页查看。</p>
        </div>
        <div className="actions project-detail-actions">
          <ProjectSelector compact />
          {editMode && <button className="button" disabled={busy} onClick={addPoint}><Plus size={18} />新增点位</button>}
          {editMode && <button className="button primary" disabled={busy} onClick={saveProject}><Save size={18} />保存</button>}
          {selectedProject && <Link className="button" to={`/projects/${selectedProject.id}/analysis`}><BarChart3 size={18} />分析</Link>}
          {selectedProject && <Link className="button primary" to={`/projects/${selectedProject.id}/test-runs/new`}><ClipboardPlus size={18} />录入数据</Link>}
          <button className="button" onClick={() => setEditMode(!editMode)}>
            {editMode ? <X size={18} /> : <Pencil size={18} />}
            {editMode ? '退出编辑' : '编辑模式'}
          </button>
        </div>
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}
      {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}

      {loading && selectedProject && (
        <div className="chart chart-loading" style={{ height: 360 }}>
          <div className="chart-loading-spinner" />
          <span>点位台账加载中…</span>
        </div>
      )}

      {!loading && selectedProject && (
        <>
          <div className="point-summary-strip">
            <div><span>项目名称</span><strong>{selectedProject.project_name || '-'}</strong></div>
            <div><span>项目编号</span><strong>{selectedProject.project_id || '-'}</strong></div>
            <div><span>试验类型</span><strong>{selectedProject.test_type || '-'}</strong></div>
            <div><span>点位总数</span><strong>{rows.length}</strong></div>
            <div><span>当前最新循环次数</span><strong>{formatInteger(latestProjectCycle)}</strong></div>
            <div><span>最近一次有效采集时间</span><strong>{formatDateTime(latestAcquiredAt)}</strong></div>
          </div>

          {editMode && (
            <div className="panel project-edit-panel">
              <div className="project-edit-grid">
                <label>项目名称<input value={projectForm.project_name} onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })} /></label>
                <label>测试对象<input value={projectForm.test_object} onChange={(e) => setProjectForm({ ...projectForm, test_object: e.target.value })} /></label>
                <label>试验类型<input value={projectForm.test_type} onChange={(e) => setProjectForm({ ...projectForm, test_type: e.target.value })} /></label>
                <label>部门<input value={projectForm.department} onChange={(e) => setProjectForm({ ...projectForm, department: e.target.value })} /></label>
                <label>产品/车型<input value={projectForm.vehicle_or_product} onChange={(e) => setProjectForm({ ...projectForm, vehicle_or_product: e.target.value })} /></label>
                <label>试验阶段<input value={projectForm.test_stage} onChange={(e) => setProjectForm({ ...projectForm, test_stage: e.target.value })} /></label>
                <label className="wide">说明<textarea rows={3} value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} /></label>
              </div>
            </div>
          )}

          <div className="point-status-card-grid">
            <StatusCard label="点位总数" value={ledgerSummary.total} />
            <StatusCard label="照片完整点位数" value={ledgerSummary.photoComplete} />
            <StatusCard label="通道完整点位数" value={ledgerSummary.channelComplete} />
            <StatusCard label="最新轮次有效数据" value={ledgerSummary.latestCycleValid} />
            <StatusCard label="待复核点位数" value={ledgerSummary.review} />
            <StatusCard label="数据异常点位数" value={ledgerSummary.dataAbnormal} />
          </div>

          <div className="project-detail-workspace">
            <aside className="point-filter-sidebar">
              <label className="search point-ledger-search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索点位编号、名称、部件、通道" />
              </label>
              <div className="point-filter-section">
                <h2>快速筛选</h2>
                <div className="point-filter-buttons">
                  {quickFilters.map((filter) => (
                    <button key={filter.key} className={quickFilter === filter.key ? 'active' : ''} onClick={() => setQuickFilter(filter.key)}>
                      {filter.label}
                      <span>{filterCount(rows, states, filter.key)}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="point-filter-section">
                <h2>按部件分组</h2>
                <button className={!componentGroup ? 'active' : ''} onClick={() => setComponentGroup('')}>全部部件<span>{rows.length}</span></button>
                {components.map((component) => (
                  <button key={component} className={componentGroup === component ? 'active' : ''} onClick={() => setComponentGroup(component)}>
                    {component}
                    <span>{rows.filter((row) => row.point.component === component).length}</span>
                  </button>
                ))}
              </div>
              <div className="point-filter-section">
                <h2>按安装状态分组</h2>
                <button className={!installGroup ? 'active' : ''} onClick={() => setInstallGroup('')}>全部状态<span>{rows.length}</span></button>
                {installStatuses.map((status) => (
                  <button key={status} className={installGroup === status ? 'active' : ''} onClick={() => setInstallGroup(status)}>
                    {status}
                    <span>{rows.filter((row) => row.point.install_status === status).length}</span>
                  </button>
                ))}
              </div>
            </aside>

            <div className="point-ledger-list">
              <div className="point-ledger-list-head">
                <div>
                  <h2>点位台账</h2>
                  <p>当前显示 {filteredRows.length} / {rows.length} 个点位</p>
                </div>
                {editMode && <button className="button" disabled={busy} onClick={addPoint}><Plus size={18} />新增点位</button>}
              </div>
              <div className="point-ledger-rows">
                {filteredRows.map((row) => {
                  const state = states.get(row.point.id) as PointLedgerState;
                  return (
                    <PointRiskRow
                      key={row.point.id}
                      row={row}
                      state={state}
                      selected={selectedRow?.point.id === row.point.id}
                      onOpen={() => {
                        setSelectedRowId(row.point.id);
                        if (editMode) setModalRow(row);
                      }}
                    />
                  );
                })}
                {!filteredRows.length && !!rows.length && <div className="empty panel">当前筛选条件下没有点位</div>}
                {!rows.length && <div className="empty panel">当前项目暂无点位</div>}
              </div>
            </div>

            <PointDetailPanel
              row={selectedRow}
              state={selectedRow ? states.get(selectedRow.point.id) ?? null : null}
              riskSettings={riskSettings}
              projectId={selectedProject.id}
              onOpenHistory={(row) => setModalRow(row)}
              onEdit={(row) => {
                setEditMode(true);
                setModalRow(row);
              }}
            />
          </div>
        </>
      )}

      {modalRow && (
        <PointRiskModal
          row={modalRow}
          editMode={editMode}
          onClose={() => setModalRow(null)}
          onChanged={loadRows}
        />
      )}
    </section>
  );
}

function PointRiskRow({ row, state, selected, onOpen }: { row: PointRow; state: PointLedgerState; selected: boolean; onOpen: () => void }) {
  const thumbnail = preferredMedia(row.point);
  const channel = primaryChannel(row.point);

  return (
    <button className={`point-ledger-row ${state.tone} ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <div className="row-thumb">
        {thumbnail ? <img src={mediaUrl(thumbnail.id)} alt={row.point.point_name} /> : <ImageOff size={24} />}
      </div>
      <div className="point-ledger-row-main">
        <div className="point-ledger-row-title">
          <strong>{row.point.point_id} · {row.point.point_name}</strong>
          <span className={`point-state-badge ${state.tone}`}>{state.label}</span>
        </div>
        <div className="point-ledger-meta">
          <span>{row.point.component || '-'}</span>
          <span>{row.point.direction || '-'}</span>
          <span>{row.point.bridge_type || '-'}</span>
        </div>
        <div className="point-ledger-meta secondary">
          <span>{channel?.channel_name || '通道缺失'}</span>
          <span>照片 {state.photoCount}/2</span>
          <span>安装 {row.point.install_status || '-'}</span>
          <span>检查 {row.point.check_status || '-'}</span>
        </div>
        <div className="point-ledger-data">
          <span>最新 {formatInteger(state.latest?.cycle_count)} 次</span>
          <span>应变幅 {formatNumber(state.latest?.amplitude_strain_ue, 1)} ue</span>
          <span>应力幅 {formatNumber(state.latestStress, 1)} MPa</span>
          <span>基准 {formatNumber(state.initialStress, 1)} MPa</span>
          <span>{riskPercentText(state.percent)}</span>
          <span>{state.trendStatus}</span>
        </div>
        <p className="point-ledger-reason">原因：{state.reason}</p>
      </div>
    </button>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="point-status-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PointDetailPanel({
  row,
  state,
  riskSettings,
  projectId,
  onOpenHistory,
  onEdit,
}: {
  row: PointRow | null;
  state: PointLedgerState | null;
  riskSettings: RiskSettings;
  projectId: number;
  onOpenHistory: (row: PointRow) => void;
  onEdit: (row: PointRow) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setShowHistory(false);
    setPreviewUrl('');
  }, [row?.point.id]);

  if (!row || !state) {
    return <aside className="point-detail-panel empty-detail"><div className="empty">请选择点位</div></aside>;
  }

  const { point, trend } = row;
  const overall = point.media_files.find((item) => item.type === 'overall');
  const local = point.media_files.find((item) => item.type === 'local');
  const channel = primaryChannel(point);

  return (
    <aside className="point-detail-panel">
      <div className="point-detail-head">
        <div>
          <h2>{point.point_id} · {point.point_name}</h2>
          <p>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</p>
        </div>
        <span className={`point-state-badge ${state.tone}`}>{state.label}</span>
      </div>
      <p className="point-detail-reason">关注原因：{state.reason}</p>

      <div className="point-detail-photos">
        <PhotoPreview title="整体照片" media={overall} onPreview={setPreviewUrl} />
        <PhotoPreview title="局部照片" media={local} onPreview={setPreviewUrl} />
      </div>

      <div className="point-detail-section">
        <h2>点位基础信息</h2>
        <div className="point-detail-kv">
          <div><span>部件</span><strong>{point.component || '-'}</strong></div>
          <div><span>方向</span><strong>{point.direction || '-'}</strong></div>
          <div><span>桥路</span><strong>{point.bridge_type || '-'}</strong></div>
          <div><span>通道</span><strong>{channel?.channel_name || '-'}</strong></div>
          <div><span>安装状态</span><strong>{point.install_status || '-'}</strong></div>
          <div><span>检查状态</span><strong>{point.check_status || '-'}</strong></div>
          <div className="wide"><span>备注</span><strong>{point.remark || '-'}</strong></div>
        </div>
      </div>

      <div className="point-detail-section">
        <h2>最新数据</h2>
        <div className="point-detail-kv">
          <div><span>循环次数</span><strong>{formatInteger(state.latest?.cycle_count)}</strong></div>
          <div><span>最大应变</span><strong>{formatNumber(state.latest?.max_strain_ue, 1)} ue</strong></div>
          <div><span>最小应变</span><strong>{formatNumber(state.latest?.min_strain_ue, 1)} ue</strong></div>
          <div><span>应变幅</span><strong>{formatNumber(state.latest?.amplitude_strain_ue, 1)} ue</strong></div>
          <div><span>应力幅</span><strong>{formatNumber(state.latestStress, 2)} MPa</strong></div>
          <div><span>相对基准变化</span><strong>{riskPercentText(state.percent)}</strong></div>
        </div>
      </div>

      <div className="point-detail-section point-detail-chart">
        <h2>小趋势图</h2>
        <TrendChart data={trend} metric="stress_amplitude_mpa" />
      </div>

      <div className="point-detail-actions">
        <button className="button" onClick={() => onOpenHistory(row)}>查看完整历史</button>
        <button className="button" onClick={() => setShowHistory((current) => !current)}>{showHistory ? '收起历史数据' : '展开历史数据'}</button>
        <button className="button" onClick={() => onEdit(row)}><Pencil size={18} />编辑点位</button>
        <button className="button" onClick={() => onEdit(row)}><Upload size={18} />上传照片</button>
        <Link className="button primary" to={`/projects/${projectId}/test-runs/new`}><ClipboardPlus size={18} />录入数据</Link>
      </div>

      {showHistory && <ReadOnlyTrendTable trend={trend} initial={state.initialStress} riskSettings={riskSettings} />}

      {previewUrl && (
        <div className="modal-backdrop" onClick={() => setPreviewUrl('')}>
          <div className="modal image-preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-head">
              <h2>图片预览</h2>
              <button className="button" onClick={() => setPreviewUrl('')}>关闭</button>
            </div>
            <img src={previewUrl} alt="图片预览" />
          </div>
        </div>
      )}
    </aside>
  );
}

function PhotoPreview({ title, media, onPreview }: { title: string; media?: Point['media_files'][number]; onPreview: (url: string) => void }) {
  return (
    <div className="point-detail-photo">
      <span>{title}</span>
      {media ? (
        <button onClick={() => onPreview(mediaUrl(media.id))}>
          <img src={mediaUrl(media.id)} alt={media.filename} />
        </button>
      ) : (
        <div><ImageOff size={22} />缺失</div>
      )}
    </div>
  );
}

export function PointRiskModal({
  row,
  editMode,
  deletingPoint = false,
  onClose,
  onChanged,
  onDeletePoint,
}: {
  row: PointRow;
  editMode: boolean;
  deletingPoint?: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDeletePoint?: () => void;
}) {
  const { riskSettings } = useAppContext();
  const [point, setPoint] = useState<Point>(row.point);
  const [trend, setTrend] = useState<TrendItem[]>(row.trend);
  const [form, setForm] = useState<PointForm>(toPointForm(row.point));
  const [measurements, setMeasurements] = useState<EditableMeasurementRow[]>([]);
  const [measurementSnapshot, setMeasurementSnapshot] = useState<EditableMeasurementRow[]>([]);
  const [deletedMeasurementIds, setDeletedMeasurementIds] = useState<number[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<PointEditTab>('main');
  const [pasteMediaType, setPasteMediaType] = useState<MediaType>('overall');
  const initial = firstStress(trend);
  const hasUnsavedChanges = editMode && (
    !isSameValue(form, toPointForm(point)) ||
    !isSameValue(measurements, measurementSnapshot) ||
    deletedMeasurementIds.length > 0
  );

  function closeWithConfirm() {
    if (!hasUnsavedChanges || window.confirm('当前点位有未保存修改，确认放弃这些修改？')) onClose();
  }

  useEffect(() => {
    setPoint(row.point);
    setTrend(row.trend);
    setForm(toPointForm(row.point));
    setActiveTab('main');
    loadMeasurementRows(row.point.id);
  }, [row.point.id]);

  useEffect(() => {
    if (!editMode || activeTab !== 'photos') return undefined;
    function handlePaste(event: ClipboardEvent) {
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      uploadImage(file, pasteMediaType);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [editMode, activeTab, point.id, pasteMediaType]);

  async function refreshPoint() {
    const [nextPoint, nextTrend] = await Promise.all([
      api.get<Point>(`/api/points/${point.id}`),
      api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
    ]);
    setPoint(nextPoint);
    setTrend(nextTrend);
    setForm(toPointForm(nextPoint));
    await loadMeasurementRows(point.id);
    await onChanged();
  }

  async function loadMeasurementRows(pointId: number) {
    const data = await api.get<PointMeasurementRow[]>(`/api/points/${pointId}/measurement-rows`);
    const editableRows = toEditableRows(data);
    setMeasurements(editableRows);
    setMeasurementSnapshot(editableRows);
    setDeletedMeasurementIds([]);
  }

  function updateMeasurement(localKey: string, patch: Partial<EditableMeasurementRow>) {
    setMeasurements((current) => current.map((item) => (item.localKey === localKey ? { ...item, ...patch } : item)));
  }

  function addMeasurement() {
    setMeasurements((current) => [
      ...current,
      {
        localKey: `new-${Date.now()}`,
        run_name: '',
        cycle_count: '',
        max_strain_ue: '',
        min_strain_ue: '',
        is_abnormal: false,
        abnormal_reason: '',
        remark: '',
      },
    ]);
  }

  function removeMeasurement(rowItem: EditableMeasurementRow) {
    if (rowItem.id) setDeletedMeasurementIds((current) => [...current, rowItem.id as number]);
    setMeasurements((current) => current.filter((item) => item.localKey !== rowItem.localKey));
  }

  async function uploadImage(file?: File | null, mediaType: MediaType = 'overall') {
    if (!file) return;
    setBusy(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('media_type', mediaType);
      await api.post(`/api/points/${point.id}/media`, formData);
      await refreshPoint();
      setMessage(`${mediaTypeLabel(mediaType)}照片已上传。`);
    } catch (err) {
      setMessage(`上传失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function deleteImage(mediaId: number) {
    setBusy(true);
    setMessage('');
    try {
      await api.delete(`/api/points/${point.id}/media/${mediaId}`);
      await refreshPoint();
      setMessage('图片已删除。');
    } catch (err) {
      setMessage(`删除失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function savePoint() {
    if (!form.point_id.trim() || !form.point_name.trim()) {
      setMessage('保存失败：点位编号和名称不能为空。');
      setActiveTab('main');
      return;
    }
    const invalidRow = measurements.find((item) => integerOrNull(item.cycle_count) == null);
    if (invalidRow) {
      setMessage('保存失败：循环次数必须填写为整数。');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.put<Point>(`/api/points/${point.id}`, {
        ...form,
        resistance_ohm: numberOrNull(form.resistance_ohm),
      });
      await api.put<PointMeasurementRow[]>(`/api/points/${point.id}/measurement-rows`, {
        deleted_measurement_ids: deletedMeasurementIds,
        measurements: measurements.map((measurement) => ({
          id: measurement.id,
          run_name: measurement.run_name || undefined,
          cycle_count: integerOrNull(measurement.cycle_count) as number,
          max_strain_ue: numberOrNull(measurement.max_strain_ue),
          min_strain_ue: numberOrNull(measurement.min_strain_ue),
          is_abnormal: measurement.is_abnormal,
          abnormal_reason: measurement.abnormal_reason || null,
          remark: measurement.remark || null,
        })),
      });
      await refreshPoint();
      setMessage('点位信息已保存。');
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={closeWithConfirm}>
      <div className="modal point-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>{point.point_id} · {point.point_name}</h2>
            <p>{point.component || '-'} · {point.position_description || '未填写位置描述'}</p>
          </div>
          <div className="actions">
            {editMode && onDeletePoint && (
              <button className="button danger-text" disabled={busy || deletingPoint} onClick={onDeletePoint}>
                <Trash2 size={18} />
                {deletingPoint ? '删除中...' : '删除点位'}
              </button>
            )}
            {editMode && <button className="button primary" disabled={busy} onClick={savePoint}><Save size={18} />保存点位</button>}
            <button className="button" onClick={closeWithConfirm}>关闭</button>
          </div>
        </div>
        {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}
        {editMode ? (
          <div className="point-editor">
            <div className="mode-tabs point-edit-tabs">
              <button className={activeTab === 'main' ? 'active' : ''} onClick={() => setActiveTab('main')}>主信息</button>
              <button className={activeTab === 'optional' ? 'active' : ''} onClick={() => setActiveTab('optional')}>可选信息</button>
              <button className={activeTab === 'photos' ? 'active' : ''} onClick={() => setActiveTab('photos')}>照片</button>
              <button className={activeTab === 'cycles' ? 'active' : ''} onClick={() => setActiveTab('cycles')}>循环数据</button>
            </div>

            {activeTab === 'main' && (
              <div className="panel point-editor-panel">
                <h2>主信息</h2>
                <div className="point-main-grid">
                  <label>点位编号（必填）<input value={form.point_id} onChange={(event) => setForm({ ...form, point_id: event.target.value })} /></label>
                  <label>点位名称（必填）<input value={form.point_name} onChange={(event) => setForm({ ...form, point_name: event.target.value })} /></label>
                </div>
              </div>
            )}

            {activeTab === 'optional' && (
              <div className="panel point-editor-panel">
                <h2>可选信息</h2>
                <div className="point-edit-grid">
                  <label>点位类型
                    <select value={form.point_type} onChange={(event) => setForm({ ...form, point_type: event.target.value })}>
                      <option value="strain">应变</option>
                      <option value="temperature">温度</option>
                      <option value="displacement">位移</option>
                      <option value="pressure">压力</option>
                      <option value="other">其他</option>
                    </select>
                  </label>
                  <label>部件<input value={form.component} onChange={(event) => setForm({ ...form, component: event.target.value })} /></label>
                  <label>方位
                    <select value={form.side} onChange={(event) => setForm({ ...form, side: event.target.value })}>
                      <option value="">未填写</option>
                      <option value="left">left</option>
                      <option value="right">right</option>
                      <option value="front">front</option>
                      <option value="rear">rear</option>
                      <option value="center">center</option>
                    </select>
                  </label>
                  <label>方向
                    <select value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value })}>
                      <option value="">未填写</option>
                      <option value="X">X</option>
                      <option value="Y">Y</option>
                      <option value="Z">Z</option>
                      <option value="45">45</option>
                      <option value="-45">-45</option>
                    </select>
                  </label>
                  <label>桥路类型
                    <select value={form.bridge_type} onChange={(event) => setForm({ ...form, bridge_type: event.target.value })}>
                      <option value="">未填写</option>
                      <option value="quarter">quarter</option>
                      <option value="half">half</option>
                      <option value="full">full</option>
                      <option value="other">other</option>
                    </select>
                  </label>
                  <label>电阻<input type="number" value={form.resistance_ohm} onChange={(event) => setForm({ ...form, resistance_ohm: event.target.value })} /></label>
                  <label>安装状态
                    <select value={form.install_status} onChange={(event) => setForm({ ...form, install_status: event.target.value })}>
                      <option value="planned">planned</option>
                      <option value="installed">installed</option>
                      <option value="removed">removed</option>
                      <option value="damaged">damaged</option>
                      <option value="abandoned">abandoned</option>
                    </select>
                  </label>
                  <label>检查状态
                    <select value={form.check_status} onChange={(event) => setForm({ ...form, check_status: event.target.value })}>
                      <option value="">未填写</option>
                      <option value="unchecked">unchecked</option>
                      <option value="ok">ok</option>
                      <option value="warning">warning</option>
                      <option value="failed">failed</option>
                    </select>
                  </label>
                  <label className="wide">位置描述<textarea rows={3} value={form.position_description} onChange={(event) => setForm({ ...form, position_description: event.target.value })} /></label>
                  <label className="wide">备注<textarea rows={3} value={form.remark} onChange={(event) => setForm({ ...form, remark: event.target.value })} /></label>
                </div>
              </div>
            )}

            {activeTab === 'photos' && (
              <div className="panel point-editor-panel">
                <div className="section-head">
                  <h2>照片</h2>
                  <div className="actions">
                    <button className={pasteMediaType === 'overall' ? 'button primary' : 'button'} onClick={() => setPasteMediaType('overall')}>粘贴为整体</button>
                    <button className={pasteMediaType === 'local' ? 'button primary' : 'button'} onClick={() => setPasteMediaType('local')}>粘贴为局部</button>
                  </div>
                </div>
                <div className="photo-upload-grid">
                  <PhotoSection title="整体照片" mediaType="overall" media={point.media_files} busy={busy} onUpload={uploadImage} onPreview={setPreviewUrl} onDelete={deleteImage} />
                  <PhotoSection title="局部照片" mediaType="local" media={point.media_files} busy={busy} onUpload={uploadImage} onPreview={setPreviewUrl} onDelete={deleteImage} />
                </div>
              </div>
            )}

            {activeTab === 'cycles' && (
              <div className="panel point-editor-panel">
                <div className="section-head">
                  <h2>循环数据</h2>
                  <button className="button" onClick={addMeasurement}><Plus size={18} />新增循环</button>
                </div>
                <MeasurementTable measurements={measurements} initial={initial} riskSettings={riskSettings} updateMeasurement={updateMeasurement} removeMeasurement={removeMeasurement} />
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="detail-grid point-read-layout">
              <div>
                <h2>照片</h2>
                <ReadOnlyPhotoGrid point={point} onPreview={setPreviewUrl} />
              </div>
              <div>
                <TrendChart data={trend} metric="stress_amplitude_mpa" />
              </div>
            </div>
            <ReadOnlyTrendTable trend={trend} initial={initial} riskSettings={riskSettings} />
          </>
        )}
        {previewUrl && (
          <div className="modal-backdrop" onClick={() => setPreviewUrl('')}>
            <div className="modal image-preview-modal" onClick={(event) => event.stopPropagation()}>
              <div className="section-head">
                <h2>图片预览</h2>
                <button className="button" onClick={() => setPreviewUrl('')}>关闭</button>
              </div>
              <img src={previewUrl} alt="图片预览" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotoSection({
  title,
  mediaType,
  media,
  busy,
  onUpload,
  onPreview,
  onDelete,
}: {
  title: string;
  mediaType: MediaType;
  media: Point['media_files'];
  busy: boolean;
  onUpload: (file?: File | null, mediaType?: MediaType) => void;
  onPreview: (url: string) => void;
  onDelete: (mediaId: number) => void;
}) {
  const items = media.filter((item) => item.type === mediaType);
  return (
    <div className="photo-upload-section">
      <div className="section-head compact-head">
        <h3>{title}</h3>
        <label className="button file-button">
          <Upload size={18} />
          上传
          <input type="file" accept="image/*" disabled={busy} onChange={(event) => onUpload(event.target.files?.[0], mediaType)} />
        </label>
      </div>
      <div className="photo-grid">
        {items.map((mediaItem) => (
          <div className="photo-item" key={mediaItem.id}>
            <button className="photo-button" onClick={() => onPreview(mediaUrl(mediaItem.id))}>
              <img src={mediaUrl(mediaItem.id)} alt={mediaItem.filename} />
              <span>{mediaTypeLabel(mediaItem.type)} · {mediaItem.filename}</span>
            </button>
            <button className="icon-button danger-text photo-delete" disabled={busy} onClick={() => onDelete(mediaItem.id)} title="删除图片"><Trash2 size={16} /></button>
          </div>
        ))}
        {!items.length && <div className="empty">暂无{title}</div>}
      </div>
    </div>
  );
}

function ReadOnlyPhotoGrid({ point, onPreview }: { point: Point; onPreview: (url: string) => void }) {
  return (
    <div className="photo-grid">
      {point.media_files.map((media) => (
        <button className="photo-button" onClick={() => onPreview(mediaUrl(media.id))} key={media.id}>
          <img src={mediaUrl(media.id)} alt={media.filename} />
          <span>{mediaTypeLabel(media.type)} · {media.filename}</span>
        </button>
      ))}
      {!point.media_files.length && <div className="empty">暂无图片</div>}
    </div>
  );
}

function MeasurementTable({
  measurements,
  initial,
  riskSettings,
  updateMeasurement,
  removeMeasurement,
}: {
  measurements: EditableMeasurementRow[];
  initial: number | null;
  riskSettings: RiskSettings;
  updateMeasurement: (localKey: string, patch: Partial<EditableMeasurementRow>) => void;
  removeMeasurement: (rowItem: EditableMeasurementRow) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>轮次</th>
            <th>循环次数</th>
            <th>最大应变</th>
            <th>最小应变</th>
            <th>应变幅</th>
            <th>应力幅</th>
            <th>相对初始</th>
            <th>异常原因</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {measurements.map((item) => {
            const max = numberOrNull(item.max_strain_ue);
            const min = numberOrNull(item.min_strain_ue);
            const amplitude = max == null || min == null ? null : (max - min) / 2;
            const stress = amplitude == null ? null : amplitude * 0.206;
            const percent = growthPercent(stress, initial);
            const level = riskLevel(percent, riskSettings);
            return (
              <tr key={item.localKey}>
                <td><input value={item.run_name} onChange={(event) => updateMeasurement(item.localKey, { run_name: event.target.value })} /></td>
                <td><input type="number" value={item.cycle_count} onChange={(event) => updateMeasurement(item.localKey, { cycle_count: event.target.value })} /></td>
                <td><input type="number" value={item.max_strain_ue} onChange={(event) => updateMeasurement(item.localKey, { max_strain_ue: event.target.value })} /></td>
                <td><input type="number" value={item.min_strain_ue} onChange={(event) => updateMeasurement(item.localKey, { min_strain_ue: event.target.value })} /></td>
                <td>{amplitude == null ? '-' : amplitude.toFixed(1)}</td>
                <td>{stress == null ? '-' : stress.toFixed(2)}</td>
                <td><span className={`risk-badge ${level}`}>{riskPercentText(percent)}</span></td>
                <td><input value={item.abnormal_reason} onChange={(event) => updateMeasurement(item.localKey, { abnormal_reason: event.target.value })} /></td>
                <td><button className="icon-button danger-text" onClick={() => removeMeasurement(item)} title="删除循环"><Trash2 size={16} /></button></td>
              </tr>
            );
          })}
          {!measurements.length && <tr><td colSpan={9} className="empty">暂无测试记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function ReadOnlyTrendTable({ trend, initial, riskSettings }: { trend: TrendItem[]; initial: number | null; riskSettings: RiskSettings }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>轮次</th>
            <th>循环次数</th>
            <th>最大应变</th>
            <th>最小应变</th>
            <th>应变幅</th>
            <th>应力幅</th>
            <th>相对初始</th>
            <th>异常原因</th>
          </tr>
        </thead>
        <tbody>
          {trend.map((item) => {
            const percent = growthPercent(item.stress_amplitude_mpa, initial);
            const level = riskLevel(percent, riskSettings);
            return (
              <tr key={item.run_id}>
                <td>{item.run_name}</td>
                <td>{item.cycle_count}</td>
                <td>{item.max_strain_ue ?? '-'}</td>
                <td>{item.min_strain_ue ?? '-'}</td>
                <td>{item.amplitude_strain_ue?.toFixed(1) ?? '-'}</td>
                <td>{item.stress_amplitude_mpa?.toFixed(2) ?? '-'}</td>
                <td><span className={`risk-badge ${level}`}>{riskPercentText(percent)}</span></td>
                <td>{item.abnormal_reason || '-'}</td>
              </tr>
            );
          })}
          {!trend.length && <tr><td colSpan={8} className="empty">暂无测试记录</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function pointLedgerState(row: PointRow, riskSettings: RiskSettings, latestProjectCycle: number | null): PointLedgerState {
  const validItems = validTrendItems(row.trend);
  const latest = validItems[validItems.length - 1] ?? null;
  const initialStress = firstStress(row.trend);
  const latestStressValue = latest?.stress_amplitude_mpa ?? null;
  const percent = growthPercent(latestStressValue, initialStress);
  const level = riskLevel(percent, riskSettings);
  const photoCount = (row.point.media_files.some((item) => item.type === 'overall') ? 1 : 0) + (row.point.media_files.some((item) => item.type === 'local') ? 1 : 0);
  const photoComplete = photoCount >= 2;
  const channelComplete = Boolean(primaryChannel(row.point)?.channel_name);
  const latestCycleHasData = latestProjectCycle == null ? Boolean(latest) : Boolean(latest && latest.cycle_count === latestProjectCycle);
  const manualAbnormal = Boolean(latest?.is_abnormal && latest.abnormal_reason && !isAutoAbnormalReason(latest.abnormal_reason));
  const dataAbnormal = Boolean(latest?.is_abnormal && !manualAbnormal);
  const checkStatus = (row.point.check_status || '').toLowerCase();
  const needsReview = !checkStatus || ['unchecked', 'warning', 'failed'].includes(checkStatus) || dataAbnormal || manualAbnormal;
  const trendStatus = trendStatusText(validItems, level);

  if (!photoComplete) {
    return { label: '照片缺失', tone: 'missing', reason: '整体照片或局部照片未齐套，建议补充台账照片', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview: true, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  if (!channelComplete) {
    return { label: '通道缺失', tone: 'missing', reason: '未绑定有效通道名，最新数据可能无法稳定匹配', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview: true, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  if (!latestCycleHasData) {
    return { label: '数据不足', tone: 'insufficient', reason: '最新轮次没有有效数据，建议补录或检查导入匹配', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview: true, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  if (manualAbnormal) {
    return { label: '人工异常', tone: 'manual', reason: latest?.abnormal_reason || '人工标记异常，需要现场或数据复核', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview: true, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  if (dataAbnormal) {
    return { label: '数据异常', tone: 'abnormal', reason: latest?.abnormal_reason || '最新数据触发异常规则，建议复核测点与采集链路', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview: true, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  if (needsReview) {
    return { label: '待复核', tone: 'review', reason: '检查状态尚未确认或需要复核', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview, dataAbnormal, manualAbnormal, latestCycleHasData };
  }
  return { label: '正常', tone: 'normal', reason: '台账信息完整，最新轮次已有有效数据', trendStatus, photoCount, photoComplete, channelComplete, latest, initialStress, latestStress: latestStressValue, percent, needsReview, dataAbnormal, manualAbnormal, latestCycleHasData };
}

function summarizeLedger(rows: PointRow[], states: Map<number, PointLedgerState>) {
  return rows.reduce(
    (acc, row) => {
      const state = states.get(row.point.id);
      if (!state) return acc;
      acc.total += 1;
      if (state.photoComplete) acc.photoComplete += 1;
      if (state.channelComplete) acc.channelComplete += 1;
      if (state.latestCycleHasData) acc.latestCycleValid += 1;
      if (state.needsReview) acc.review += 1;
      if (state.dataAbnormal || state.manualAbnormal) acc.dataAbnormal += 1;
      return acc;
    },
    { total: 0, photoComplete: 0, channelComplete: 0, latestCycleValid: 0, review: 0, dataAbnormal: 0 },
  );
}

function matchesLedgerFilters(row: PointRow, state: PointLedgerState | undefined, query: string, quickFilter: QuickFilter, componentGroup: string, installGroup: string): boolean {
  if (!state) return false;
  const keyword = query.trim().toLowerCase();
  const channelText = row.point.channels.map((channel) => [channel.device, channel.channel_name, channel.unit].filter(Boolean).join(' ')).join(' ');
  const haystack = [row.point.point_id, row.point.point_name, row.point.component, row.point.direction, row.point.bridge_type, channelText].filter(Boolean).join(' ').toLowerCase();
  if (keyword && !haystack.includes(keyword)) return false;
  if (componentGroup && row.point.component !== componentGroup) return false;
  if (installGroup && row.point.install_status !== installGroup) return false;
  return quickFilterMatches(state, quickFilter);
}

function quickFilterMatches(state: PointLedgerState, quickFilter: QuickFilter): boolean {
  if (quickFilter === 'all') return true;
  if (quickFilter === 'review') return state.needsReview;
  if (quickFilter === 'photo-missing') return !state.photoComplete;
  if (quickFilter === 'channel-missing') return !state.channelComplete;
  if (quickFilter === 'latest-missing') return !state.latestCycleHasData;
  if (quickFilter === 'data-abnormal') return state.dataAbnormal;
  if (quickFilter === 'manual-abnormal') return state.manualAbnormal;
  return true;
}

function filterCount(rows: PointRow[], states: Map<number, PointLedgerState>, quickFilter: QuickFilter): number {
  return rows.filter((row) => {
    const state = states.get(row.point.id);
    return state ? quickFilterMatches(state, quickFilter) : false;
  }).length;
}

function trendStatusText(items: TrendItem[], level: ReturnType<typeof riskLevel>): string {
  if (!items.length) return '无数据';
  if (items.length < 2) return '数据不足';
  const latest = items[items.length - 1]?.stress_amplitude_mpa;
  const previous = items[items.length - 2]?.stress_amplitude_mpa;
  if (latest != null && previous != null) {
    if (latest > previous) return level === 'normal' ? '轻微上升' : '持续上升';
    if (latest < previous) return '下降';
  }
  return '平稳';
}

function validTrendItems(trend: TrendItem[]): TrendItem[] {
  return [...trend]
    .filter((item) => item.max_strain_ue != null || item.min_strain_ue != null || item.amplitude_strain_ue != null || item.stress_amplitude_mpa != null)
    .sort((left, right) => left.cycle_count - right.cycle_count || left.run_id - right.run_id);
}

function preferredMedia(point: Point): Point['media_files'][number] | undefined {
  return point.media_files.find((item) => item.type === 'local') ?? point.media_files.find((item) => item.type === 'overall') ?? point.media_files[0];
}

function primaryChannel(point: Point): Point['channels'][number] | undefined {
  return point.channels.find((channel) => channel.channel_name) ?? point.channels[0];
}

function uniqueValues(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort((left, right) => left.localeCompare(right));
}

function maxNumber(values: Array<number | null | undefined>): number | null {
  const numbers = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : null;
}

function formatNumber(value: number | null | undefined, digits = 1): string {
  return value == null || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

function formatInteger(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '-' : String(value);
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function isAutoAbnormalReason(reason: string): boolean {
  return reason.includes('连续') || reason.includes('相对上一轮') || reason.includes('变化超过') || reason.includes('增长超过');
}

function firstStress(trend: TrendItem[]): number | null {
  return sortedStressItems(trend)[0]?.stress_amplitude_mpa ?? null;
}

function latestStress(trend: TrendItem[]): number | null {
  const items = sortedStressItems(trend);
  return items[items.length - 1]?.stress_amplitude_mpa ?? null;
}

function sortedStressItems(trend: TrendItem[]): TrendItem[] {
  return [...trend]
    .filter((item) => item.stress_amplitude_mpa != null)
    .sort((a, b) => a.cycle_count - b.cycle_count || a.run_id - b.run_id);
}
