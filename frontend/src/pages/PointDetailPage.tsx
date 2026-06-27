import { ImagePlus, Pencil, Plus, Save, Trash2, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { TrendChart } from '../components/TrendChart';
import { Point, PointMeasurementRow, TrendItem } from '../types';

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

export function PointDetailPage() {
  const { pointId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [point, setPoint] = useState<Point | null>(null);
  const [form, setForm] = useState<PointForm>(toPointForm(null));
  const [rows, setRows] = useState<EditableMeasurementRow[]>([]);
  const [deletedMeasurementIds, setDeletedMeasurementIds] = useState<number[]>([]);
  const [trend, setTrend] = useState<TrendItem[]>([]);
  const [metric, setMetric] = useState<Metric>('amplitude_strain_ue');
  const [editMode, setEditMode] = useState(searchParams.get('edit') === '1');
  const [previewUrl, setPreviewUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    api.get<Point>(`/api/points/${pointId}`).then((data) => {
      setPoint(data);
      setForm(toPointForm(data));
    });
    api.get<PointMeasurementRow[]>(`/api/points/${pointId}/measurement-rows`).then((data) => {
      setRows(toEditableRows(data));
      setDeletedMeasurementIds([]);
    });
    api.get<TrendItem[]>(`/api/points/${pointId}/trend`).then(setTrend);
  };

  useEffect(load, [pointId]);

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
    } catch (err) {
      setMessage(`上传失败：${(err as Error).message}`);
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
    } catch (err) {
      setMessage(`删除失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveAll() {
    if (!pointId) return;
    const invalidRow = rows.find((row) => integerOrNull(row.cycle_count) == null);
    if (invalidRow) {
      setMessage('保存失败：循环次数必须填写为整数。');
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
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (!point) return <div className="empty">加载中...</div>;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{point.point_id} · {point.point_name}</h1>
          <p>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</p>
        </div>
        <div className="actions">
          {editMode && <button className="button primary" disabled={busy} onClick={saveAll}><Save size={18} />保存</button>}
          <button className="button" onClick={toggleEditMode}>{editMode ? <X size={18} /> : <Pencil size={18} />}{editMode ? '退出编辑' : '编辑模式'}</button>
          <Link className="button" to={`/projects/${point.project_db_id}`}>返回项目</Link>
        </div>
      </div>

      {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}

      <div className="detail-grid">
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

      <div className="panel">
        <div className="section-head">
          <h2>趋势图</h2>
          <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
            <option value="max_strain_ue">最大应变</option>
            <option value="min_strain_ue">最小应变</option>
            <option value="amplitude_strain_ue">应变幅</option>
            <option value="stress_amplitude_mpa">应力幅</option>
          </select>
        </div>
        <TrendChart data={trend} metric={metric} />
      </div>

      <div className="detail-grid">
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

      <div className="panel">
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
                const amplitude = max == null || min == null ? null : (max - min) / 2;
                return (
                  <tr key={row.localKey}>
                    <td>{editMode ? <input value={row.run_name} onChange={(e) => updateRow(row.localKey, { run_name: e.target.value })} /> : row.run_name}</td>
                    <td>{editMode ? <input type="number" value={row.cycle_count} onChange={(e) => updateRow(row.localKey, { cycle_count: e.target.value })} /> : row.cycle_count}</td>
                    <td>{editMode ? <input type="number" value={row.max_strain_ue} onChange={(e) => updateRow(row.localKey, { max_strain_ue: e.target.value })} /> : row.max_strain_ue || '-'}</td>
                    <td>{editMode ? <input type="number" value={row.min_strain_ue} onChange={(e) => updateRow(row.localKey, { min_strain_ue: e.target.value })} /> : row.min_strain_ue || '-'}</td>
                    <td>{amplitude == null ? '-' : amplitude.toFixed(2)}</td>
                    <td>{amplitude == null ? '-' : (amplitude * 0.206).toFixed(2)}</td>
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
    </section>
  );
}
