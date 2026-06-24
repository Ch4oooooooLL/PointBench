import { ClipboardPlus, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { DebugCsvImporter } from '../components/DebugCsvImporter';
import { MultiPointTrendChart, PointTrend } from '../components/MultiPointTrendChart';
import { ProjectSelector } from '../components/ProjectSelector';
import { useAppContext } from '../context/AppContext';
import { Point, TrendItem } from '../types';

interface Summary {
  point_count: number;
  run_count: number;
  measurement_count: number;
  abnormal_count: number;
  max_amplitude_points: Array<Record<string, string | number | null>>;
  fastest_growth_points: Array<Record<string, string | number | null>>;
}

export function ProjectOverviewPage() {
  const { selectedProject, selectedProjectId, debugMode } = useAppContext();
  const [points, setPoints] = useState<Point[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [trends, setTrends] = useState<PointTrend[]>([]);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!selectedProjectId) {
      setPoints([]);
      setSummary(null);
      setTrends([]);
      return;
    }
    setPoints([]);
    setSummary(null);
    setTrends([]);
    setError('');
    Promise.all([
      api.get<Point[]>(`/api/projects/${selectedProjectId}/points`),
      api.get<Summary>(`/api/projects/${selectedProjectId}/analysis/summary`),
    ])
      .then(async ([pointData, summaryData]) => {
        setPoints(pointData);
        setSummary(summaryData);
        const trendData = await Promise.all(
          pointData.map(async (point) => ({
            point,
            trend: await api.get<TrendItem[]>(`/api/points/${point.id}/trend`),
          })),
        );
        setTrends(trendData);
      })
      .catch((err) => setError(err.message));
  }, [selectedProjectId, reloadKey]);

  const latestCycle = useMemo(() => {
    const cycles = trends.flatMap((item) => item.trend.map((trend) => trend.cycle_count));
    return cycles.length ? Math.max(...cycles) : null;
  }, [trends]);

  const topPoint = summary?.max_amplitude_points[0];

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>项目概览</h1>
          <p>选择当前项目，查看点位规模、测试进展、异常状态和全点位应力趋势。</p>
        </div>
        <ProjectSelector />
      </div>

      {!selectedProject && <div className="empty panel">暂无可用项目，请先导入项目 zip。</div>}
      {error && <div className="alert danger">{error}</div>}

      {selectedProject && summary && (
        <>
          <div className="overview-band">
            <div>
              <span>项目名称</span>
              <strong>{selectedProject.project_name}</strong>
              <p>{selectedProject.project_id}</p>
            </div>
            <div>
              <span>测试对象</span>
              <strong>{selectedProject.test_object || '-'}</strong>
              <p>{selectedProject.test_type || '-'}</p>
            </div>
            <div>
              <span>当前阶段</span>
              <strong>{selectedProject.test_stage || '-'}</strong>
              <p>{selectedProject.department || '-'}</p>
            </div>
          </div>

          <div className="metric-grid">
            <div><span>点位数量</span><strong>{summary.point_count}</strong></div>
            <div><span>测试轮次</span><strong>{summary.run_count}</strong></div>
            <div><span>测量记录</span><strong>{summary.measurement_count}</strong></div>
            <div><span>异常记录</span><strong>{summary.abnormal_count}</strong></div>
            <div><span>最新循环次数</span><strong>{latestCycle ?? '-'}</strong></div>
            <div><span>当前最大应力幅</span><strong>{topPoint?.stress_amplitude_mpa ? Number(topPoint.stress_amplitude_mpa).toFixed(1) : '-'}</strong></div>
          </div>

          <div className="overview-actions">
            <Link className="button primary" to={`/projects/${selectedProject.id}/test-runs/new`}>
              <ClipboardPlus size={18} />
              录入测试数据
            </Link>
            <a className="button" href={`/api/projects/${selectedProject.id}/export.json`}>
              <Download size={18} />
              导出 JSON
            </a>
            <a className="button" href={`/api/projects/${selectedProject.id}/export.csv`}>
              <Download size={18} />
              导出 CSV
            </a>
          </div>

          {debugMode && (
            <DebugCsvImporter
              projectId={selectedProject.id}
              points={points}
              onImported={() => setReloadKey((key) => key + 1)}
            />
          )}

          <div className="panel">
            <div className="section-head">
              <div>
                <h2>全点位应力幅趋势</h2>
                <p>每个点位一条折线；点击图表可放大，放大后点击标注突出单条折线。</p>
              </div>
            </div>
            <MultiPointTrendChart trends={trends} />
          </div>

          <div className="overview-columns">
            <DataPanel title="应力幅最大的点位" rows={summary.max_amplitude_points} />
            <DataPanel title="增长最快的点位" rows={summary.fastest_growth_points} />
          </div>
        </>
      )}
    </section>
  );
}

function DataPanel({ title, rows }: { title: string; rows: Array<Record<string, string | number | null>> }) {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="compact-list">
        {rows.slice(0, 5).map((row, index) => (
          <div key={index}>
            <strong>{row.point_id || '-'}</strong>
            <span>{columns.map((column) => `${column}: ${row[column] ?? '-'}`).join(' · ')}</span>
          </div>
        ))}
        {!rows.length && <p className="empty">暂无数据</p>}
      </div>
    </div>
  );
}
