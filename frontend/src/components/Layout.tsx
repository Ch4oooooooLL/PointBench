import { ActivitySquare, BookOpen, Box, Camera, FilePlus2, FileUp, LayoutDashboard, ListChecks, Settings, Workflow } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { TaskProgressWidget } from './TaskProgressWidget';

const FIRST_USE_COOKIE = 'pointbench_first_use_notice_seen';
const FIRST_USE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function Layout() {
  const [firstUseNoticeOpen, setFirstUseNoticeOpen] = useState(() => !hasCookie(FIRST_USE_COOKIE));
  const { projectsError, isLoadingProjects, refreshProjects } = useAppContext();
  const navigate = useNavigate();

  function closeFirstUseNotice() {
    setCookie(FIRST_USE_COOKIE, 'true', FIRST_USE_COOKIE_MAX_AGE_SECONDS);
    setFirstUseNoticeOpen(false);
  }

  function openUsageGuide() {
    closeFirstUseNotice();
    navigate('/help');
  }

  function openWorkflowGuide() {
    closeFirstUseNotice();
    navigate('/workflow');
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <ActivitySquare size={24} />
            <div>
              <strong>点位分析</strong>
              <span>实验数据工作台</span>
            </div>
          </div>
          <nav>
            <NavLink to="/fem-preview">
              <Box size={18} />
              模型预览
            </NavLink>
            <NavLink to="/" end>
              <LayoutDashboard size={18} />
              数据概览
            </NavLink>
            <NavLink to="/project-detail">
              <ListChecks size={18} />
              项目详情
            </NavLink>
            <NavLink to="/crack-records">
              <Camera size={18} />
              裂纹记录
            </NavLink>
            <NavLink to="/projects/new">
              <FilePlus2 size={18} />
              创建项目
            </NavLink>
            <NavLink to="/import">
              <FileUp size={18} />
              导入项目
            </NavLink>
            <NavLink to="/help">
              <BookOpen size={18} />
              使用说明
            </NavLink>
            <NavLink to="/workflow">
              <Workflow size={18} />
              使用流程
            </NavLink>
          </nav>
        </div>
        <NavLink className="settings-button" to="/settings" title="设置">
          <Settings size={18} />
          设置
        </NavLink>
      </aside>
      <main className="content">
        {projectsError && (
          <div className="alert danger global-alert">
            项目列表加载失败：{projectsError}
            <button className="button" type="button" disabled={isLoadingProjects} onClick={() => refreshProjects().catch(() => undefined)}>
              重试
            </button>
          </div>
        )}
        <Outlet />
      </main>
      {firstUseNoticeOpen && (
        <FirstUseNoticeModal onOpenGuide={openUsageGuide} onOpenWorkflow={openWorkflowGuide} onSkip={closeFirstUseNotice} />
      )}
      <TaskProgressWidget />
    </div>
  );
}

function FirstUseNoticeModal({
  onOpenGuide,
  onOpenWorkflow,
  onSkip,
}: {
  onOpenGuide: () => void;
  onOpenWorkflow: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="modal-backdrop">
      <div className="modal first-use-modal" role="dialog" aria-modal="true" aria-labelledby="first-use-title">
        <div className="first-use-icon">
          <BookOpen size={28} />
        </div>
        <h2 id="first-use-title">首次使用前建议先阅读使用说明和使用流程</h2>
        <p>
          为了确保项目导入、点位维护、测试数据录入、裂纹记录和阶段归档流程准确，请先阅读相关说明。
          后续也可以随时从左侧导航栏查看“使用说明”和“使用流程”。
        </p>
        <div className="modal-actions first-use-actions">
          <button className="button" onClick={onSkip}>跳过</button>
          <button className="button" onClick={onOpenGuide}>查看使用说明</button>
          <button className="button primary" onClick={onOpenWorkflow}>阅读使用流程</button>
        </div>
      </div>
    </div>
  );
}

function hasCookie(name: string): boolean {
  return document.cookie.split(';').some((item) => item.trim().startsWith(`${name}=`));
}

function setCookie(name: string, value: string, maxAgeSeconds: number) {
  document.cookie = `${name}=${encodeURIComponent(value)}; max-age=${maxAgeSeconds}; path=/; SameSite=Lax`;
}
