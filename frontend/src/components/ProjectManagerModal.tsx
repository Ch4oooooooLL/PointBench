import { Download, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { Project } from '../types';

interface Props {
  onClose: () => void;
}

interface ProjectForm {
  project_name: string;
  test_object: string;
  test_type: string;
  department: string;
  vehicle_or_product: string;
  test_stage: string;
  description: string;
}

function toForm(project: Project | null): ProjectForm {
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

export function ProjectManagerModal({ onClose }: Props) {
  const { projects, selectedProjectId, selectedProject, setSelectedProjectId, refreshProjects } = useAppContext();
  const [form, setForm] = useState<ProjectForm>(toForm(selectedProject));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(toForm(selectedProject));
    setMessage('');
  }, [selectedProject]);

  async function save() {
    if (!selectedProjectId) return;
    setBusy(true);
    setMessage('');
    try {
      await api.put<Project>(`/api/projects/${selectedProjectId}`, form);
      await refreshProjects();
      setSelectedProjectId(selectedProjectId);
      setMessage('项目信息已保存。');
    } catch (err) {
      setMessage(`保存失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selectedProject) return;
    if (!confirm(`确认删除项目「${selectedProject.project_name}」？数据库记录和项目存储文件会一起删除。`)) return;
    setBusy(true);
    setMessage('');
    try {
      await api.delete(`/api/projects/${selectedProject.id}`);
      await refreshProjects();
      setMessage('项目已删除。');
    } catch (err) {
      setMessage(`删除失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal project-manager-modal" onClick={(event) => event.stopPropagation()}>
        <div className="section-head">
          <div>
            <h2>项目管理</h2>
            <p>选择当前项目，编辑项目基础信息，或导出、删除项目。</p>
          </div>
          <button className="button" onClick={onClose}>关闭</button>
        </div>
        <div className="manager-actions top-actions">
          <Link className="button primary" to="/projects/new" onClick={onClose}>创建新项目</Link>
        </div>

        <div className="manager-layout">
          <aside className="project-manager-list">
            {projects.map((project) => (
              <button
                key={project.id}
                className={project.id === selectedProjectId ? 'manager-project active' : 'manager-project'}
                onClick={() => setSelectedProjectId(project.id)}
              >
                <strong>{project.project_name}</strong>
                <span>{project.project_id}</span>
                <small>{project.point_count} 个点位</small>
              </button>
            ))}
            {!projects.length && <div className="empty">暂无项目</div>}
          </aside>

          <div className="project-manager-main">
            {!selectedProject ? (
              <div className="empty">请选择项目</div>
            ) : (
              <>
                <div className="kv-grid compact">
                  <div><span>项目 ID</span><strong>{selectedProject.project_id}</strong></div>
                  <div><span>点位数量</span><strong>{selectedProject.point_count}</strong></div>
                  <div><span>导出 ID</span><strong>{selectedProject.source_export_id || '-'}</strong></div>
                  <div><span>更新时间</span><strong>{new Date(selectedProject.updated_at).toLocaleString()}</strong></div>
                </div>

                <div className="project-edit-grid">
                  <label>项目名称<input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} /></label>
                  <label>测试对象<input value={form.test_object} onChange={(e) => setForm({ ...form, test_object: e.target.value })} /></label>
                  <label>试验类型<input value={form.test_type} onChange={(e) => setForm({ ...form, test_type: e.target.value })} /></label>
                  <label>部门<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
                  <label>产品/车型<input value={form.vehicle_or_product} onChange={(e) => setForm({ ...form, vehicle_or_product: e.target.value })} /></label>
                  <label>试验阶段<input value={form.test_stage} onChange={(e) => setForm({ ...form, test_stage: e.target.value })} /></label>
                  <label className="wide">说明<textarea rows={4} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
                </div>

                <div className="manager-actions">
                  <button className="button primary" disabled={busy} onClick={save}><Save size={18} />保存修改</button>
                  <a className="button" href={`/api/projects/${selectedProject.id}/export.json`}><Download size={18} />导出 JSON</a>
                  <a className="button" href={`/api/projects/${selectedProject.id}/export.csv`}><Download size={18} />导出 CSV</a>
                  <button className="button danger-button" disabled={busy} onClick={remove}><Trash2 size={18} />删除项目</button>
                </div>
                {message && <div className={message.includes('失败') ? 'alert danger' : 'alert ok'}>{message}</div>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
