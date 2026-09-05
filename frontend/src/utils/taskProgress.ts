import { api } from '../api/client';
import { TaskStatusPayload } from '../types';

/**
 * 后端耗时任务进度中心。
 *
 * 页面在启动耗时任务（FEM 解析/渲染、项目导出打包等）后调用
 * ``watchTask(taskId, label)``：这里以 ~500ms 间隔静默轮询
 * ``GET /api/tasks/{taskId}``，把进度写入内存 store，右下角悬浮窗订阅展示；
 * 任务成功/失败（或后端已清理返回 404）后保留数秒自动收起。
 */

export type TaskPhase = 'running' | 'succeeded' | 'failed';

export interface TaskSnapshot {
  taskId: string;
  label: string;
  status: TaskPhase;
  progress: number; // 0-100
  message: string;
  result?: { download_url?: string; filename?: string } | null;
}

type Listener = () => void;

const tasks = new Map<string, TaskSnapshot>();
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const settlers = new Map<string, Array<(snapshot: TaskSnapshot) => void>>();

const DONE_VISIBLE_MS = 4000;
const FAILED_VISIBLE_MS = 10_000;
const POLL_INTERVAL_MS = 500;

// useSyncExternalStore 要求 getSnapshot 返回引用稳定的值（否则 React 会误判
// store 每次都被修改而无限重渲染），因此这里缓存一份快照，仅在任务实际变化
// （即 emit 前）时重建。
let cachedSnapshots: TaskSnapshot[] = [];

function emit() {
  cachedSnapshots = [...tasks.values()];
  for (const listener of listeners) listener();
}

function scheduleRemove(taskId: string, keepMs: number) {
  if (timers.has(taskId)) return;
  timers.set(
    taskId,
    setTimeout(() => {
      timers.delete(taskId);
      tasks.delete(taskId);
      emit();
    }, keepMs),
  );
}

function settle(taskId: string, snapshot: TaskSnapshot) {
  tasks.set(taskId, snapshot);
  emit();
  const pending = settlers.get(taskId);
  if (pending) {
    settlers.delete(taskId);
    for (const resolve of pending) resolve(snapshot);
  }
}

export function subscribeTaskProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTaskSnapshots(): TaskSnapshot[] {
  return cachedSnapshots;
}

export function getTaskSnapshot(taskId: string): TaskSnapshot | undefined {
  return tasks.get(taskId);
}

/**
 * 开始轮询一个后端任务并订阅进度。返回取消函数。
 * *onSettled* 在任务成功/失败/消失时回调一次。
 */
export function watchTask(
  taskId: string,
  label: string,
  onSettled?: (snapshot: TaskSnapshot) => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
  if (onSettled) {
    const queue = settlers.get(taskId) ?? [];
    queue.push(onSettled);
    settlers.set(taskId, queue);
  }
  const existing = tasks.get(taskId);
  if (!existing) {
    tasks.set(taskId, { taskId, label, status: 'running', progress: 0, message: '' });
    emit();
  }

  const tick = async () => {
    if (cancelled) return;
    try {
      const data = await api.get<TaskStatusPayload>(`/api/tasks/${taskId}`, {
        silent: true,
        timeoutMs: 15_000,
      });
      if (cancelled) return;
      const snapshot: TaskSnapshot = {
        taskId,
        label,
        status: data.status,
        progress: data.progress,
        message: data.message || label,
        result: data.result,
      };
      if (data.status === 'running') {
        tasks.set(taskId, snapshot);
        emit();
        timer = setTimeout(tick, POLL_INTERVAL_MS);
      } else {
        settle(taskId, snapshot);
        scheduleRemove(taskId, snapshot.status === 'failed' ? FAILED_VISIBLE_MS : DONE_VISIBLE_MS);
      }
    } catch (error) {
      if (cancelled) return;
      // 404 或网络错误：任务已结束或被清理，视为完成（未知结果）。
      const message = error instanceof Error ? error.message : '任务已结束';
      settle(taskId, {
        taskId,
        label,
        status: 'failed',
        progress: 100,
        message,
        result: undefined,
      });
      scheduleRemove(taskId, FAILED_VISIBLE_MS);
    }
  };
  timer = setTimeout(tick, 0);
  return cancel;
}

/**
 * 等待任务到达终态并返回最终快照。内部先注册 onSettled 再启动轮询。
 */
export function waitForTask(taskId: string, label: string): Promise<TaskSnapshot> {
  return new Promise((resolve) => {
    const existing = tasks.get(taskId);
    if (existing && existing.status !== 'running') {
      resolve(existing);
      return;
    }
    watchTask(taskId, label, resolve);
  });
}

/** 清理某个任务（页面不再关心时）。 */
export function dismissTask(taskId: string) {
  const timer = timers.get(taskId);
  if (timer) clearTimeout(timer);
  timers.delete(taskId);
  tasks.delete(taskId);
  emit();
}
