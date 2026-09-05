import { Box, FileUp, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { FemViewer } from '../components/FemViewer';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { FemGroupingData, FemModelPayload, FemPreviewStats } from '../types';

/**
 * 模型预览：展示当前项目对应的 FEM 模型（一个项目一个模型）。
 *
 * 模型导入（选择 .fem 文件 / 文件夹）在「导入项目」页进行，产物连同渲染
 * 产物一起持久化在项目目录；本页面每次打开（含冷启动）直接读取产物展示，
 * 无需重新解析。再次导入 = 整体覆盖并重新解析渲染。
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
      ) : !hasModel ? (
        <div className="empty panel fem-empty">
          <p>当前项目还没有 FEM 模型。</p>
          <button className="button primary" type="button" onClick={() => navigate('/import')}>
            <FileUp size={16} />
            去导入 FEM 模型
          </button>
        </div>
      ) : (
        <>
          {/* 三维预览：展示控件常驻顶部 */}
          <div className="panel fem-viewer-panel">
            <div className="section-head">
              <h2>三维预览</h2>
              <div className="section-actions">
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
            </div>
            {payload?.glb_url && payload?.mapping_url ? (
              <FemViewer
                key={modelKey}
                glbUrl={payload.glb_url}
                mappingUrl={payload.mapping_url}
                grouping={grouping}
                showMesh={showMesh}
                showBoundary={showBoundary}
                transparent={transparent}
                colorByGroup={colorByGroup}
              />
            ) : (
              <div className="alert danger">模型产物缺失，请重新导入 FEM 文件。</div>
            )}
          </div>

          <FemModelInfo stats={stats} updatedAt={payload?.updated_at ?? null} grouping={grouping} />
        </>
      )}
    </section>
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
