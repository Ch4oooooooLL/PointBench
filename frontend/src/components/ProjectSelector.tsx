import { FolderCog } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ProjectManagerModal } from './ProjectManagerModal';

export function ProjectSelector({ compact = false, embedded = false }: { compact?: boolean; embedded?: boolean }) {
  const { projects, selectedProjectId, setSelectedProjectId, isLoadingProjects, projectsError, refreshProjects } = useAppContext();
  const [managerOpen, setManagerOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className={compact ? 'project-selector compact-select' : 'project-selector'}>
      <label className="project-select">
        <span className="project-select-label">当前项目</span>
        <select
          value={selectedProjectId ?? ''}
          disabled={isLoadingProjects}
          onChange={(event) => {
            const value = event.target.value ? Number(event.target.value) : null;
            setSelectedProjectId(value);
            // 项目切换后回到项目总览，保持统一的工作起点。
            if (value) navigate('/overview');
          }}
        >
          <option value="">{isLoadingProjects ? '加载中...' : '请选择项目'}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
      </label>
      {projectsError && !embedded && (
        <button className="button" type="button" disabled={isLoadingProjects} onClick={() => refreshProjects().catch(() => undefined)}>
          重试
        </button>
      )}
      <button className="button" type="button" onClick={() => setManagerOpen(true)}>
        <FolderCog size={18} />
        <span className="project-manager-label">项目管理</span>
      </button>
      {managerOpen && <ProjectManagerModal onClose={() => setManagerOpen(false)} />}
      {embedded && projectsError && <span className="project-selector-error">{projectsError}</span>}
    </div>
  );
}
