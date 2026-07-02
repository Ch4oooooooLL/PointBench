import { Bug, LineChart, Save, ShieldAlert, Eye, Calculator, type LucideIcon } from 'lucide-react';
import { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { api } from '../api/client';

type SettingsCategory = 'risk' | 'display' | 'chart' | 'calc' | 'debug';

const SETTINGS_CATEGORIES: Array<{ id: SettingsCategory; label: string; icon: LucideIcon }> = [
  { id: 'risk', label: '风险标识', icon: ShieldAlert },
  { id: 'display', label: '显示设置', icon: Eye },
  { id: 'chart', label: '图表显示', icon: LineChart },
  { id: 'calc', label: '计算设置', icon: Calculator },
  { id: 'debug', label: '调试工具', icon: Bug },
];

export function SettingsPage() {
  const { 
    riskSettings, 
    setRiskSettings, 
    chartSettings, 
    setChartSettings, 
    anomalySettings, 
    setAnomalySettings, 
    displaySettings,
    setDisplaySettings,
    debugMode, 
    setDebugMode 
  } = useAppContext();

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('risk');
  const [stressFormula, setStressFormula] = useState('(max-min)*0.21');
  const [warnPercent, setWarnPercent] = useState(String(riskSettings.warnPercent));
  const [dangerPercent, setDangerPercent] = useState(String(riskSettings.dangerPercent));
  const [criticalPercent, setCriticalPercent] = useState(String(riskSettings.criticalPercent));
  const [overviewHeight, setOverviewHeight] = useState(String(chartSettings.overviewHeight));
  const [overviewExpandedHeight, setOverviewExpandedHeight] = useState(String(chartSettings.overviewExpandedHeight));
  const [expandedChartWidth, setExpandedChartWidth] = useState(String(chartSettings.expandedChartWidth));
  const [abnormalRangeMpa, setAbnormalRangeMpa] = useState(String(anomalySettings.rangeMpa));

  useEffect(() => {
    api.get<{ stress_formula: string }>('/api/settings')
      .then((data) => {
        if (data && data.stress_formula) {
          setStressFormula(data.stress_formula);
        }
      })
      .catch((err) => {
        console.error('获取计算公式失败:', err);
      });
  }, []);
  const [showPrompt, setShowPrompt] = useState(displaySettings.showPromptMessage);
  const [debugEnabled, setDebugEnabled] = useState(debugMode);
  const [message, setMessage] = useState('');

  async function save() {
    setRiskSettings({
      warnPercent: parseNumber(warnPercent, riskSettings.warnPercent),
      dangerPercent: parseNumber(dangerPercent, riskSettings.dangerPercent),
      criticalPercent: parseNumber(criticalPercent, riskSettings.criticalPercent),
    });
    setChartSettings({
      overviewHeight: clampNumber(Number(overviewHeight), 360, 760),
      overviewExpandedHeight: clampNumber(Number(overviewExpandedHeight), 480, 860),
      expandedChartWidth: clampNumber(Number(expandedChartWidth), 720, 1920),
    });
    setAnomalySettings({
      rangeMpa: clampNumber(Number(abnormalRangeMpa), 0, 1000),
    });
    setDisplaySettings({
      showPromptMessage: showPrompt,
    });
    setDebugMode(debugEnabled);

    try {
      await api.put<{ stress_formula: string }>('/api/settings', {
        stress_formula: stressFormula,
      });
      setMessage('设置已保存。应力计算公式已更新，并已重新计算所有历史测量记录。');
    } catch (err) {
      setMessage(`保存失败: ${(err as Error).message}`);
    }
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
            <p>按当前值相对首次有效应力幅的变化百分比着色。</p>
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

        {activeCategory === 'display' && (
          <div className="settings-section">
            <h2>显示设置</h2>
            <p>配置页面的消息提醒和引导设置。</p>
            <label className="toggle-row">
              <input type="checkbox" checked={showPrompt} onChange={(event) => setShowPrompt(event.target.checked)} />
              提示消息（在点位详情页显示左上角切换点位的提示框）
            </label>
          </div>
        )}

        {activeCategory === 'chart' && (
          <div className="settings-section">
            <h2>图表显示</h2>
            <p>调整项目概览中全点位应力幅趋势图的高度。</p>
            <div className="settings-grid">
              <label>普通视图高度 px<input type="number" min="360" max="760" value={overviewHeight} onChange={(event) => setOverviewHeight(event.target.value)} /></label>
              <label>放大视图高度 px<input type="number" min="480" max="860" value={overviewExpandedHeight} onChange={(event) => setOverviewExpandedHeight(event.target.value)} /></label>
              <label>放大视图宽度 px<input type="number" min="720" max="1920" value={expandedChartWidth} onChange={(event) => setExpandedChartWidth(event.target.value)} /></label>
            </div>
            <h2 style={{ marginTop: 20 }}>异常筛选</h2>
            <p>项目概览趋势图右上角的「仅异常」开关，筛选历史应力幅超过初始值上下范围的点位。</p>
            <div className="settings-grid">
              <label>仅异常范围 MPa<input type="number" min="0" value={abnormalRangeMpa} onChange={(event) => setAbnormalRangeMpa(event.target.value)} /></label>
            </div>
          </div>
        )}

        {activeCategory === 'calc' && (
          <div className="settings-section">
            <h2>计算设置</h2>
            <p>规定从应变值（Strain）到应力值（Stress）的计算方法。基于极大值和极小值应变变量进行公式计算，以得到最终应力大小。</p>
            <div className="settings-form" style={{ maxWidth: 600 }}>
              <div style={{ marginBottom: 15 }}>
                <label style={{ display: 'block', marginBottom: 8, fontWeight: 'bold' }}>应力计算公式</label>
                <input
                  type="text"
                  className="formula-input"
                  style={{
                    width: '100%',
                    padding: '10px',
                    fontSize: '16px',
                    fontFamily: 'monospace',
                    borderRadius: '4px',
                    border: '1px solid #ccc',
                    boxSizing: 'border-box'
                  }}
                  value={stressFormula}
                  onChange={(event) => setStressFormula(event.target.value)}
                  placeholder="(max-min)*0.21"
                />
              </div>
              <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.6' }}>
                <strong style={{ display: 'block', marginBottom: 4 }}>公式编写规则：</strong>
                <ul style={{ paddingLeft: 20, margin: 0 }}>
                  <li>乘号使用 <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>*</code>，除号使用 <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>/</code>，加号为 <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>+</code>，减号为 <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>-</code>。</li>
                  <li>必须使用英文括号 <code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px' }}>()</code>。</li>
                  <li>公式中有且仅支持两个变量：
                    <ul style={{ paddingLeft: 20, margin: 0 }}>
                      <li><code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px', fontWeight: 'bold' }}>max</code>：极值应变的极大值。</li>
                      <li><code style={{ background: '#eee', padding: '2px 4px', borderRadius: '3px', fontWeight: 'bold' }}>min</code>：极值应变的极小值。</li>
                    </ul>
                  </li>
                  <li>默认公式为：<code style={{ background: '#eef3fe', color: '#2b5adc', padding: '2px 6px', borderRadius: '3px', fontWeight: 'bold' }}>(max-min)*0.21</code></li>
                </ul>
              </div>
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
