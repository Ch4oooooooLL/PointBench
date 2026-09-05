import { FileUp, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { TaskStartResult } from '../types';
import { waitForTask } from '../utils/taskProgress';

interface FemUploadBoxProps {
  projectId: number;
  /** 任务成功后回调（调用方负责刷新自身模型数据）。 */
  onUploaded: () => void;
  /** 失败/异常信息回调。 */
  onError: (message: string) => void;
  /** 该项目已存在 FEM 模型时传 true，展示「重新导入」文案。 */
  replace?: boolean;
  /** 是否展示“后台进行、右下角查看进度”提示，默认展示。 */
  showHint?: boolean;
}

/**
 * FEM 模型文件上传框：选择 .fem/.dat 或整个文件夹，上传后启动后端
 * 解析 + 渲染任务（进度显示在全局右下角悬浮窗），成功回调 onUploaded。
 */
export function FemUploadBox({ projectId, onUploaded, onError, replace = false, showHint = true }: FemUploadBoxProps) {
  const [busy, setBusy] = useState(false);

  async function upload(files?: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length || busy) return;
    setBusy(true);
    const form = new FormData();
    for (const file of list) {
      form.append('files', file, file.webkitRelativePath || file.name);
    }
    try {
      const started = await api.post<TaskStartResult>(`/api/projects/${projectId}/fem`, form);
      const snapshot = await waitForTask(started.task_id, 'FEM 模型解析');
      if (snapshot.status === 'succeeded') {
        onUploaded();
      } else {
        onError(snapshot.message || 'FEM 模型解析失败，请检查文件内容');
      }
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="upload-grid">
        <label className="upload-box">
          <FileUp size={28} />
          <strong>{busy ? '解析渲染中…' : replace ? '重新导入 .fem 文件' : '选择 .fem 文件'}</strong>
          <span>支持 .fem / .dat，可多选</span>
          <input type="file" accept=".fem,.dat,.inc" multiple disabled={busy} onChange={(event) => upload(event.target.files)} />
        </label>
        <label className="upload-box">
          <FolderOpen size={28} />
          <strong>{busy ? '解析渲染中…' : replace ? '重新导入模型文件夹' : '选择模型文件夹'}</strong>
          <span>文件夹内需包含主 .fem 文件</span>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => upload(event.target.files)}
            {...directoryInputProps}
          />
        </label>
      </div>
      {busy && showHint && (
        <p className="fem-upload-hint">文件解析与渲染在后台进行，进度见右下角悬浮窗；模型较大时请耐心等待。</p>
      )}
    </>
  );
}

const directoryInputProps = {
  directory: '',
  webkitdirectory: '',
} as Record<string, string>;
