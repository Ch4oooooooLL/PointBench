import { FolderCog } from 'lucide-react';
import { useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { ProjectManagerModal } from './ProjectManagerModal';

export function ProjectSelector({ compact = false }: { compact?: boolean }) {
  const { projects, selectedProjectId, setSelectedProjectId } = useAppContext();
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <div className={compact ? 'project-selector compact-select' : 'project-selector'}>
      <label className="project-select">
        当前项目
        <select value={selectedProjectId ?? ''} onChange={(event) => setSelectedProjectId(event.target.value ? Number(event.target.value) : null)}>
          <option value="">请选择项目</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.project_name}
            </option>
          ))}
        </select>
      </label>
      <button className="button" type="button" onClick={() => setManagerOpen(true)}>
        <FolderCog size={18} />
        项目管理
      </button>
      {managerOpen && <ProjectManagerModal onClose={() => setManagerOpen(false)} />}
    </div>
  );
}
