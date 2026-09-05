import { Box, FileUp, PencilLine, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { FemUploadBox } from '../components/FemUploadBox';
import { FemViewer } from '../components/FemViewer';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { FemGroupingData, FemModelPayload, FemPreviewStats, Point, PointElementBinding } from '../types';

/**
 * 模型预览：展示当前项目对应的 FEM 模型（一个项目一个模型）。
 *
 * 模型的导入、替换与渲染展示都在本页完成：
 * - 项目还没有 FEM 模型时，在本页直接导入（选择 .fem 文件 / 文件夹）；
 * - 已有模型或模型渲染失败时，在本页重新上传，即对该项目的 FEM 整体
 *   替换并重新解析渲染（后端产物原子替换，完成后视图自动刷新）。
 *
 * 点位绑定：把项目内的测试点位绑定到模型单元上——「编辑点位」进入绑定
 * 编辑（选点位 → 在模型上点单元 → 保存），「点位预览」开启后各点位名称
 * 以气泡悬浮在模型上，并用直线连到对应单元。
 */
export function FemPreviewPage() {
  const navigate = useNavigate();
  const { selectedProject, selectedProjectId } = useAppContext();
  const [payload, setPayload] = useState<FemModelPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showMesh, setShowMesh] = useState(false);
  const [showBoundary, setShowBoundary] = useState(false);
  const [transparent, setTransparent] = useState(false);
  const [colorByGroup, setColorByGroup] = useState(true);
  // 点位绑定与气泡预览
  const [bindings, setBindings] = useState<PointElementBinding[]>([]);
  const [pointPreview, setPointPreview] = useState(true);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pickedElement, setPickedElement] = useState<number | null>(null);

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

  const reloadBindings = useCallback(async (projectId: number) => {
    try {
      const data = await api.get<PointElementBinding[]>(`/api/projects/${projectId}/point-bindings`, { silent: true });
      setBindings(data);
    } catch {
      setBindings([]);
    }
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      setPayload(null);
      setBindings([]);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setPayload(null);
    setBindings([]);
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
    // 绑定列表失败不阻塞模型展示，按空列表处理。
    api
      .get<PointElementBinding[]>(`/api/projects/${selectedProjectId}/point-bindings`, { silent: true })
      .then((data) => {
        if (!cancelled) setBindings(data);
      })
      .catch(() => {
        if (!cancelled) setBindings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const stats = payload?.stats ?? null;
  const grouping = payload?.grouping ?? null;
  const hasModel = payload?.status === 'ready' && stats != null;
  const hasGrouping = grouping != null && grouping.coloring_mode !== 'none' && grouping.groups.length > 0;
  const noProject = !selectedProject;
  // 产物按 (artifact_version, updated_at) 标识；同一项目替换后 key 变化，
  // 强制 FemViewer 重新加载（GLB 下载地址相同但内容已替换）。
  const modelKey = hasModel
    ? `${selectedProjectId}:${payload.artifact_version ?? ''}:${payload.updated_at ?? ''}`
    : 'empty';

  // 模型替换后旧拾取结果失效；FemViewer 也随 key 重挂载。
  useEffect(() => {
    setPickedElement(null);
  }, [modelKey]);

  // 上传完成/失败后统一回到加载态重新读取最新模型状态
  const handleUploaded = useCallback(() => {
    if (selectedProjectId) {
      void loadModel(selectedProjectId);
      void reloadBindings(selectedProjectId);
    }
  }, [loadModel, reloadBindings, selectedProjectId]);
  const handleError = useCallback((message: string) => {
    setError(message);
  }, []);

  const toggleEditor = useCallback(() => {
    setEditorOpen((open) => !open);
    setPickedElement(null);
  }, []);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>模型预览</h1>
          <p>查看当前项目已保存的 FEM 有限元模型（Nastran/OptiStruct），渲染结果随项目保存，每次打开直接展示。</p>
        </div>
        <ProjectSelector />
      </div>

      {error && <div className="alert danger">{error}</div>}

      {noProject ? (
        <div className="empty panel">请先在右上角选择一个项目（或导入项目 zip 后重试）。</div>
      ) : loading && !hasModel ? (
        <div className="panel fem-loading">
          <div className="chart-loading-spinner" />
          <p>正在读取已保存的模型…</p>
        </div>
      ) : hasModel ? (
        <>
          {/* 三维预览：展示控件常驻顶部 */}
          <div className="panel fem-viewer-panel">
            <div className="section-head">
              <h2>三维预览</h2>
              <div className="section-actions">
                <button className={`button${editorOpen ? ' primary' : ''}`} type="button" onClick={toggleEditor}>
                  <PencilLine size={15} />
                  {editorOpen ? '退出点位编辑' : '编辑点位'}
                </button>
                <button className="button" type="button" onClick={() => loadModel(selectedProject.id)}>
                  <RefreshCw size={15} />
                  刷新
                </button>
              </div>
            </div>
            <div className="viewer-options">
              <ToggleSwitch checked={showMesh} onChange={setShowMesh} label="显示网格" />
              <ToggleSwitch checked={showBoundary} onChange={setShowBoundary} label="显示边界" />
              <ToggleSwitch checked={transparent} onChange={setTransparent} label="半透明显示" />
              <ToggleSwitch checked={colorByGroup} onChange={setColorByGroup} label="按分组着色" disabled={!hasGrouping} />
              <ToggleSwitch checked={pointPreview} onChange={setPointPreview} label="点位预览" />
            </div>
            {payload?.glb_url && payload?.mapping_url ? (
              <div className="viewer-stage">
                <FemViewer
                  key={modelKey}
                  glbUrl={payload.glb_url}
                  mappingUrl={payload.mapping_url}
                  grouping={grouping}
                  showMesh={showMesh}
                  showBoundary={showBoundary}
                  transparent={transparent}
                  colorByGroup={colorByGroup}
                  bindings={bindings}
                  pointPreview={pointPreview}
                  pickingMode={editorOpen}
                  onPickElement={setPickedElement}
                />
                {editorOpen && selectedProjectId != null && (
                  <PointBindingEditor
                    projectId={selectedProjectId}
                    bindings={bindings}
                    pickedElement={pickedElement}
                    onPickClear={() => setPickedElement(null)}
                    onBindingsChanged={() => {
                      if (selectedProjectId) void reloadBindings(selectedProjectId);
                    }}
                    onClose={toggleEditor}
                  />
                )}
              </div>
            ) : (
              <div className="alert danger">模型产物缺失，请重新上传 FEM 文件。</div>
            )}
          </div>

          {/* 替换入口：项目内再次上传 = 整体替换并重新渲染 */}
          <FemReplacePanel
            projectName={selectedProject.project_name}
            onUploaded={handleUploaded}
            onError={handleError}
          />

          <FemModelInfo stats={stats} updatedAt={payload?.updated_at ?? null} grouping={grouping} />
        </>
      ) : (
        <FemUploadPanel projectName={selectedProject.project_name} onUploaded={handleUploaded} onError={handleError} />
      )}
    </section>
  );
}

/** 项目还没有 FEM 模型时的导入面板：在本页直接导入。 */
function FemUploadPanel({
  projectName,
  onUploaded,
  onError,
}: {
  projectName: string;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const navigate = useNavigate();
  const { selectedProjectId } = useAppContext();
  return (
    <div className="panel fem-replace-panel">
      <div className="section-head">
        <h2>
          <FileUp size={18} />
          导入 FEM 模型
        </h2>
        <span className="pill">{projectName}</span>
      </div>
      <p className="fem-block-note">当前项目还没有 FEM 模型。选择 .fem 文件或文件夹后，将解析渲染并保存到该项目，可从本页随时查看。</p>
      {selectedProjectId != null ? (
        <FemUploadBox projectId={selectedProjectId} onUploaded={onUploaded} onError={onError} />
      ) : null}
      <p className="fem-upload-hint">
        解析与渲染在后台进行，进度见右下角悬浮窗。若要连同项目的点位/测量数据一起导入，请前往
        <button className="text-button" type="button" onClick={() => navigate('/import')}>
          导入项目页
        </button>
        。
      </p>
    </div>
  );
}

/** 已有模型时的替换面板：文案与操作项明确为“替换当前模型并重新渲染”。 */
function FemReplacePanel({
  projectName,
  onUploaded,
  onError,
}: {
  projectName: string;
  onUploaded: () => void;
  onError: (message: string) => void;
}) {
  const { selectedProjectId } = useAppContext();
  return (
    <div className="panel fem-replace-panel">
      <div className="section-head">
        <h2>
          <RefreshCw size={18} />
          替换 FEM 模型
        </h2>
        <span className="pill">{projectName}</span>
      </div>
      <p className="fem-block-note">
        当前项目已存在 FEM 模型。再次上传将<strong>整体替换</strong>该项目现有模型并重新解析渲染，替换成功后下方三维视图自动更新。
      </p>
      {selectedProjectId != null ? (
        <FemUploadBox projectId={selectedProjectId} replace onUploaded={onUploaded} onError={onError} />
      ) : null}
      <p className="fem-upload-hint">若上传文件解析失败，会保留当前已渲染模型不变。</p>
    </div>
  );
}

/**
 * 点位绑定编辑弹层：悬浮在三维视图右上角，不遮挡画布——选择点位后直接
 * 在模型上左键点击目标单元，保存即写入绑定（同一点位重复保存即覆盖）。
 */
function PointBindingEditor({
  projectId,
  bindings,
  pickedElement,
  onPickClear,
  onBindingsChanged,
  onClose,
}: {
  projectId: number;
  bindings: PointElementBinding[];
  pickedElement: number | null;
  onPickClear: () => void;
  onBindingsChanged: () => void;
  onClose: () => void;
}) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(true);
  const [selectedPointDbId, setSelectedPointDbId] = useState<number | ''>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingPoints(true);
    api
      .get<Point[]>(`/api/projects/${projectId}/points`, { silent: true })
      .then((data) => {
        if (!cancelled) setPoints(data);
      })
      .catch((err) => {
        if (!cancelled) setError(`读取点位列表失败：${(err as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoadingPoints(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const bindingByPoint = new Map(bindings.map((binding) => [binding.point_db_id, binding]));
  const selectedBinding = selectedPointDbId === '' ? undefined : bindingByPoint.get(selectedPointDbId);

  async function save() {
    if (selectedPointDbId === '' || pickedElement == null) return;
    const point = points.find((item) => item.id === selectedPointDbId);
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.put<PointElementBinding>(`/api/projects/${projectId}/point-bindings`, {
        point_db_id: selectedPointDbId,
        element_id: pickedElement,
      });
      onBindingsChanged();
      setNotice(`已保存：${point ? `${point.point_id} ${point.point_name}` : '点位'} → 单元 ${pickedElement}`);
      onPickClear();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function unbind() {
    if (selectedPointDbId === '' || !selectedBinding) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await api.delete(`/api/projects/${projectId}/point-bindings/${selectedPointDbId}`);
      onBindingsChanged();
      setNotice('已解除绑定');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="point-binding-editor" role="dialog" aria-label="编辑点位绑定">
      <div className="point-binding-editor-head">
        <strong>
          <PencilLine size={15} />
          编辑点位绑定
        </strong>
        <button className="text-button" type="button" onClick={onClose}>
          完成
        </button>
      </div>
      <p className="point-binding-hint">选择点位，然后在模型上左键点击要绑定的单元（模型可旋转缩放）。</p>
      <label className="point-binding-field">
        <span>点位</span>
        <select
          value={selectedPointDbId}
          disabled={loadingPoints || points.length === 0}
          onChange={(event) => {
            setSelectedPointDbId(event.target.value === '' ? '' : Number(event.target.value));
            setNotice('');
            setError('');
          }}
        >
          <option value="">{loadingPoints ? '正在读取点位…' : points.length === 0 ? '当前项目没有点位' : '请选择点位'}</option>
          {points.map((point) => {
            const bound = bindingByPoint.get(point.id);
            return (
              <option key={point.id} value={point.id}>
                {point.point_id} {point.point_name}
                {bound ? `（已绑定单元 ${bound.element_id}）` : ''}
              </option>
            );
          })}
        </select>
      </label>
      <div className="point-binding-picked">
        <span>当前选中单元</span>
        <strong>{pickedElement != null ? `单元 ${pickedElement}` : '未选择（点击模型拾取）'}</strong>
      </div>
      {error && <div className="alert danger">{error}</div>}
      {notice && <div className="alert ok">{notice}</div>}
      <div className="point-binding-actions">
        <button
          className="button primary"
          type="button"
          disabled={selectedPointDbId === '' || pickedElement == null || saving}
          onClick={save}
        >
          保存绑定
        </button>
        {selectedBinding && (
          <button className="button" type="button" disabled={saving} onClick={unbind}>
            解除绑定
          </button>
        )}
      </div>
    </div>
  );
}

/** 3D 视图下方的信息面板：模型统计 + PID/属性颜色图例。 */
function FemModelInfo({
  stats,
  updatedAt,
  grouping,
}: {
  stats: FemPreviewStats;
  updatedAt: string | null;
  grouping: FemGroupingData | null;
}) {
  const hasGrouping = grouping != null && grouping.coloring_mode !== 'none' && grouping.groups.length > 0;

  return (
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
      {updatedAt && (
        <div>
          <span>模型更新于</span>
          <strong>{formatTime(updatedAt)}</strong>
        </div>
      )}
    </div>
    {hasGrouping && grouping && <FemLegend grouping={grouping} />}
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
          解析时忽略的卡片：
          {Object.entries(stats.ignored_cards)
            .map(([card, count]) => `${card}(${count})`)
            .join('、')}
        </div>
      )}
      {stats.included_files.length > 0 && (
        <div className="alert fem-included">已展开 INCLUDE 文件：{stats.included_files.join('、')}</div>
      )}
    </div>
  );
}

/** PID/组件颜色图例，与 3D 画布按分组着色一致。 */
function FemLegend({ grouping }: { grouping: FemGroupingData }) {
  const isProperty = grouping.coloring_mode === 'property';
  return (
    <div className="fem-legend fem-info-legend">
      <span className="fem-legend-title">
        {isProperty ? '属性（PID）颜色' : '组件颜色'}（{grouping.groups.length}）
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
