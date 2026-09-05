import { Box, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { FemUploadBox } from '../components/FemUploadBox';
import { FemViewer } from '../components/FemViewer';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { FemModelPayload } from '../types';

/**
 * 模型预览：展示当前项目对应的 FEM 模型（一个项目一个模型）。
 *
 * 模型导入后会连同渲染产物一起持久化在项目目录，页面每次打开（含冷启动）
 * 直接读取产物展示，无需重新解析。再次导入 = 整体覆盖并重新解析渲染。
 */
export function FemPreviewPage() {
  const { selectedProject, selectedProjectId } = useAppContext();
  const [payload, setPayload] = useState<FemModelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState('');
  const [showEdges, setShowEdges] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);

  const loadModel = useCallback(async (projectId: number) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<FemModelPayload>(`/api/projects/${projectId}/fem`);
      setPayload(data);
    } catch (err) {
      setError(`读取模型失败：${(err as Error).message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setPayload(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setPayload(null);
    api
      .get<FemModelPayload>(`/api/projects/${selectedProjectId}/fem`)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err) => {
        if (!cancelled) setError(`读取模型失败：${(err as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  async function removeModel() {
    const project = selectedProject;
    if (!project) return;
    if (!window.confirm('确定删除当前项目的 FEM 模型？删除后需要重新导入 FEM 文件。')) return;
    setRemoving(true);
    setError('');
    try {
      await api.delete(`/api/projects/${project.id}/fem`);
      setPayload(null);
    } catch (err) {
      setError(`删除模型失败：${(err as Error).message}`);
    } finally {
      setRemoving(false);
    }
  }

  const handleUploaded = useCallback(() => {
    if (selectedProject) loadModel(selectedProject.id);
  }, [selectedProject, loadModel]);

  const handleUploadError = useCallback((message: string) => {
    setError(message);
  }, []);

  const stats = payload?.stats ?? null;
  const grouping = payload?.grouping ?? null;
  const hasModel = payload?.status === 'ready' && stats != null;
  const hasGrouping = grouping != null && grouping.coloring_mode !== 'none' && grouping.groups.length > 0;
  const noProject = !selectedProject;
  // 产物按 (artifact_version, updated_at) 标识；同一项目重新导入后 key 变化，
  // 强制 FemViewer 重新加载（GLB 下载地址相同但内容已替换）。
  const modelKey = hasModel
    ? `${selectedProjectId}:${payload.artifact_version ?? ''}:${payload.updated_at ?? ''}`
    : 'empty';

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>模型预览</h1>
          <p>导入并预览当前项目的 FEM 有限元模型（Nastran/OptiStruct），渲染结果随项目保存，每次打开直接展示。</p>
        </div>
        <ProjectSelector />
      </div>

      {error && <div className="alert danger">{error}</div>}

      {noProject ? (
        <div className="empty panel">请先在右上角选择一个项目（或导入项目 zip 后重试）。</div>
      ) : (
        <>
          <div className="alert warn">
            FEM 模型关联到当前项目：导入后解析并渲染，产物（模型文件 + 网格 + 统计信息）保存在项目目录，
            之后打开本页面或重新启动程序都能直接查看。若模型通过 <code>INCLUDE</code> 引用其他文件，
            请连同引用文件一起选择（「选择文件夹」可保留相对路径）。
          </div>

          {hasModel && (
            <div className="alert fem-included">
              当前项目已保存模型 <strong>{stats.source_name}</strong>
              {payload?.updated_at ? `（更新于 ${formatTime(payload.updated_at)}）` : ''}
              ，重新导入将整体覆盖当前模型。
            </div>
          )}

          <FemUploadBox
            projectId={selectedProject.id}
            replace={hasModel}
            onUploaded={handleUploaded}
            onError={handleUploadError}
          />

          {loading && !hasModel && (
            <div className="panel fem-loading">
              <div className="chart-loading-spinner" />
              <p>正在读取已保存的模型…</p>
            </div>
          )}

          {hasModel && (
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
                  {payload?.updated_at && (
                    <div>
                      <span>模型更新于</span>
                      <strong>{formatTime(payload.updated_at)}</strong>
                    </div>
                  )}
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
                  <div className="section-actions">
                    <button className="button" type="button" disabled={removing} onClick={() => loadModel(selectedProject.id)}>
                      <RefreshCw size={15} />
                      刷新
                    </button>
                    <button className="button danger-button" type="button" disabled={removing} onClick={removeModel}>
                      <Trash2 size={15} />
                      删除模型
                    </button>
                  </div>
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
                {payload?.glb_url && payload?.mapping_url ? (
                  <FemViewer
                    key={modelKey}
                    glbUrl={payload.glb_url}
                    mappingUrl={payload.mapping_url}
                    grouping={grouping}
                    showEdges={showEdges}
                    transparent={transparent}
                    colorByGroup={colorByGroup}
                  />
                ) : (
                  <div className="alert danger">模型产物缺失，请重新导入 FEM 文件。</div>
                )}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

function formatTime(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('zh-CN', { hour12: false });
    }
  }
  return value;
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
