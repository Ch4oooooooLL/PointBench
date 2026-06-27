import { Camera, Clipboard, ImageOff, ImagePlus, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ClipboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { api, crackImageUrl, mediaUrl } from '../api/client';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { CrackRecord, Point, TestRun } from '../types';
import { PointRiskModal, type PointRow } from './ProjectRowsPage';

export function CrackRecordsPage() {
  const { selectedProject, selectedProjectId } = useAppContext();
  const [points, setPoints] = useState<Point[]>([]);
  const [testRuns, setTestRuns] = useState<TestRun[]>([]);
  const [records, setRecords] = useState<CrackRecord[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [previewRecord, setPreviewRecord] = useState<CrackRecord | null>(null);
  const [activePoint, setActivePoint] = useState<PointRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingPointId, setDeletingPointId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const loadProjectData = useCallback(async () => {
    if (!selectedProjectId) {
      setPoints([]);
      setTestRuns([]);
      setRecords([]);
      return;
    }
    setError('');
    try {
      const [pointData, runData, recordData] = await Promise.all([
        api.get<Point[]>(`/api/projects/${selectedProjectId}/points`),
        api.get<TestRun[]>(`/api/projects/${selectedProjectId}/test-runs`),
        api.get<CrackRecord[]>(`/api/projects/${selectedProjectId}/crack-records`),
      ]);
      setPoints(pointData);
      setTestRuns(runData);
      setRecords(recordData);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadProjectData();
  }, [loadProjectData, reloadKey]);

  useEffect(() => {
    setActivePoint(null);
    setPreviewRecord(null);
    setEditMode(false);
    setMessage('');
  }, [selectedProjectId]);

  const groupedStats = useMemo(() => {
    const pointCount = new Set(records.map((record) => record.point_db_id)).size;
    const cycleCount = new Set(records.map((record) => `${record.point_db_id}-${record.cycle_count}`)).size;
    return { pointCount, cycleCount };
  }, [records]);

  function refresh() {
    setReloadKey((key) => key + 1);
  }

  async function addPoint() {
    if (!selectedProjectId) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const point = await api.post<Point>(`/api/projects/${selectedProjectId}/points`);
      setActivePoint({ point, trend: [] });
      await loadProjectData();
      setMessage('点位已新增，可在弹窗中继续完善详情。');
    } catch (err) {
      setMessage(`新增点位失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function openPointEditor(point: Point) {
    setError('');
    try {
      const trend = await api.get<PointRow['trend']>(`/api/points/${point.id}/trend`);
      setActivePoint({ point, trend });
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function deletePoint(point: Point) {
    if (!window.confirm(`确认删除点位 ${point.point_id}？该点位的照片、循环数据和裂纹记录也会一并删除。`)) return;
    setDeletingPointId(point.id);
    setMessage('');
    setError('');
    try {
      await api.delete(`/api/points/${point.id}`);
      setActivePoint(null);
      setPreviewRecord(null);
      await loadProjectData();
      setMessage('点位已删除。');
    } catch (err) {
      setMessage(`删除点位失败：${(err as Error).message}`);
    } finally {
      setDeletingPointId(null);
    }
  }

  async function deleteRecord(record: CrackRecord) {
    if (!window.confirm(`确认删除 ${record.point_id} 在 ${record.cycle_count} 次的裂纹记录？`)) return;
    setDeletingId(record.id);
    setError('');
    try {
      await api.delete(`/api/crack-records/${record.id}`);
      setPreviewRecord(null);
      refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>裂纹记录</h1>
          <p>记录并浏览各点位在指定循环次数下的裂纹图片和备注。</p>
        </div>
        <div className="crack-page-actions">
          <ProjectSelector />
          <button className="button" onClick={refresh} disabled={!selectedProjectId}>
            <RefreshCw size={18} />
            刷新
          </button>
          {editMode && (
            <button className="button" onClick={addPoint} disabled={!selectedProjectId || busy}>
              <Plus size={18} />
              新增点位
            </button>
          )}
          <button className="button primary" onClick={() => setModalOpen(true)} disabled={!selectedProjectId || !points.length}>
            <Plus size={18} />
            记录裂纹
          </button>
          <button className="button" onClick={() => setEditMode((value) => !value)} disabled={!selectedProjectId}>
            {editMode ? <X size={18} /> : <Pencil size={18} />}
            {editMode ? '退出编辑' : '编辑模式'}
          </button>
        </div>
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {selectedProject && !points.length && <div className="empty panel">当前项目暂无点位，无法记录裂纹。</div>}
      {error && <div className="alert danger">{error}</div>}
      {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}

      {selectedProject && (
        <>
          <div className="metric-grid">
            <div><span>裂纹记录</span><strong>{records.length}</strong></div>
            <div><span>涉及点位</span><strong>{groupedStats.pointCount}</strong></div>
            <div><span>点位-循环组合</span><strong>{groupedStats.cycleCount}</strong></div>
            <div><span>当前项目</span><strong>{selectedProject.project_name}</strong></div>
          </div>

          {editMode && (
            <div className="panel crack-point-editor">
              <div className="section-head">
                <div>
                  <h2>点位管理</h2>
                  <p>点击点位进入详情编辑，可维护主信息、照片和循环数据。</p>
                </div>
                <button className="button" onClick={addPoint} disabled={busy}>
                  <Plus size={18} />
                  新增点位
                </button>
              </div>
              <div className="crack-point-grid">
                {points.map((point) => (
                  <div key={point.id} className="crack-point-card">
                    <button className="crack-point-open" type="button" onClick={() => openPointEditor(point)}>
                      <span className="crack-point-thumb">
                        {point.media_files[0] ? <img src={mediaUrl(point.media_files[0].id)} alt={point.point_name} /> : <ImageOff size={24} />}
                      </span>
                      <span className="crack-point-body">
                        <strong>{point.point_id} · {point.point_name}</strong>
                        <small>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</small>
                        <em>{records.filter((record) => record.point_db_id === point.id).length} 条裂纹记录</em>
                      </span>
                    </button>
                    <button
                      className="icon-button danger-text crack-point-delete"
                      type="button"
                      title="删除点位"
                      disabled={deletingPointId === point.id}
                      onClick={() => deletePoint(point)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {!points.length && <div className="empty">当前项目暂无点位</div>}
              </div>
            </div>
          )}

          <div className="crack-record-grid">
            {records.map((record) => (
              <button key={record.id} className="crack-card" type="button" onClick={() => setPreviewRecord(record)}>
                <img src={crackImageUrl(record.id)} alt={`${record.point_id} 裂纹`} />
                <span className="crack-card-body">
                  <span className="crack-title">
                    <strong>{record.point_id}</strong>
                    <em>{record.cycle_count} 次</em>
                  </span>
                  <span>{record.point_name}</span>
                  <small>{record.run_name || '手动循环次数'} · {formatDate(record.created_at)}</small>
                  {record.remark && <p>{record.remark}</p>}
                </span>
              </button>
            ))}
            {!records.length && <div className="empty panel">暂无裂纹记录，点击右上角“记录裂纹”开始录入。</div>}
          </div>
        </>
      )}

      {modalOpen && selectedProjectId && (
        <CrackRecordModal
          projectId={selectedProjectId}
          points={points}
          testRuns={testRuns}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            refresh();
          }}
        />
      )}

      {previewRecord && (
        <CrackDetailModal
          record={previewRecord}
          deleting={deletingId === previewRecord.id}
          onClose={() => setPreviewRecord(null)}
          onDelete={() => deleteRecord(previewRecord)}
        />
      )}

      {activePoint && (
        <PointRiskModal
          row={activePoint}
          editMode={editMode}
          deletingPoint={deletingPointId === activePoint.point.id}
          onClose={() => setActivePoint(null)}
          onChanged={loadProjectData}
          onDeletePoint={() => deletePoint(activePoint.point)}
        />
      )}
    </section>
  );
}

function CrackRecordModal({
  projectId,
  points,
  testRuns,
  onClose,
  onSaved,
}: {
  projectId: number;
  points: Point[];
  testRuns: TestRun[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pointId, setPointId] = useState(points[0]?.id ? String(points[0].id) : '');
  const [runId, setRunId] = useState(testRuns[0]?.id ? String(testRuns[0].id) : 'manual');
  const [manualCycle, setManualCycle] = useState(testRuns[0]?.cycle_count != null ? String(testRuns[0].cycle_count) : '');
  const [file, setFile] = useState<File | null>(null);
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pastedFile = Array.from(event.clipboardData.items)
      .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
      ?.getAsFile();
    if (!pastedFile) return;
    event.preventDefault();
    setFile(new File([pastedFile], pastedFile.name || `crack-${Date.now()}.png`, { type: pastedFile.type }));
  }

  async function save() {
    setError('');
    if (!pointId) {
      setError('请选择点位');
      return;
    }
    if (!file) {
      setError('请上传或粘贴裂纹图片');
      return;
    }
    if (runId === 'manual' && !manualCycle) {
      setError('请选择轮次或填写循环次数');
      return;
    }
    const body = new FormData();
    body.append('point_db_id', pointId);
    if (runId === 'manual') body.append('cycle_count', manualCycle);
    else body.append('test_run_id', runId);
    body.append('remark', remark);
    body.append('file', file);
    setSaving(true);
    try {
      await api.post<CrackRecord>(`/api/projects/${projectId}/crack-records`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal crack-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>记录裂纹</h2>
            <p>选择点位和循环次数后，上传或粘贴裂纹图片。</p>
          </div>
          <button className="button" onClick={onClose}>关闭</button>
        </div>

        {error && <div className="alert danger">{error}</div>}

        <div className="crack-form-grid">
          <label>
            点位
            <select value={pointId} onChange={(event) => setPointId(event.target.value)}>
              {points.map((point) => (
                <option key={point.id} value={point.id}>
                  {point.point_id} · {point.point_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            次数
            <select
              value={runId}
              onChange={(event) => {
                const nextRunId = event.target.value;
                setRunId(nextRunId);
                const selectedRun = testRuns.find((run) => String(run.id) === nextRunId);
                if (selectedRun) setManualCycle(String(selectedRun.cycle_count));
              }}
            >
              {testRuns.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.cycle_count} 次 · {run.run_name}
                </option>
              ))}
              <option value="manual">手动填写循环次数</option>
            </select>
          </label>
          {runId === 'manual' && (
            <label>
              循环次数
              <input type="number" min="0" value={manualCycle} onChange={(event) => setManualCycle(event.target.value)} />
            </label>
          )}
          <label className="wide">
            备注
            <textarea rows={4} value={remark} onChange={(event) => setRemark(event.target.value)} placeholder="裂纹位置、长度、观察条件等" />
          </label>
        </div>

        <div className="crack-upload" onPaste={handlePaste} tabIndex={0}>
          {previewUrl ? (
            <img src={previewUrl} alt="裂纹预览" />
          ) : (
            <div>
              <ImagePlus size={34} />
              <strong>上传或粘贴裂纹图片</strong>
              <span>点击选择图片，也可以聚焦此区域后直接粘贴截图</span>
            </div>
          )}
          <input
            type="file"
            accept="image/*"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            aria-label="上传裂纹图片"
          />
        </div>

        <div className="modal-actions">
          <div className="paste-hint">
            <Clipboard size={16} />
            支持从剪贴板粘贴图片
          </div>
          <button className="button primary" onClick={save} disabled={saving}>
            <Camera size={18} />
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CrackDetailModal({
  record,
  deleting,
  onClose,
  onDelete,
}: {
  record: CrackRecord;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal crack-detail-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>{record.point_id} 裂纹详情</h2>
            <p>{record.point_name} · {record.cycle_count} 次</p>
          </div>
          <div className="actions">
            <button className="button danger-text" disabled={deleting} onClick={onDelete}>
              <Trash2 size={18} />
              {deleting ? '删除中...' : '删除'}
            </button>
            <button className="button" onClick={onClose}>关闭</button>
          </div>
        </div>
        <img src={crackImageUrl(record.id)} alt={`${record.point_id} 裂纹详情`} />
        <div className="kv-grid compact">
          <div><span>点位</span><strong>{record.point_id}</strong></div>
          <div><span>点位名称</span><strong>{record.point_name}</strong></div>
          <div><span>循环次数</span><strong>{record.cycle_count}</strong></div>
          <div><span>轮次</span><strong>{record.run_name || '-'}</strong></div>
          <div><span>记录时间</span><strong>{formatDate(record.created_at)}</strong></div>
          <div><span>文件名</span><strong>{record.filename}</strong></div>
        </div>
        {record.remark && <div className="crack-remark">{record.remark}</div>}
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
