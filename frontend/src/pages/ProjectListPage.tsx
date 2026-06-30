import { Download, FileUp, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadFile } from '../api/client';
import { DeleteProjectResult, Project } from '../types';

export function ProjectListPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [deleteExport, setDeleteExport] = useState<DeleteProjectResult | null>(null);

  const load = () => api.get<Project[]>('/api/projects').then(setProjects).catch((err) => setError(err.message));

  useEffect(() => {
    load();
  }, []);

  async function remove(project: Project) {
    if (!confirm(`删除项目 ${project.project_name}？`)) return;
    setError('');
    setMessage('');
    setDeleteExport(null);
    try {
      const result = await api.delete<DeleteProjectResult>(`/api/projects/${project.id}?permanent=true`);
      setDeleteExport(result);
      setMessage(result.export_download_url ? '项目已删除，删除前已自动生成导出文件，请及时下载。' : '项目已删除。');
      load();
    } catch (err) {
      setError(`删除失败：${(err as Error).message}`);
    }
  }

  async function downloadProjectExport(project: Project, format: 'json' | 'csv') {
    setError('');
    try {
      await downloadFile(`/api/projects/${project.id}/export.${format}`, `${project.project_id}.${format}`);
    } catch (err) {
      setError(`导出失败：${(err as Error).message}`);
    }
  }

  async function downloadDeleteExport() {
    if (!deleteExport?.export_download_url) return;
    setError('');
    try {
      await downloadFile(deleteExport.export_download_url, deleteExport.export_filename ?? 'deleted_project.zip');
    } catch (err) {
      setError(`下载失败：${(err as Error).message}`);
    }
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
      {message && (
        <div className="alert ok">
          {message}
          {deleteExport?.export_download_url && (
            <button className="button" type="button" onClick={downloadDeleteExport}>
              <Download size={18} />
              下载删除前导出文件
            </button>
          )}
        </div>
      )}
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
                  <button className="icon-button" type="button" onClick={() => downloadProjectExport(project, 'json')} title="导出 JSON">
                    <Download size={16} />
                  </button>
                  <button className="icon-button" type="button" onClick={() => downloadProjectExport(project, 'csv')} title="导出 CSV">
                    CSV
                  </button>
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
