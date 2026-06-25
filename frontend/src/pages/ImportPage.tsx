import { CheckCircle2, FileArchive, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { ImportPreview } from '../types';

export function ImportPage() {
  const navigate = useNavigate();
  const { refreshProjects, setSelectedProjectId } = useAppContext();
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    setPreview(null);
    const form = new FormData();
    form.append('file', file);
    try {
      setPreview(await api.post<ImportPreview>('/api/import/preview', form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadFolder(fileList?: FileList | null) {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    setBusy(true);
    setError('');
    setPreview(null);
    const form = new FormData();
    for (const file of files) {
      form.append('files', file, file.webkitRelativePath || file.name);
    }
    try {
      setPreview(await api.post<ImportPreview>('/api/import/preview-folder', form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await api.post<{ project_db_id: number }>('/api/import/confirm', {
        temporary_import_id: preview.temporary_import_id,
      });
      await refreshProjects();
      setSelectedProjectId(result.project_db_id);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>导入项目</h1>
          <p>上传 Android App 导出的 zip 数据包，或选择手动解压后的非嵌套文件夹，先预览校验，再确认写入数据库。</p>
        </div>
      </div>
      <div className="alert warn">
        公司内网文档加密可能导致浏览器上传到密文字节，从而出现 zip 不可读取。遇到这种情况，请先手动打开或解压为明文文件夹，再使用“选择解压文件夹”导入。
      </div>
      <div className="upload-grid">
        <label className="upload-box">
          <FileArchive size={28} />
          <strong>{busy ? '处理中...' : '选择 zip 文件'}</strong>
          <input type="file" accept=".zip" disabled={busy} onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        <label className="upload-box">
          <FolderOpen size={28} />
          <strong>{busy ? '处理中...' : '选择解压文件夹'}</strong>
          <span>文件夹根目录需包含 manifest.json</span>
          <input
            type="file"
            multiple
            disabled={busy}
            onChange={(event) => uploadFolder(event.target.files)}
            {...directoryInputProps}
          />
        </label>
      </div>
      {error && <div className="alert danger">{error}</div>}
      {preview && (
        <div className="panel">
          <div className="section-head">
            <h2>导入预览</h2>
            <span className={preview.can_import ? 'pill ok' : 'pill danger'}>{preview.can_import ? '允许导入' : '禁止导入'}</span>
          </div>
          <div className="kv-grid">
            <div><span>项目名称</span><strong>{preview.project_name || '-'}</strong></div>
            <div><span>项目 ID</span><strong>{preview.project_id || '-'}</strong></div>
            <div><span>导出 ID</span><strong>{preview.export_id || '-'}</strong></div>
            <div><span>点位数量</span><strong>{preview.point_count}</strong></div>
            <div><span>照片数量</span><strong>{preview.photo_count}</strong></div>
            <div><span>临时导入 ID</span><strong>{preview.temporary_import_id}</strong></div>
          </div>
          <IssueList title="重复点位编号" items={preview.duplicate_point_ids} />
          <IssueList title="重复通道名" items={preview.duplicate_channel_names} />
          <IssueList title="缺失文件" items={preview.missing_files} />
          <IssueList title="警告" items={preview.warnings} />
          <IssueList title="错误" items={preview.errors} danger />
          <button className="button primary" disabled={!preview.can_import || busy} onClick={confirmImport}>
            <CheckCircle2 size={18} />
            确认导入
          </button>
        </div>
      )}
    </section>
  );
}

const directoryInputProps = {
  directory: '',
  webkitdirectory: '',
} as Record<string, string>;

function IssueList({ title, items, danger }: { title: string; items: string[]; danger?: boolean }) {
  if (!items.length) return null;
  return (
    <div className={`alert ${danger ? 'danger' : 'warn'}`}>
      <strong>{title}</strong>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
