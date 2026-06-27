import { Bug, LineChart, Save, ShieldAlert, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useAppContext } from '../context/AppContext';

type SettingsCategory = 'risk' | 'chart' | 'debug';

const SETTINGS_CATEGORIES: Array<{ id: SettingsCategory; label: string; icon: LucideIcon }> = [
  { id: 'risk', label: '风险标识', icon: ShieldAlert },
  { id: 'chart', label: '图表显示', icon: LineChart },
  { id: 'debug', label: '调试工具', icon: Bug },
];

export function SettingsPage() {
  const { riskSettings, setRiskSettings, chartSettings, setChartSettings, debugMode, setDebugMode } = useAppContext();
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('risk');
  const [warnPercent, setWarnPercent] = useState(String(riskSettings.warnPercent));
  const [dangerPercent, setDangerPercent] = useState(String(riskSettings.dangerPercent));
  const [criticalPercent, setCriticalPercent] = useState(String(riskSettings.criticalPercent));
  const [overviewHeight, setOverviewHeight] = useState(String(chartSettings.overviewHeight));
  const [overviewExpandedHeight, setOverviewExpandedHeight] = useState(String(chartSettings.overviewExpandedHeight));
  const [debugEnabled, setDebugEnabled] = useState(debugMode);
  const [message, setMessage] = useState('');

  function save() {
    setRiskSettings({
      warnPercent: parseNumber(warnPercent, riskSettings.warnPercent),
      dangerPercent: parseNumber(dangerPercent, riskSettings.dangerPercent),
      criticalPercent: parseNumber(criticalPercent, riskSettings.criticalPercent),
    });
    setChartSettings({
      overviewHeight: clampNumber(Number(overviewHeight), 360, 760),
      overviewExpandedHeight: clampNumber(Number(overviewExpandedHeight), 480, 860),
    });
    setDebugMode(debugEnabled);
    setMessage('设置已保存。');
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p>配置系统行为、显示参数和辅助工具。</p>
        </div>
        <button className="button primary" type="button" onClick={save}>
          <Save size={18} />
          保存设置
        </button>
      </div>

      <div className="settings-type-tabs" aria-label="设置类型">
        {SETTINGS_CATEGORIES.map((category) => {
          const Icon = category.icon;
          return (
            <button
              key={category.id}
              className={activeCategory === category.id ? 'active' : ''}
              type="button"
              onClick={() => setActiveCategory(category.id)}
            >
              <Icon size={18} />
              {category.label}
            </button>
          );
        })}
      </div>

      {message && <div className="alert ok">{message}</div>}

      <div className="panel settings-page-panel">
        {activeCategory === 'risk' && (
          <div className="settings-section">
            <h2>风险标识</h2>
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
        )}

        {activeCategory === 'chart' && (
          <div className="settings-section">
            <h2>图表显示</h2>
            <p>调整项目概览中全点位应力幅趋势图的高度。</p>
            <div className="settings-grid">
              <label>普通视图高度 px<input type="number" min="360" max="760" value={overviewHeight} onChange={(event) => setOverviewHeight(event.target.value)} /></label>
              <label>放大视图高度 px<input type="number" min="480" max="860" value={overviewExpandedHeight} onChange={(event) => setOverviewExpandedHeight(event.target.value)} /></label>
            </div>
          </div>
        )}

        {activeCategory === 'debug' && (
          <div className="settings-section">
            <h2>调试工具</h2>
            <label className="toggle-row">
              <input type="checkbox" checked={debugEnabled} onChange={(event) => setDebugEnabled(event.target.checked)} />
              显示 CSV 测试数据导入工具
            </label>
          </div>
        )}
      </div>
    </section>
  );
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}
