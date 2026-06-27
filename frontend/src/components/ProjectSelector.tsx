import { FolderCog } from 'lucide-react';
import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { ProjectManagerModal } from './ProjectManagerModal';

export function ProjectSelector({ compact = false }: { compact?: boolean }) {
  const { projects, selectedProjectId, setSelectedProjectId, isLoadingProjects, projectsError, refreshProjects } = useAppContext();
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <div className={compact ? 'project-selector compact-select' : 'project-selector'}>
      <label className="project-select">
        当前项目
        <select
          value={selectedProjectId ?? ''}
          disabled={isLoadingProjects}
          onChange={(event) => setSelectedProjectId(event.target.value ? Number(event.target.value) : null)}
        >
          <option value="">{isLoadingProjects ? '加载中...' : '请选择项目'}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
      </label>
      {projectsError && (
        <button className="button" type="button" disabled={isLoadingProjects} onClick={() => refreshProjects().catch(() => undefined)}>
          重试
        </button>
      )}
      <button className="button" type="button" onClick={() => setManagerOpen(true)}>
        <FolderCog size={18} />
        项目管理
      </button>
      {managerOpen && <ProjectManagerModal onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
