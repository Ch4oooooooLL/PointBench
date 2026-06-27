import { BarChart3, ClipboardPlus, Pencil, Plus, Save, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, mediaUrl } from '../api/client';
import { StatusPill } from '../components/StatusPill';
import { useAppContext } from '../context/AppContext';
import { Point, Project } from '../types';

interface ProjectForm {
  project_name: string;
  test_object: string;
  test_type: string;
  department: string;
  vehicle_or_product: string;
  test_stage: string;
  description: string;
}

function toProjectForm(project: Project | null): ProjectForm {
  return {
    project_name: project?.project_name ?? '',
    test_object: project?.test_object ?? '',
    test_type: project?.test_type ?? '',
    department: project?.department ?? '',
    vehicle_or_product: project?.vehicle_or_product ?? '',
    test_stage: project?.test_stage ?? '',
    description: project?.description ?? '',
  };
}

export function ProjectDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const { refreshProjects } = useAppContext();
  const [project, setProject] = useState<Project | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [projectForm, setProjectForm] = useState<ProjectForm>(toProjectForm(null));
  const [editMode, setEditMode] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [component, setComponent] = useState('');
  const [status, setStatus] = useState('');
  const [abnormal, setAbnormal] = useState('');

  const load = () => {
    api.get<Project>(`/api/projects/${projectId}`).then((data) => {
      setProject(data);
      setProjectForm(toProjectForm(data));
    });
    api.get<Point[]>(`/api/projects/${projectId}/points`).then(setPoints);
  };

  useEffect(load, [projectId]);

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

  async function saveProject() {
    if (!project) return;
    setMessage('');
    try {
      const data = await api.put<Project>(`/api/projects/${project.id}`, projectForm);
      setProject(data);
      await refreshProjects();
      setMessage('项目基础信息已保存。');
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    }
  }

  async function addPoint() {
    if (!project) return;
    setMessage('');
    try {
      const point = await api.post<Point>(`/api/projects/${project.id}/points`);
      await load();
      navigate(`/points/${point.id}?edit=1`);
    } catch (err) {
      setMessage(`新增点位失败：${(err as Error).message}`);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>{project.project_name}</h1>
          <p>{project.project_id} · {project.test_type || '未填写试验类型'} · {project.point_count} 个点位</p>
        </div>
        <div className="actions">
          {editMode && <button className="button" onClick={addPoint}><Plus size={18} />新增点位</button>}
          {editMode && <button className="button primary" onClick={saveProject}><Save size={18} />保存</button>}
          <button className="button" onClick={() => setEditMode(!editMode)}>
            {editMode ? <X size={18} /> : <Pencil size={18} />}
            {editMode ? '退出编辑' : '编辑模式'}
          </button>
          <Link className="button" to={`/projects/${project.id}/analysis`}><BarChart3 size={18} />分析</Link>
          <Link className="button primary" to={`/projects/${project.id}/test-runs/new`}><ClipboardPlus size={18} />录入数据</Link>
        </div>
      </div>
      {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}
      {editMode && (
        <div className="panel project-edit-panel">
          <div className="project-edit-grid">
            <label>项目名称<input value={projectForm.project_name} onChange={(e) => setProjectForm({ ...projectForm, project_name: e.target.value })} /></label>
            <label>测试对象<input value={projectForm.test_object} onChange={(e) => setProjectForm({ ...projectForm, test_object: e.target.value })} /></label>
            <label>试验类型<input value={projectForm.test_type} onChange={(e) => setProjectForm({ ...projectForm, test_type: e.target.value })} /></label>
            <label>部门<input value={projectForm.department} onChange={(e) => setProjectForm({ ...projectForm, department: e.target.value })} /></label>
            <label>产品/车型<input value={projectForm.vehicle_or_product} onChange={(e) => setProjectForm({ ...projectForm, vehicle_or_product: e.target.value })} /></label>
            <label>试验阶段<input value={projectForm.test_stage} onChange={(e) => setProjectForm({ ...projectForm, test_stage: e.target.value })} /></label>
            <label className="wide">说明<textarea rows={3} value={projectForm.description} onChange={(e) => setProjectForm({ ...projectForm, description: e.target.value })} /></label>
          </div>
        </div>
      )}
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
              <Link className="point-card" id={`point-${point.id}`} to={`/points/${point.id}${editMode ? '?edit=1' : ''}`} key={point.id}>
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
