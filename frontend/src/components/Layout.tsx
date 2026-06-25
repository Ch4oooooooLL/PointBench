import { ActivitySquare, BookOpen, Camera, FilePlus2, FileUp, LayoutDashboard, ListChecks, Settings } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <ActivitySquare size={24} />
            <div>
              <strong>点位分析</strong>
              <span>实验数据工作台</span>
            </div>
          </div>
          <nav>
            <NavLink to="/" end>
              <LayoutDashboard size={18} />
              项目概览
            </NavLink>
            <NavLink to="/project-detail">
              <ListChecks size={18} />
              项目详情
            </NavLink>
            <NavLink to="/crack-records">
              <Camera size={18} />
              裂纹记录
            </NavLink>
            <NavLink to="/projects/new">
              <FilePlus2 size={18} />
              创建项目
            </NavLink>
            <NavLink to="/import">
              <FileUp size={18} />
              导入项目
            </NavLink>
            <NavLink to="/help">
              <BookOpen size={18} />
              使用说明
            </NavLink>
          </nav>
        </div>
        <button className="settings-button" onClick={() => setSettingsOpen(true)} title="设置">
          <Settings size={18} />
          设置
        </button>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

function SettingsModal({ onClose }: { onClose: () => void }) {
  const { riskSettings, setRiskSettings, chartSettings, setChartSettings, debugMode, setDebugMode } = useAppContext();
  const [warnPercent, setWarnPercent] = useState(String(riskSettings.warnPercent));
  const [dangerPercent, setDangerPercent] = useState(String(riskSettings.dangerPercent));
  const [criticalPercent, setCriticalPercent] = useState(String(riskSettings.criticalPercent));
  const [overviewHeight, setOverviewHeight] = useState(String(chartSettings.overviewHeight));
  const [overviewExpandedHeight, setOverviewExpandedHeight] = useState(String(chartSettings.overviewExpandedHeight));
  const [debugEnabled, setDebugEnabled] = useState(debugMode);

  function save() {
    setRiskSettings({
      warnPercent: Number(warnPercent),
      dangerPercent: Number(dangerPercent),
      criticalPercent: Number(criticalPercent),
    });
    setChartSettings({
      overviewHeight: clampNumber(Number(overviewHeight), 360, 760),
      overviewExpandedHeight: clampNumber(Number(overviewExpandedHeight), 480, 860),
    });
    setDebugMode(debugEnabled);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>设置</h2>
            <p>配置风险标识阈值，并控制调试工具是否显示。</p>
          </div>
          <button className="button" onClick={onClose}>关闭</button>
        </div>

        <div className="settings-section">
          <h3>风险标识</h3>
          <p>按当前值相对初始应力幅的增长百分比着色。</p>
          <div className="settings-grid">
            <label>预警阈值 %<input type="number" value={warnPercent} onChange={(event) => setWarnPercent(event.target.value)} /></label>
            <label>危险阈值 %<input type="number" value={dangerPercent} onChange={(event) => setDangerPercent(event.target.value)} /></label>
            <label>严重阈值 %<input type="number" value={criticalPercent} onChange={(event) => setCriticalPercent(event.target.value)} /></label>
          </div>
          <div className="risk-preview">
            <span className="risk-badge normal">正常</span>
            <span className="risk-badge warn">预警</span>
            <span className="risk-badge danger">危险</span>
            <span className="risk-badge critical">严重</span>
          </div>
        </div>

        <div className="settings-section">
          <h3>概览折线图</h3>
          <p>调整项目概览中全点位应力幅趋势图的高度。</p>
          <div className="settings-grid">
            <label>普通视图高度 px<input type="number" min="360" max="760" value={overviewHeight} onChange={(event) => setOverviewHeight(event.target.value)} /></label>
            <label>放大视图高度 px<input type="number" min="480" max="860" value={overviewExpandedHeight} onChange={(event) => setOverviewExpandedHeight(event.target.value)} /></label>
          </div>
        </div>

        <div className="settings-section">
          <h3>Debug 模式</h3>
          <label className="toggle-row">
            <input type="checkbox" checked={debugEnabled} onChange={(event) => setDebugEnabled(event.target.checked)} />
            显示 CSV 测试数据导入工具
          </label>
        </div>

        <button className="button primary" onClick={save}>保存设置</button>
      </div>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
