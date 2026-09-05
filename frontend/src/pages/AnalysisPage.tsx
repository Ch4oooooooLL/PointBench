import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useAppContext } from '../context/AppContext';

interface Summary {
  project_db_id: number;
  point_count: number;
  run_count: number;
  measurement_count: number;
  abnormal_count: number;
  max_amplitude_points: Array<Record<string, string | number | null>>;
  fastest_growth_points: Array<Record<string, string | number | null>>;
}

const COLUMN_LABELS: Record<string, string> = {
  point_db_id: '点位数据库 ID',
  point_id: '点位编号',
  point_name: '点位名称',
  component: '部件',
  run_id: '轮次 ID',
  run_name: '轮次名称',
  cycle_count: '循环次数',
  amplitude_strain_ue: '应变幅',
  stress_amplitude_mpa: '应力幅 MPa',
  abnormal_reason: '异常原因',
  previous_run_name: '上一轮次',
  latest_run_name: '最新轮次',
  previous_cycle_count: '上一循环次数',
  latest_cycle_count: '最新循环次数',
  previous_stress_amplitude_mpa: '上一应力幅 MPa',
  latest_stress_amplitude_mpa: '最新应力幅 MPa',
  growth_ratio: '增长比例',
};

export function AnalysisPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { setSelectedProjectId } = useAppContext();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [abnormal, setAbnormal] = useState<Array<Record<string, string | number | null>>>([]);
  const [loadError, setLoadError] = useState('');
  const [loadRetryKey, setLoadRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    api.get<Summary>(`/api/projects/${projectId}/analysis/summary`)
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      });
    api.get<Array<Record<string, string | number | null>>>(`/api/projects/${projectId}/analysis/abnormal-points`)
      .then((data) => {
        if (!cancelled) setAbnormal(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, loadRetryKey]);

  if (loadError) {
    return (
      <div className="empty panel">
        <p>分析数据加载失败：{loadError}</p>
        <button className="button primary" onClick={() => setLoadRetryKey((key) => key + 1)}>重试</button>
      </div>
    );
  }
  if (!summary) return <div className="empty">加载中...</div>;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>分析总览</h1>
          <p>最新测量、异常点、应变幅排序和增长趋势</p>
        </div>
        <button
          className="button"
          type="button"
          onClick={() => {
            setSelectedProjectId(Number(projectId));
            navigate('/overview');
          }}
        >
          返回项目
        </button>
      </div>
      <div className="metric-grid">
        <div><span>点位数</span><strong>{summary.point_count}</strong></div>
        <div><span>测试轮次</span><strong>{summary.run_count}</strong></div>
        <div><span>测量记录</span><strong>{summary.measurement_count}</strong></div>
        <div><span>异常点位</span><strong>{summary.abnormal_count}</strong></div>
      </div>
      <DataPanel title="异常点列表" rows={abnormal} />
      <DataPanel title="应变幅最大的前 10 个点" rows={summary.max_amplitude_points} />
      <DataPanel title="增长最快的点" rows={summary.fastest_growth_points} />
    </section>
  );
}

function DataPanel({ title, rows }: { title: string; rows: Array<Record<string, string | number | null>> }) {
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const colSpan = Math.max(columns.length, 1);
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{COLUMN_LABELS[column] ?? column}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>{columns.map((column) => <td key={column}>{row[column] ?? '-'}</td>)}</tr>
            ))}
            {!rows.length && <tr><td colSpan={colSpan} className="empty">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
