import { Download, FileUp, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Project } from '../types';

export function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');

  const load = () => api.get<Project[]>('/api/projects').then(setProjects).catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  async function remove(project: Project) {
    if (!confirm(`删除项目 ${project.project_name}？`)) return;
    await api.delete(`/api/projects/${project.id}`);
    load();
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>项目列表</h1>
          <p>共 {projects.length} 个项目</p>
        </div>
        <Link className="button primary" to="/import">
          <FileUp size={18} />
          导入项目 zip
        </Link>
      </div>
      {error && <div className="alert danger">{error}</div>}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>项目名称</th>
              <th>测试对象</th>
              <th>试验类型</th>
              <th>点位数</th>
              <th>最近更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((project) => (
              <tr key={project.id}>
                <td>
                  <Link className="table-link" to={`/projects/${project.id}`}>
                    {project.project_name}
                  </Link>
                  <span className="muted block">{project.project_id}</span>
                </td>
                <td>{project.test_object || '-'}</td>
                <td>{project.test_type || '-'}</td>
                <td>{project.point_count}</td>
                <td>{new Date(project.updated_at).toLocaleString()}</td>
                <td className="actions">
                  <a className="icon-button" href={`/api/projects/${project.id}/export.json`} title="导出 JSON">
                    <Download size={16} />
                  </a>
                  <a className="icon-button" href={`/api/projects/${project.id}/export.csv`} title="导出 CSV">
                    CSV
                  </a>
                  <button className="icon-button danger-text" title="删除项目" onClick={() => remove(project)}>
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!projects.length && (
              <tr>
                <td colSpan={6} className="empty">
                  暂无项目
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
