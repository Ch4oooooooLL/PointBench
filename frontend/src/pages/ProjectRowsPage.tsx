import { ImageOff, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api, mediaUrl } from '../api/client';
import { ProjectSelector } from '../components/ProjectSelector';
import { TrendChart } from '../components/TrendChart';
import { useAppContext, type RiskSettings } from '../context/AppContext';
import { Point, PointMeasurementRow, Project, TrendItem } from '../types';
import { growthPercent, riskLabel, riskLevel, riskPercentText } from '../utils/risk';

interface PointRow {
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

export function ProjectRowsPage() {
  const { selectedProject, selectedProjectId, riskSettings, refreshProjects } = useAppContext();
  const [rows, setRows] = useState<PointRow[]>([]);
  const [active, setActive] = useState<PointRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [projectForm, setProjectForm] = useState<ProjectForm>(toProjectForm(selectedProject));
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setProjectForm(toProjectForm(selectedProject));
  }, [selectedProject]);

  useEffect(() => {
    loadRows();
  }, [selectedProjectId]);

  async function loadRows() {
    if (!selectedProjectId) {
      setRows([]);
      return;
    }
    setRows([]);
    setError('');
    try {
      const points = await api.get<Point[]>(`/api/projects/${selectedProjectId}/points`);
      const data = await Promise.all(
        points.map(async (point) => ({
          point,
          trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
        })),
      );
      setRows(data);
    } catch (err) {
      setError((err as Error).message);
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
      setActive({ point, trend: [] });
      await loadRows();
    } catch (err) {
      setMessage(`新增点位失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const riskCounts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        const initial = firstStress(row.trend);
        const latest = latestStress(row.trend);
        const level = riskLevel(growthPercent(latest, initial), riskSettings);
        acc[level] += 1;
        return acc;
      },
      { normal: 0, warn: 0, danger: 0, critical: 0 },
    );
  }, [rows, riskSettings]);

  return (
    <section>
      <div className="page-head project-detail-head">
        <div>
          <h1>项目详情</h1>
          <p>每行一个点位，展示图片、名称、历次应力幅和按初始值增长百分比计算的风险标识。</p>
        </div>
        <div className="actions project-detail-actions">
          <ProjectSelector compact />
          {editMode && <button className="button" disabled={busy} onClick={addPoint}><Plus size={18} />新增点位</button>}
          {editMode && <button className="button primary" disabled={busy} onClick={saveProject}><Save size={18} />保存</button>}
          <button className="button" onClick={() => setEditMode(!editMode)}>
            {editMode ? <X size={18} /> : <Pencil size={18} />}
            {editMode ? '退出编辑' : '编辑模式'}
          </button>
        </div>
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}
      {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}

      {selectedProject && (
        <>
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
          {!!rows.length && (
            <div className="risk-summary">
              <span className="risk-badge normal">正常 {riskCounts.normal}</span>
              <span className="risk-badge warn">预警 {riskCounts.warn}</span>
              <span className="risk-badge danger">危险 {riskCounts.danger}</span>
              <span className="risk-badge critical">严重 {riskCounts.critical}</span>
            </div>
          )}
          <div className="point-row-list">
            {rows.map((row) => (
              <PointRiskRow key={row.point.id} row={row} onOpen={() => setActive(row)} />
            ))}
            {!rows.length && <div className="empty panel">当前项目暂无点位</div>}
          </div>
        </>
      )}

      {active && (
        <PointRiskModal
          row={active}
          editMode={editMode}
          onClose={() => setActive(null)}
          onChanged={loadRows}
        />
      )}
    </section>
  );
}

function PointRiskRow({ row, onOpen }: { row: PointRow; onOpen: () => void }) {
  const { riskSettings } = useAppContext();
  const initial = firstStress(row.trend);
  const latest = latestStress(row.trend);
  const percent = growthPercent(latest, initial);
  const level = riskLevel(percent, riskSettings);

  return (
    <button className={`point-risk-row ${level}`} onClick={onOpen}>
      <div className="row-thumb">
        {row.point.media_files[0] ? <img src={mediaUrl(row.point.media_files[0].id)} alt={row.point.point_name} /> : <ImageOff size={28} />}
      </div>
      <div className="row-main">
        <div className="point-row-title">
          <strong>{row.point.point_id} · {row.point.point_name}</strong>
          <span className={`risk-badge ${level}`}>{riskLabel(level)} {riskPercentText(percent)}</span>
        </div>
        <p>{row.point.component || '-'} · {row.point.direction || '-'} · {row.point.bridge_type || '-'}</p>
        <div className="stress-history">
          {row.trend.map((item) => {
            const itemPercent = growthPercent(item.stress_amplitude_mpa, initial);
            const itemLevel = riskLevel(itemPercent, riskSettings);
            return (
              <span className={`stress-chip ${itemLevel}`} key={item.run_id}>
                {item.cycle_count}: {item.stress_amplitude_mpa?.toFixed(1) ?? '-'} MPa
              </span>
            );
          })}
          {!row.trend.length && <span className="muted">暂无测试记录</span>}
        </div>
      </div>
    </button>
  );
}

function PointRiskModal({
  row,
  editMode,
  onClose,
  onChanged,
}: {
  row: PointRow;
  editMode: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { riskSettings } = useAppContext();
  const [point, setPoint] = useState<Point>(row.point);
  const [trend, setTrend] = useState<TrendItem[]>(row.trend);
  const [form, setForm] = useState<PointForm>(toPointForm(row.point));
  const [measurements, setMeasurements] = useState<EditableMeasurementRow[]>([]);
  const [deletedMeasurementIds, setDeletedMeasurementIds] = useState<number[]>([]);
  const [previewUrl, setPreviewUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<PointEditTab>('main');
  const [pasteMediaType, setPasteMediaType] = useState<MediaType>('overall');
  const initial = firstStress(trend);

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
    setMeasurements(toEditableRows(data));
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal point-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>{point.point_id} · {point.point_name}</h2>
            <p>{point.component || '-'} · {point.position_description || '未填写位置描述'}</p>
          </div>
          <div className="actions">
            {editMode && <button className="button primary" disabled={busy} onClick={savePoint}><Save size={18} />保存点位</button>}
            <button className="button" onClick={onClose}>关闭</button>
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
