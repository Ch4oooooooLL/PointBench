import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api/client';
import { FemModelPayload, TaskStartResult } from '../types';
import { waitForTask } from '../utils/taskProgress';

interface ExportProjectDialogProps {
  projectId: number;
  projectName: string;
  onClose: () => void;
}

export function ExportProjectDialog({ projectId, projectName, onClose }: ExportProjectDialogProps) {
  const [includeDewesoft, setIncludeDewesoft] = useState(true);
  const [includeFem, setIncludeFem] = useState(true);
  const [hasFem, setHasFem] = useState(false);
  const [checkingFem, setCheckingFem] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .get<FemModelPayload>(`/api/projects/${projectId}/fem`, { silent: true })
      .then((data) => {
        if (cancelled) return;
        setHasFem(data.status === 'ready');
        setIncludeFem(data.status === 'ready');
      })
      .catch(() => {
        if (!cancelled) setHasFem(false);
      })
      .finally(() => {
        if (!cancelled) setCheckingFem(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function confirmExport() {
    setBusy(true);
    setError('');
    try {
      const started = await api.post<TaskStartResult>(
        `/api/projects/${projectId}/export`,
        { include_dewesoft: includeDewesoft, include_fem: includeFem },
        { silent: true },
      );
      const snapshot = await waitForTask(started.task_id, '项目导出');
      if (snapshot.status === 'succeeded') {
        const url = snapshot.result?.download_url;
        if (url) {
          await downloadFile(url, snapshot.result?.filename ?? `${projectName}.zip`);
          onClose();
          return;
        }
        throw new Error('导出任务未返回下载地址');
      }
      throw new Error(snapshot.message || '项目导出失败');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !busy && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2 id="export-dialog-title">导出项目</h2>
            <p>打包「{projectName}」为完整导出 zip，可勾选需要包含的数据类型。</p>
          </div>
          <button className="button" type="button" disabled={busy} onClick={onClose}>取消</button>
        </div>

        <div className="export-options">
          <label className="export-option">
            <input type="checkbox" checked={includeDewesoft} onChange={(event) => setIncludeDewesoft(event.target.checked)} />
            <div>
              <strong>Dewesoft 数据</strong>
              <span>包含 dewesoft/ 目录及对应清单项。</span>
            </div>
          </label>
          <label className={`export-option${!hasFem && !checkingFem ? ' disabled' : ''}`}>
            <input
              type="checkbox"
              checked={includeFem}
              disabled={!hasFem || checkingFem}
              onChange={(event) => setIncludeFem(event.target.checked)}
            />
            <div>
              <strong>FEM 模型文件</strong>
              <span>
                {checkingFem
                  ? '正在检查该项目是否已导入 FEM 模型…'
                  : hasFem
                    ? '包含 fem/ 目录（源文件、渲染网格与统计信息）。'
                    : '该项目未导入 FEM 模型，无法勾选。'}
              </span>
            </div>
          </label>
        </div>

        {error && <div className="alert danger">{error}</div>}

        <div className="export-dialog-footer">
          <span className="export-hint">照片、裂纹记录、测量数据与 manifest.json 始终随包导出。</span>
          <button className="button primary" type="button" disabled={busy || checkingFem} onClick={confirmExport}>
            <Download size={18} />
            {busy ? '正在后台打包…' : '开始导出'}
          </button>
        </div>
        {busy && <p className="fem-upload-hint">打包进度见右下角悬浮窗，完成后将自动下载 zip。</p>}
      </div>
    </div>
  );
}
