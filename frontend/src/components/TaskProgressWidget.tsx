import { AlertTriangle, Box, CheckCircle2, Package, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import {
  TaskSnapshot,
  dismissTask,
  getTaskSnapshots,
  subscribeTaskProgress,
} from '../utils/taskProgress';

function TaskIcon({ label }: { label: string }) {
  if (label.includes('FEM') || label.includes('模型')) return <Box size={16} />;
  if (label.includes('导出')) return <Package size={16} />;
  return <Box size={16} />;
}

export function TaskProgressWidget() {
  const snapshots = useSyncExternalStore(
    subscribeTaskProgress,
    getTaskSnapshots,
    getTaskSnapshots,
  );

  if (snapshots.length === 0) return null;

  // 最多并排展示 3 个任务，其余折叠进“还有 N 个任务”计数。
  const visible = snapshots.slice(0, 3);
  const hiddenCount = snapshots.length - visible.length;

  return (
    <div className="task-progress-widget" aria-live="polite" aria-atomic="false">
      {visible.map((snapshot) => (
        <TaskProgressCard key={snapshot.taskId} snapshot={snapshot} />
      ))}
      {hiddenCount > 0 && (
        <div className="task-progress-more">还有 {hiddenCount} 个任务进行中</div>
      )}
    </div>
  );
}

function TaskProgressCard({ snapshot }: { snapshot: TaskSnapshot }) {
  const { taskId, label, status, progress, message } = snapshot;
  const finished = status !== 'running';

  return (
    <div className={`task-progress-card task-progress-${status}`}>
      <div className="task-progress-head">
        <span className="task-progress-icon">
          {status === 'succeeded' ? (
            <CheckCircle2 size={16} />
          ) : status === 'failed' ? (
            <AlertTriangle size={16} />
          ) : (
            <TaskIcon label={label} />
          )}
        </span>
        <span className="task-progress-title">
          {status === 'succeeded'
            ? `${label} 完成`
            : status === 'failed'
              ? `${label} 失败`
              : label}
        </span>
        <button
          className="task-progress-dismiss"
          type="button"
          title="关闭提示"
          aria-label="关闭提示"
          onClick={() => dismissTask(taskId)}
        >
          <X size={14} />
        </button>
      </div>

      {status === 'running' ? (
        <>
          <div className="task-progress-track">
            <div className="task-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
          </div>
          <div className="task-progress-meta">
            <span>{message || '处理中…'}</span>
            <span className="task-progress-percent">{Math.round(progress)}%</span>
          </div>
        </>
      ) : (
        <div className={`task-progress-meta task-progress-result ${status === 'failed' ? 'is-error' : ''}`}>
          <span>{message || (status === 'succeeded' ? '已完成' : '已结束')}</span>
        </div>
      )}
    </div>
  );
}
