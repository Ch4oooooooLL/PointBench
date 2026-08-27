import { Box, FileUp, FolderOpen } from 'lucide-react';
import { useState } from 'react';
import { api } from '../api/client';
import { FemViewer } from '../components/FemViewer';
import { FemPreviewResult } from '../types';

export function FemPreviewPage() {
  const [preview, setPreview] = useState<FemPreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileCount, setFileCount] = useState(0);

  async function upload(files?: FileList | null) {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(true);
    setError('');
    setPreview(null);
    setFileCount(list.length);
    const form = new FormData();
    for (const file of list) {
      form.append('files', file, file.webkitRelativePath || file.name);
    }
    try {
      setPreview(await api.post<FemPreviewResult>('/api/fem-preview/upload', form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const stats = preview?.stats;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>FEM 预览</h1>
          <p>上传 Nastran/OptiStruct 格式的 .fem 模型文件（可连同 INCLUDE 引用的配套文件一起选择），解析后在浏览器中三维预览。</p>
        </div>
      </div>
      <div className="alert warn">
        FEM 文件只包含几何与网格拓扑，本页面用于查看模型结构与单元信息；若模型通过 <code>INCLUDE</code> 引用其他文件，请连同引用文件一起上传（使用“选择文件夹”可自动保留相对路径）。
      </div>
      <div className="upload-grid">
        <label className="upload-box">
          <FileUp size={28} />
          <strong>{busy ? '处理中...' : '选择 .fem 文件'}</strong>
          <span>支持 .fem / .dat，可多选</span>
          <input type="file" accept=".fem,.dat,.inc" multiple disabled={busy} onChange={(event) => upload(event.target.files)} />
        </label>
        <label className="upload-box">
          <FolderOpen size={28} />
          <strong>{busy ? '处理中...' : '选择模型文件夹'}</strong>
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
      {error && <div className="alert danger">{error}</div>}
      {preview && stats && (
        <>
          <div className="panel">
            <div className="section-head">
              <h2>
                <Box size={18} />
                模型信息
              </h2>
              <span className="pill ok">{stats.source_name}</span>
            </div>
            <div className="kv-grid">
              <div>
                <span>节点数</span>
                <strong>{stats.node_count}</strong>
              </div>
              <div>
                <span>单元数</span>
                <strong>{stats.element_count}</strong>
              </div>
              <div>
                <span>三角形面片</span>
                <strong>{stats.triangle_count}</strong>
              </div>
              <div>
                <span>上传文件数</span>
                <strong>{fileCount}</strong>
              </div>
            </div>
            <h3 className="fem-stats-title">单元类型分布</h3>
            <div className="kv-grid compact">
              {Object.entries(stats.element_types).map(([type, count]) => (
                <div key={type}>
                  <span>{type}</span>
                  <strong>{count}</strong>
                </div>
              ))}
            </div>
            {stats.ignored_cards && Object.keys(stats.ignored_cards).length > 0 && (
              <div className="alert warn fem-ignored">
                解析时忽略的卡片：{Object.entries(stats.ignored_cards).map(([card, count]) => `${card}(${count})`).join('、')}
              </div>
            )}
            {stats.included_files.length > 0 && (
              <div className="alert fem-included">
                已展开 INCLUDE 文件：{stats.included_files.join('、')}
              </div>
            )}
          </div>
          <div className="panel fem-viewer-panel">
            <div className="section-head">
              <h2>三维预览</h2>
              <span className="pill">{preview.stats.triangle_count} 面片</span>
            </div>
            <FemViewer glbUrl={preview.glb_url} mappingUrl={preview.mapping_url} />
          </div>
        </>
      )}
    </section>
  );
}

const directoryInputProps = {
  directory: '',
  webkitdirectory: '',
} as Record<string, string>;
