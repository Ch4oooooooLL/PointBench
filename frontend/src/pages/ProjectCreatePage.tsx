import { Save } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAppContext } from '../context/AppContext';
import { Project } from '../types';

interface ProjectForm {
  project_id: string;
  project_name: string;
  test_object: string;
  test_type: string;
  department: string;
  vehicle_or_product: string;
  test_stage: string;
  description: string;
}

const emptyForm: ProjectForm = {
  project_id: '',
  project_name: '',
  test_object: '',
  test_type: '',
  department: '',
  vehicle_or_product: '',
  test_stage: '',
  description: '',
};

export function ProjectCreatePage() {
  const navigate = useNavigate();
  const { refreshProjects, setSelectedProjectId } = useAppContext();
  const [form, setForm] = useState<ProjectForm>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const project = await api.post<Project>('/api/projects', form);
      await refreshProjects();
      setSelectedProjectId(project.id);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setMessage(`创建失败：${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>创建新项目</h1>
          <p>填写项目基础信息；点位信息在项目详情的编辑模式中维护。</p>
        </div>
        <button className="button primary" disabled={busy || !form.project_id || !form.project_name} onClick={save}>
          <Save size={18} />
          保存项目
        </button>
      </div>

      {message && <div className="alert danger">{message}</div>}

      <div className="panel">
        <div className="project-edit-grid">
          <label>项目 ID<input value={form.project_id} onChange={(e) => setForm({ ...form, project_id: e.target.value })} /></label>
          <label>项目名称<input value={form.project_name} onChange={(e) => setForm({ ...form, project_name: e.target.value })} /></label>
          <label>测试对象<input value={form.test_object} onChange={(e) => setForm({ ...form, test_object: e.target.value })} /></label>
          <label>试验类型<input value={form.test_type} onChange={(e) => setForm({ ...form, test_type: e.target.value })} /></label>
          <label>部门<input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} /></label>
          <label>产品/车型<input value={form.vehicle_or_product} onChange={(e) => setForm({ ...form, vehicle_or_product: e.target.value })} /></label>
          <label>试验阶段<input value={form.test_stage} onChange={(e) => setForm({ ...form, test_stage: e.target.value })} /></label>
          <label className="wide">说明<textarea rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        </div>
      </div>
    </section>
  );
}
