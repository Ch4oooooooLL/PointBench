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
  const [showEdges, setShowEdges] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);

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
  const grouping = preview?.grouping ?? null;
  const hasGrouping = grouping != null && grouping.coloring_mode !== 'none' && grouping.groups.length > 0;

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
            <div className="viewer-options">
              <ToggleSwitch checked={showEdges} onChange={setShowEdges} label="显示网格边界" />
              <ToggleSwitch checked={transparent} onChange={setTransparent} label="半透明显示" />
              <ToggleSwitch checked={colorByGroup} onChange={setColorByGroup} label="按分组着色" disabled={!hasGrouping} />
            </div>
            {hasGrouping && (
              <div className="fem-legend">
                <span className="fem-legend-title">
                  {grouping.coloring_mode === 'component' ? '组件' : '属性'}（{grouping.groups.length}）
                </span>
                <div className="fem-legend-items">
                  {grouping.groups.map((group) => (
                    <span key={group.id} className="fem-legend-item">
                      <i style={{ backgroundColor: group.color }} />
                      {group.name}
                      <em>{group.element_count}</em>
                    </span>
                  ))}
                </div>
              </div>
            )}
            <FemViewer
              glbUrl={preview.glb_url}
              mappingUrl={preview.mapping_url}
              grouping={grouping}
              showEdges={showEdges}
              transparent={transparent}
              colorByGroup={colorByGroup}
            />
          </div>
        </>
      )}
    </section>
  );
}

function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <div
      className={`toggle-switch${checked ? ' active' : ''}${disabled ? ' disabled' : ''}`}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      role="switch"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(event) => {
        if (disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onChange(!checked);
        }
      }}
    >
      <span className="toggle-switch-track">
        <span className="toggle-switch-thumb" />
      </span>
      <span className="toggle-switch-label">{label}</span>
    </div>
  );
}

const directoryInputProps = {
  directory: '',
  webkitdirectory: '',
} as Record<string, string>;
