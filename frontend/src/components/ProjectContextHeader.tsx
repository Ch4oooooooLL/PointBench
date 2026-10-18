import { ArrowUpRight, FolderKanban, ListChecks, Box, ActivitySquare, Camera, ClipboardPlus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { ProjectSelector } from './ProjectSelector';

export type ProjectWorkspaceSection = 'overview' | 'ledger' | 'model' | 'entry' | 'analysis' | 'cracks';

const workspaceLinks: Array<{
  key: ProjectWorkspaceSection;
  label: string;
  icon: typeof FolderKanban;
  path: (projectId: number) => string;
}> = [
  { key: 'overview', label: '总览', icon: FolderKanban, path: () => '/overview' },
  { key: 'ledger', label: '点位台账', icon: ListChecks, path: () => '/project-detail' },
  { key: 'model', label: '模型绑定', icon: Box, path: () => '/fem-preview' },
  { key: 'entry', label: '数据录入', icon: ClipboardPlus, path: (projectId) => `/projects/${projectId}/test-runs/new` },
  { key: 'analysis', label: '分析复核', icon: ActivitySquare, path: (projectId) => `/projects/${projectId}/analysis` },
  { key: 'cracks', label: '裂纹图库', icon: Camera, path: () => '/crack-records' },
];

export function ProjectContextHeader({
  active,
  showTabs = true,
}: {
  active: ProjectWorkspaceSection;
  showTabs?: boolean;
}) {
  const { selectedProject, selectedProjectId } = useAppContext();
  const projectTitle = selectedProject?.project_name || '未选择项目';
  const meta = [selectedProject?.project_id, selectedProject?.test_stage, selectedProject?.test_type]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={`workspace-context${showTabs ? '' : ' is-overview'}`}>
      <div className="workspace-context-main">
        <div className="workspace-project-mark">
          <FolderKanban size={20} />
        </div>
        <div className="workspace-project-copy">
          <span>当前项目</span>
          <strong>{projectTitle}</strong>
          <small>{meta || '请选择一个项目开始工作'}</small>
        </div>
        <ProjectSelector compact embedded />
      </div>
      {showTabs && <nav className="workspace-tabs" aria-label="项目工作区">
        {workspaceLinks.map((item) => {
          const Icon = item.icon;
          const to = selectedProjectId ? item.path(selectedProjectId) : '/overview';
          return (
            <Link key={item.key} className={active === item.key ? 'active' : ''} to={to}>
              <Icon size={15} />
              {item.label}
              {active === item.key && <ArrowUpRight size={13} className="workspace-tab-arrow" />}
            </Link>
          );
        })}
      </nav>}
    </div>
  );
}
