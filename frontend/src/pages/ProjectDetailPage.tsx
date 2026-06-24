import { BarChart3, ClipboardPlus, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { Point, Project } from '../types';

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [query, setQuery] = useState('');
  const [component, setComponent] = useState('');
  const [status, setStatus] = useState('');
  const [abnormal, setAbnormal] = useState('');

  useEffect(() => {
    api.get<Project>(`/api/projects/${projectId}`).then(setProject);
    api.get<Point[]>(`/api/projects/${projectId}/points`).then(setPoints);
  }, [projectId]);

  const components = useMemo(() => Array.from(new Set(points.map((item) => item.component).filter(Boolean))) as string[], [points]);
  const filtered = points.filter((point) => {
    const text = `${point.point_id} ${point.point_name}`.toLowerCase();
    return (
      text.includes(query.toLowerCase()) &&
      (!component || point.component === component) &&
      (!status || point.install_status === status) &&
      (!abnormal || String(Boolean(point.latest_measurement?.is_abnormal)) === abnormal)
    );
  });

  if (!project) return <div className="empty">加载中...</div>;

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{project.project_name}</h1>
          <p>{project.project_id} · {project.test_type || '未填写试验类型'} · {project.point_count} 个点位</p>
        </div>
        <div className="actions">
          <Link className="button" to={`/projects/${project.id}/analysis`}><BarChart3 size={18} />分析</Link>
          <Link className="button primary" to={`/projects/${project.id}/test-runs/new`}><ClipboardPlus size={18} />录入数据</Link>
        </div>
      </div>
      <div className="project-layout">
        <aside className="directory">
          {points.map((point) => (
            <a key={point.id} href={`#point-${point.id}`}>{point.point_id}</a>
          ))}
        </aside>
        <div>
          <div className="filters">
            <label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="点位编号或名称" /></label>
            <select value={component} onChange={(e) => setComponent(e.target.value)}>
              <option value="">全部部件</option>
              {components.map((item) => <option key={item}>{item}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">全部状态</option>
              <option value="planned">planned</option>
              <option value="installed">installed</option>
              <option value="removed">removed</option>
              <option value="damaged">damaged</option>
              <option value="abandoned">abandoned</option>
            </select>
            <select value={abnormal} onChange={(e) => setAbnormal(e.target.value)}>
              <option value="">全部异常状态</option>
              <option value="true">异常</option>
              <option value="false">正常</option>
            </select>
          </div>
          <div className="point-grid">
            {filtered.map((point) => (
              <Link className="point-card" id={`point-${point.id}`} to={`/points/${point.id}`} key={point.id}>
                {point.media_files[0] ? <img src={mediaUrl(point.media_files[0].id)} alt={point.point_name} /> : <div className="thumb-empty">无图</div>}
                <div className="point-card-body">
                  <div className="point-title"><strong>{point.point_id}</strong><StatusPill value={point.latest_measurement?.is_abnormal || false} tone={point.latest_measurement?.is_abnormal ? 'danger' : 'ok'} /></div>
                  <h2>{point.point_name}</h2>
                  <p>{point.component || '-'} · {point.direction || '-'} · {point.bridge_type || '-'}</p>
                  <p>通道：{point.channels[0]?.channel_name || '-'}</p>
                  <p>安装：{point.install_status} · 检查：{point.check_status || '-'}</p>
                  <p className="muted">{point.remark || '无备注'}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
