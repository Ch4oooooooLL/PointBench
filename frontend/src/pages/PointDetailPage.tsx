import { ImagePlus, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { TrendChart } from '../components/TrendChart';
import { useAppContext } from '../context/AppContext';
import { Point, PointMeasurementRow, TrendItem } from '../types';
import { getCookie, setCookie } from '../utils/cookie';
import { calculateStressPreview, DEFAULT_STRESS_FORMULA } from '../utils/stressFormula';

const naturalCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

type LegendLabelMode = 'point_id' | 'point_name';
type LegendSortMode = 'source' | 'primary_asc' | 'primary_desc' | 'latest_desc';

type Metric = 'max_strain_ue' | 'min_strain_ue' | 'amplitude_strain_ue' | 'stress_amplitude_mpa';

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
  amplitude_strain_ue?: number | null;
  stress_amplitude_mpa?: number | null;
  is_abnormal: boolean;
  abnormal_reason: string;
  remark: string;
}

function toPointForm(point: Point | null): PointForm {
  return {
    point_id: point?.point_id ?? '',
    point_name: point?.point_name ?? '',
    point_type: point?.point_type ?? 'strain',
    component: point?.component ?? '',
    side: point?.side ?? '',
    position_description: point?.position_description ?? '',
    direction: point?.direction ?? '',
    bridge_type: point?.bridge_type ?? '',
    resistance_ohm: point?.resistance_ohm == null ? '' : String(point.resistance_ohm),
    install_status: point?.install_status ?? 'planned',
    check_status: point?.check_status ?? '',
    remark: point?.remark ?? '',
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
    amplitude_strain_ue: row.amplitude_strain_ue,
    stress_amplitude_mpa: row.stress_amplitude_mpa,
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

function isSameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function PointDetailPage() {
  const { pointId } = useParams();
  const navigate = useNavigate();
  const { setSelectedProjectId, displaySettings } = useAppContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [point, setPoint] = useState<Point | null>(null);
  const [form, setForm] = useState<PointForm>(toPointForm(null));
  const [rows, setRows] = useState<EditableMeasurementRow[]>([]);
  const [rowSnapshot, setRowSnapshot] = useState<EditableMeasurementRow[]>([]);
  const [deletedMeasurementIds, setDeletedMeasurementIds] = useState<number[]>([]);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [metric, setMetric] = useState<Metric>('amplitude_strain_ue');
  const [stressFormula, setStressFormula] = useState(DEFAULT_STRESS_FORMULA);
  const [editMode, setEditMode] = useState(searchParams.get('edit') === '1');
  const [previewUrl, setPreviewUrl] = useState('');
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadRetryKey, setLoadRetryKey] = useState(0);

  // 新增切换点位状态
  const [pointsList, setPointsList] = useState<Point[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [labelMode, setLabelMode] = useState<LegendLabelMode>('point_id');
  const [sortMode, setSortMode] = useState<LegendSortMode>('source');
  
  // 提示和引导状态
  const [showFirstTimeModal, setShowFirstTimeModal] = useState(false);
  const [showPromptBanner, setShowPromptBanner] = useState(false);

  useEffect(() => {
    if (point?.project_db_id) {
      api.get<Point[]>(`/api/projects/${point.project_db_id}/points`).then(setPointsList);
    }
  }, [point?.project_db_id]);

  useEffect(() => {
    api.get<{ stress_formula: string }>('/api/settings')
      .then((data) => setStressFormula(data.stress_formula || DEFAULT_STRESS_FORMULA))
      .catch(() => setStressFormula(DEFAULT_STRESS_FORMULA));
  }, []);

  useEffect(() => {
    if (pointId) {
      const visited = getCookie('visited_point_detail');
      if (!visited) {
        setShowFirstTimeModal(true);
      } else {
        if (displaySettings.showPromptMessage) {
          setShowPromptBanner(true);
        }
      }
    }
  }, [pointId, displaySettings.showPromptMessage]);

  const handleCloseFirstTimeModal = () => {
    setShowFirstTimeModal(false);
    setCookie('visited_point_detail', 'true', 365);
    if (displaySettings.showPromptMessage) {
      setShowPromptBanner(true);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (!target.closest('.point-detail-selector')) {
        setIsOpen(false);
      }
    }
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, [isOpen]);

  const sortedPoints = useMemo(() => {
    const indexed = pointsList.map((item, index) => ({ item, index }));
    if (sortMode === 'source') return pointsList;
    indexed.sort((left, right) => {
      if (sortMode === 'latest_desc') {
        const leftValue = left.item.latest_measurement?.stress_amplitude_mpa ?? null;
        const rightValue = right.item.latest_measurement?.stress_amplitude_mpa ?? null;
        if (leftValue != null && rightValue != null && leftValue !== rightValue) return rightValue - leftValue;
        if (leftValue != null && rightValue == null) return -1;
        if (leftValue == null && rightValue != null) return 1;
      } else {
        const primaryLeft = labelMode === 'point_id' ? left.item.point_id : left.item.point_name;
        const primaryRight = labelMode === 'point_id' ? right.item.point_id : right.item.point_name;
        const primaryCompare = naturalCollator.compare(primaryLeft, primaryRight);
        if (primaryCompare !== 0) return sortMode === 'primary_asc' ? primaryCompare : -primaryCompare;
      }
      return left.index - right.index;
    });
    return indexed.map(({ item }) => item);
  }, [pointsList, labelMode, sortMode]);

  const load = () => {
    let cancelled = false;
    setLoadError('');
    api.get<Point>(`/api/points/${pointId}`).then((data) => {
      if (cancelled) return;
      setPoint(data);
      setForm(toPointForm(data));
    }).catch((err) => {
      if (!cancelled) setLoadError((err as Error).message);
    });
    api.get<PointMeasurementRow[]>(`/api/points/${pointId}/measurement-rows`).then((data) => {
      if (cancelled) return;
      const editableRows = toEditableRows(data);
      setRows(editableRows);
      setRowSnapshot(editableRows);
      setDeletedMeasurementIds([]);
    }).catch((err) => {
      if (!cancelled) setLoadError((err as Error).message);
    });
    api.get<TrendItem[]>(`/api/points/${pointId}/trend`).then((data) => {
      if (cancelled) return;
      setTrend(data);
    }).catch((err) => {
      if (!cancelled) setLoadError((err as Error).message);
    });
    return () => {
      cancelled = true;
    };
  };

  useEffect(() => load(), [pointId, loadRetryKey]);

  useEffect(() => {
    const nextEditMode = searchParams.get('edit') === '1';
    setEditMode(nextEditMode);
  }, [searchParams]);

  useEffect(() => {
    if (!editMode) return undefined;
    function handlePaste(event: ClipboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      const items = Array.from(event.clipboardData?.items ?? []);
      const imageItem = items.find((item) => item.type.startsWith('image/'));
      const file = imageItem?.getAsFile();
      if (!file) return;
      event.preventDefault();
      uploadImage(file);
    }
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [editMode, pointId]);

  function toggleEditMode() {
    if (editMode && point) {
      const hasUnsavedChanges = (
        !isSameValue(form, toPointForm(point)) ||
        !isSameValue(rows, rowSnapshot) ||
        deletedMeasurementIds.length > 0
      );
      if (hasUnsavedChanges && !window.confirm('当前点位有未保存修改，确认退出编辑模式？')) return;
      setForm(toPointForm(point));
      setRows(rowSnapshot);
      setDeletedMeasurementIds([]);
    }
    const next = !editMode;
    setEditMode(next);
    setSearchParams(next ? { edit: '1' } : {});
  }

  function updateRow(localKey: string, patch: Partial<EditableMeasurementRow>) {
    setRows((current) => current.map((row) => (row.localKey === localKey ? { ...row, ...patch } : row)));
  }

  function addRow() {
    setRows((current) => [
      ...current,
      {
        localKey: `new-${Date.now()}`,
        run_name: '',
        cycle_count: '',
        max_strain_ue: '',
        min_strain_ue: '',
        amplitude_strain_ue: null,
        stress_amplitude_mpa: null,
        is_abnormal: false,
        abnormal_reason: '',
        remark: '',
      },
    ]);
  }

  function removeRow(row: EditableMeasurementRow) {
    if (row.id) setDeletedMeasurementIds((current) => [...current, row.id as number]);
    setRows((current) => current.filter((item) => item.localKey !== row.localKey));
  }

  async function uploadImage(file?: File | null) {
    if (!file || !pointId) return;
    setBusy(true);
    setMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post(`/api/points/${pointId}/media`, formData);
      load();
      setMessage('图片已上传。');
      setMessageError(false);
    } catch (err) {
      setMessage(`上传失败：${(err as Error).message}`);
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  }

  async function deleteImage(mediaId: number) {
    if (!pointId) return;
    setBusy(true);
    setMessage('');
    try {
      await api.delete(`/api/points/${pointId}/media/${mediaId}`);
      load();
      setMessage('图片已删除。');
      setMessageError(false);
    } catch (err) {
      setMessage(`删除失败：${(err as Error).message}`);
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!pointId) return;
    const invalidRow = rows.find((row) => integerOrNull(row.cycle_count) == null);
    if (invalidRow) {
      setMessage('保存失败：循环次数必须填写为整数。');
      setMessageError(true);
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      await api.put<Point>(`/api/points/${pointId}`, {
        ...form,
        resistance_ohm: numberOrNull(form.resistance_ohm),
      });
      await api.put<PointMeasurementRow[]>(`/api/points/${pointId}/measurement-rows`, {
        deleted_measurement_ids: deletedMeasurementIds,
        measurements: rows.map((row) => ({
          id: row.id,
          run_name: row.run_name || undefined,
          cycle_count: integerOrNull(row.cycle_count) as number,
          max_strain_ue: numberOrNull(row.max_strain_ue),
          min_strain_ue: numberOrNull(row.min_strain_ue),
          is_abnormal: row.is_abnormal,
          abnormal_reason: row.abnormal_reason || null,
          remark: row.remark || null,
        })),
      });
      load();
      setMessage('点位信息已保存。');
      setMessageError(false);
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
      setMessageError(true);
    } finally {
      setBusy(false);
    }
  }

  if (!point && loadError) {
    return (
      <div className="empty panel">
        <p>点位数据加载失败：{loadError}</p>
        <button className="button primary" onClick={() => setLoadRetryKey((key) => key + 1)}>重试</button>
      </div>
    );
  }
  if (!point) return <div className="empty">加载中...</div>;

  const sortedTrend = [...trend].sort((left, right) => left.cycle_count - right.cycle_count || left.run_id - right.run_id);
  const latestTrend = sortedTrend[sortedTrend.length - 1];
  const abnormalCount = rows.filter((row) => row.is_abnormal).length;

  return (
    <section className="point-detail-page">
      {showPromptBanner && (
        <div className="point-prompt-banner alert ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0, padding: '10px 16px', borderRadius: 8 }}>
          <span>💡 提示：点击页面左上角点位编号或名称，即可展开当前项目的点位列表并进行快速切换。</span>
          <button className="button" style={{ padding: '2px 8px', minHeight: 'auto', background: 'transparent', border: 'none', color: 'inherit' }} onClick={() => setShowPromptBanner(false)}>
            <X size={14} />
          </button>
        </div>
      )}

      <div className="page-head point-detail-head">
        <div>
          <div 
            className={`point-detail-selector ${isOpen ? 'open' : ''}`}
          >
            <div className="point-selector-trigger" onClick={() => setIsOpen(!isOpen)}>
              <h1>{point.point_id} · {point.point_name}</h1>
              <span className="dropdown-arrow">▼</span>
            </div>
            {isOpen && (
              <div className="point-selector-dropdown">
                <div className="point-selector-controls">
                  <div className="legend-mode-toggle" role="group" aria-label="图例主显示字段">
                    <button
                      type="button"
                      className={labelMode === 'point_id' ? 'active' : ''}
                      onClick={() => setLabelMode('point_id')}
                    >
                      ID
                    </button>
                    <button
                      type="button"
                      className={labelMode === 'point_name' ? 'active' : ''}
                      onClick={() => setLabelMode('point_name')}
                    >
                      名称
                    </button>
                  </div>
                  <label className="legend-sort-select">
                    <span>排序</span>
                    <select 
                      value={sortMode} 
                      onChange={(event) => setSortMode(event.target.value as LegendSortMode)}
                      style={{ height: 26, fontSize: 12, borderRadius: 4, border: '1px solid var(--border-color)', padding: '0 4px' }}
                    >
                      <option value="source">默认顺序</option>
                      <option value="primary_asc">{(labelMode === 'point_id' ? '点位编号' : '点位名称')}自然升序</option>
                      <option value="primary_desc">{(labelMode === 'point_id' ? '点位编号' : '点位名称')}自然降序</option>
                      <option value="latest_desc">最新应力降序</option>
                    </select>
                  </label>
                </div>
                <div className="point-selector-list">
                  {sortedPoints.map((p) => {
                    const isActive = p.id === point.id;
                    const latest = p.latest_measurement?.stress_amplitude_mpa;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={`point-selector-item ${isActive ? 'active' : ''}`}
                        onClick={() => {
                          setIsOpen(false);
                          navigate(`/points/${p.id}`);
                        }}
                      >
                        <span className="point-text">
                          <strong>{labelMode === 'point_id' ? p.point_id : p.point_name}</strong>
                          <small>{labelMode === 'point_id' ? p.point_name : p.point_id}</small>
                        </span>
                        {latest != null && (
                          <span className="point-val">{latest.toFixed(1)} MPa</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <p style={{ marginTop: 8 }}>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</p>
        </div>
        <div className="actions">
          {editMode && <button className="button primary" disabled={busy} onClick={saveAll}><Save size={18} />保存</button>}
          <button className="button" onClick={toggleEditMode}>{editMode ? <X size={18} /> : <Pencil size={18} />}{editMode ? '退出编辑' : '编辑模式'}</button>
          <button
            className="button"
            type="button"
            onClick={() => {
              setSelectedProjectId(point.project_db_id);
              navigate('/');
            }}
          >
            返回项目
          </button>
        </div>
      </div>

      {message && <div className={messageError ? 'alert danger' : 'alert ok'}>{message}</div>}

      <div className="point-detail-summary">
        <div><span>最新循环次数</span><strong>{latestTrend?.cycle_count ?? '-'}</strong></div>
        <div><span>最新应力幅</span><strong>{latestTrend?.stress_amplitude_mpa?.toFixed(2) ?? '-'} MPa</strong></div>
        <div><span>异常记录</span><strong>{abnormalCount}</strong></div>
        <div><span>照片数量</span><strong>{point.media_files.length}</strong></div>
      </div>

      <div className="detail-grid point-detail-top-grid">
        <div className="panel">
          <h2>点位信息</h2>
          {editMode ? (
            <div className="point-edit-grid">
              <label>点位编号<input value={form.point_id} onChange={(e) => setForm({ ...form, point_id: e.target.value })} /></label>
              <label>点位名称<input value={form.point_name} onChange={(e) => setForm({ ...form, point_name: e.target.value })} /></label>
              <label>点位类型
                <select value={form.point_type} onChange={(e) => setForm({ ...form, point_type: e.target.value })}>
                  <option value="strain">应变</option>
                  <option value="temperature">温度</option>
                  <option value="displacement">位移</option>
                  <option value="pressure">压力</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label>部件<input value={form.component} onChange={(e) => setForm({ ...form, component: e.target.value })} /></label>
              <label>方位
                <select value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value })}>
                  <option value="">未填写</option>
                  <option value="left">left</option>
                  <option value="right">right</option>
                  <option value="front">front</option>
                  <option value="rear">rear</option>
                  <option value="center">center</option>
                </select>
              </label>
              <label>方向
                <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
                  <option value="">未填写</option>
                  <option value="X">X</option>
                  <option value="Y">Y</option>
                  <option value="Z">Z</option>
                  <option value="45">45</option>
                  <option value="-45">-45</option>
                </select>
              </label>
              <label>桥路类型
                <select value={form.bridge_type} onChange={(e) => setForm({ ...form, bridge_type: e.target.value })}>
                  <option value="">未填写</option>
                  <option value="quarter">quarter</option>
                  <option value="half">half</option>
                  <option value="full">full</option>
                  <option value="other">other</option>
                </select>
              </label>
              <label>电阻<input type="number" value={form.resistance_ohm} onChange={(e) => setForm({ ...form, resistance_ohm: e.target.value })} /></label>
              <label>安装状态
                <select value={form.install_status} onChange={(e) => setForm({ ...form, install_status: e.target.value })}>
                  <option value="planned">planned</option>
                  <option value="installed">installed</option>
                  <option value="removed">removed</option>
                  <option value="damaged">damaged</option>
                  <option value="abandoned">abandoned</option>
                </select>
              </label>
              <label>检查状态
                <select value={form.check_status} onChange={(e) => setForm({ ...form, check_status: e.target.value })}>
                  <option value="">未填写</option>
                  <option value="unchecked">unchecked</option>
                  <option value="ok">ok</option>
                  <option value="warning">warning</option>
                  <option value="failed">failed</option>
                </select>
              </label>
              <label className="wide">位置描述<textarea rows={3} value={form.position_description} onChange={(e) => setForm({ ...form, position_description: e.target.value })} /></label>
              <label className="wide">备注<textarea rows={3} value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} /></label>
            </div>
          ) : (
            <>
              <div className="kv-grid compact">
                <div><span>点位类型</span><strong>{point.point_type}</strong></div>
                <div><span>方位</span><strong>{point.side || '-'}</strong></div>
                <div><span>电阻</span><strong>{point.resistance_ohm ?? '-'}</strong></div>
                <div><span>安装状态</span><strong>{point.install_status}</strong></div>
                <div><span>检查状态</span><strong>{point.check_status || '-'}</strong></div>
              </div>
              <p>{point.position_description || '未填写位置描述'}</p>
              <p className="muted">{point.remark || '无备注'}</p>
            </>
          )}
        </div>

        <div className="panel">
          <div className="section-head">
            <h2>照片</h2>
            {editMode && (
              <label className="button file-button">
                <Upload size={18} />
                上传图片
                <input type="file" accept="image/*" disabled={busy} onChange={(e) => uploadImage(e.target.files?.[0])} />
              </label>
            )}
          </div>
          {editMode && <div className="template-note"><ImagePlus size={18} />可选择图片文件，也可以直接粘贴剪贴板中的图片。</div>}
          <div className="photo-grid">
            {point.media_files.map((media) => (
              <div className="photo-item" key={media.id}>
                <button className="photo-button" onClick={() => setPreviewUrl(mediaUrl(media.id))}>
                  <img src={mediaUrl(media.id)} alt={media.remark || media.filename} />
                  <span>{media.type} · {media.filename}</span>
                </button>
                {editMode && <button className="icon-button danger-text photo-delete" disabled={busy} onClick={() => deleteImage(media.id)} title="删除图片"><Trash2 size={16} /></button>}
              </div>
            ))}
            {!point.media_files.length && <div className="empty">暂无图片</div>}
          </div>
        </div>
      </div>

      <div className="panel point-trend-panel">
        <div className="section-head point-trend-head">
          <div>
            <h2>趋势图</h2>
            <p className="hint">Ctrl+滚轮横向缩放 · Shift+滚轮左右平移 · 拖拽底部滑块选取区间</p>
          </div>
          <label className="point-metric-select">
            <span>显示指标</span>
            <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              <option value="max_strain_ue">最大应变</option>
              <option value="min_strain_ue">最小应变</option>
              <option value="amplitude_strain_ue">应变幅</option>
              <option value="stress_amplitude_mpa">应力幅</option>
            </select>
          </label>
        </div>
        <TrendChart data={trend} metric={metric} />
      </div>

      <div className="detail-grid point-detail-meta-grid">
        <div className="panel">
          <h2>通道信息</h2>
          {point.channels.map((channel) => (
            <div className="kv-grid compact" key={channel.id}>
              <div><span>设备</span><strong>{channel.device || '-'}</strong></div>
              <div><span>通道</span><strong>{channel.channel_name || '-'}</strong></div>
              <div><span>单位</span><strong>{channel.unit || '-'}</strong></div>
              <div><span>采样率</span><strong>{channel.sample_rate_hz ?? '-'}</strong></div>
            </div>
          ))}
          {!point.channels.length && <div className="empty">暂无通道信息</div>}
        </div>
        <div className="panel">
          <h2>CAE 映射</h2>
          {point.cae_mappings?.map((item) => (
            <div className="kv-grid compact" key={item.id}>
              <div><span>CAE 点</span><strong>{item.cae_point_id || '-'}</strong></div>
              <div><span>部件</span><strong>{item.cae_component || '-'}</strong></div>
              <div><span>结果</span><strong>{item.cae_result_type || '-'}</strong></div>
              <div><span>危险等级</span><strong>{item.danger_level || '-'}</strong></div>
            </div>
          ))}
          {!point.cae_mappings?.length && <div className="empty">暂无 CAE 映射</div>}
        </div>
      </div>

      <div className="panel point-data-panel">
        <div className="section-head">
          <h2>测试数据</h2>
          {editMode && <button className="button" onClick={addRow}><Plus size={18} />新增循环</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>轮次</th><th>循环次数</th><th>最大应变</th><th>最小应变</th><th>应变幅</th><th>应力幅</th><th>异常</th><th>原因</th>{editMode && <th>操作</th>}</tr></thead>
            <tbody>
              {rows.map((row) => {
                const max = numberOrNull(row.max_strain_ue);
                const min = numberOrNull(row.min_strain_ue);
                const preview = calculateStressPreview(max, min, stressFormula);
                const amplitude = preview?.amplitude ?? null;
                const stress = preview ? preview.stress ?? row.stress_amplitude_mpa ?? null : null;
                return (
                  <tr key={row.localKey}>
                    <td>{editMode ? <input value={row.run_name} onChange={(e) => updateRow(row.localKey, { run_name: e.target.value })} /> : row.run_name}</td>
                    <td>{editMode ? <input type="number" value={row.cycle_count} onChange={(e) => updateRow(row.localKey, { cycle_count: e.target.value })} /> : row.cycle_count}</td>
                    <td>{editMode ? <input type="number" value={row.max_strain_ue} onChange={(e) => updateRow(row.localKey, { max_strain_ue: e.target.value })} /> : row.max_strain_ue || '-'}</td>
                    <td>{editMode ? <input type="number" value={row.min_strain_ue} onChange={(e) => updateRow(row.localKey, { min_strain_ue: e.target.value })} /> : row.min_strain_ue || '-'}</td>
                    <td>{amplitude == null ? '-' : amplitude.toFixed(2)}</td>
                    <td>{stress == null ? '-' : stress.toFixed(2)}</td>
                    <td>{editMode ? <input type="checkbox" checked={row.is_abnormal} onChange={(e) => updateRow(row.localKey, { is_abnormal: e.target.checked })} /> : <StatusPill value={row.is_abnormal} tone={row.is_abnormal ? 'danger' : 'ok'} />}</td>
                    <td>{editMode ? <input value={row.abnormal_reason} onChange={(e) => updateRow(row.localKey, { abnormal_reason: e.target.value })} /> : row.abnormal_reason || '-'}</td>
                    {editMode && <td><button className="icon-button danger-text" onClick={() => removeRow(row)} title="删除循环"><Trash2 size={16} /></button></td>}
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={editMode ? 9 : 8} className="empty">暂无测试记录</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

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

      {showFirstTimeModal && (
        <div className="modal-backdrop" onClick={handleCloseFirstTimeModal} style={{ zIndex: 1000 }}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400, padding: 24, borderRadius: 12, textAlign: 'center' }}>
            <h2 style={{ marginBottom: 16 }}>💡 点位快速导航功能启用说明</h2>
            <p style={{ lineHeight: 1.6, color: 'var(--text-main)', marginBottom: 20 }}>
              为优化点位数据切换效率，系统已在详情页左上角集成“点位快速切换导航窗”。<br />
              点击页面左上角的点位编号与名称，即可展开当前项目下属的所有测点列表，以供快速检索与详情切换。
            </p>
            <button className="button primary" onClick={handleCloseFirstTimeModal} style={{ width: '100%' }}>
              我知道了
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
