import { ActivitySquare, BookOpen, Camera, FilePlus2, FileUp, LayoutDashboard, ListChecks, Settings } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';

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
            <NavLink to="/" end>
              <LayoutDashboard size={18} />
              项目概览
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
      {firstUseNoticeOpen && <FirstUseNoticeModal onOpenGuide={openUsageGuide} onSkip={closeFirstUseNotice} />}
    </div>
  );
}

function FirstUseNoticeModal({ onOpenGuide, onSkip }: { onOpenGuide: () => void; onSkip: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="modal first-use-modal" role="dialog" aria-modal="true" aria-labelledby="first-use-title">
        <div className="first-use-icon">
          <BookOpen size={28} />
        </div>
        <h2 id="first-use-title">首次使用前请阅读使用说明</h2>
        <p>
          为了确保项目导入、点位维护、测试数据录入和裂纹记录流程准确，请先仔细阅读使用说明。
          后续也可以随时从左侧导航栏的“使用说明”再次查看。
        </p>
        <div className="modal-actions first-use-actions">
          <button className="button" onClick={onSkip}>跳过</button>
          <button className="button primary" onClick={onOpenGuide}>跳转到使用说明</button>
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
