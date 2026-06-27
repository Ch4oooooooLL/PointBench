import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { DewesoftImport } from '../types';

export function DewesoftImportsPage() {
  const { projectId } = useParams();
  const [imports, setImports] = useState<DewesoftImport[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [error, setError] = useState('');

  const active = imports.find((item) => item.id === activeId) ?? imports[0] ?? null;

  function load() {
    if (!projectId) return;
    setError('');
    api.get<DewesoftImport[]>(`/api/dewesoft/projects/${projectId}/imports`)
      .then((data) => {
        setImports(data);
        setActiveId((current) => current ?? data[0]?.id ?? null);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(load, [projectId]);

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Dewesoft 导入记录</h1>
          <p>展示原始文件解析结果、稳定时间窗、匹配点位通道和未匹配通道。</p>
        </div>
        <div className="actions">
          <button className="button" onClick={load}><RefreshCw size={18} />刷新</button>
          <Link className="button" to={`/projects/${projectId}/test-runs/new`}>返回录入</Link>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}
      {!imports.length && <div className="empty panel">暂无 Dewesoft 导入记录</div>}

      {!!imports.length && (
        <div className="manager-layout">
          <aside className="project-manager-list">
            {imports.map((item) => (
              <button
                className={active?.id === item.id ? 'manager-project active' : 'manager-project'}
                key={item.id}
                onClick={() => setActiveId(item.id)}
              >
                <strong>{item.run_name}</strong>
                <span>{item.filename}</span>
                <small>{item.status} · {item.cycle_count} 次循环</small>
              </button>
            ))}
          </aside>
          {active && <DewesoftImportDetail item={active} />}
        </div>
      )}
    </section>
  );
}

function DewesoftImportDetail({ item }: { item: DewesoftImport }) {
  const channels = item.channels ?? [];
  const unmatched = channels.filter((channel) => !channel.matched_point_db_id);
  const matched = channels.filter((channel) => channel.matched_point_db_id);

  return (
    <div className="project-manager-main">
      <div className="panel">
        <div className="section-head">
          <div>
            <h2>{item.run_name}</h2>
            <p>{item.message || '-'}</p>
          </div>
          <span className={item.status === 'imported' ? 'pill ok' : 'pill danger'}>{item.status}</span>
        </div>
        <div className="kv-grid compact">
          <div><span>文件</span><strong>{item.filename}</strong></div>
          <div><span>循环次数</span><strong>{item.cycle_count}</strong></div>
          <div><span>总时长</span><strong>{item.duration_seconds?.toFixed(3) ?? '-'} s</strong></div>
          <div><span>稳定窗口</span><strong>{formatWindow(item)}</strong></div>
          <div><span>匹配通道</span><strong>{item.matched_channel_count}</strong></div>
          <div><span>未匹配通道</span><strong>{item.unmatched_channel_count}</strong></div>
        </div>
      </div>

      <ChannelTable title="已匹配点位通道" channels={matched} />
      <ChannelTable title="未匹配/额外通道" channels={unmatched} />
    </div>
  );
}

function ChannelTable({ title, channels }: { title: string; channels: DewesoftImport['channels'] }) {
  return (
    <div className="panel">
      <h2>{title}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>通道名</th>
              <th>单位</th>
              <th>样本数</th>
              <th>匹配点位 ID</th>
              <th>最小应变</th>
              <th>最大应变</th>
              <th>平均应变</th>
              <th>测量记录</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.id}>
                <td>{channel.channel_name}</td>
                <td>{channel.unit || '-'}</td>
                <td>{channel.sample_count ?? '-'}</td>
                <td>{channel.matched_point_db_id ?? '-'}</td>
                <td>{channel.stable_min_strain_ue?.toFixed(3) ?? '-'}</td>
                <td>{channel.stable_max_strain_ue?.toFixed(3) ?? '-'}</td>
                <td>{channel.stable_mean_strain_ue?.toFixed(3) ?? '-'}</td>
                <td>{channel.measurement_id ?? '-'}</td>
              </tr>
            ))}
            {!channels.length && <tr><td colSpan={8} className="empty">暂无数据</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatWindow(item: DewesoftImport): string {
  if (item.stable_start_seconds == null || item.stable_end_seconds == null) return '-';
  return `${item.stable_start_seconds.toFixed(3)} - ${item.stable_end_seconds.toFixed(3)} s`;
}
