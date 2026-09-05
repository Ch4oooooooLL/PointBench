"""进程内任务进度注册表与进度回调。

后端耗时任务（FEM 解析/渲染、项目导出打包、导入确认等）在工作线程里通过
``report_task_progress`` 上报进度；前端先注册任务拿到 ``task_id``，再轮询
``GET /api/tasks/{task_id}`` 在任意页面的右下角悬浮窗展示进度。

任务状态机：running -> succeeded | failed。任务结束（成功或失败）后保留
:data:`_RETENTION_SECONDS` 供前端轮询确认收尾，超时后由下一次访问惰性清理。
"""

from __future__ import annotations

import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

_STATE_RUNNING = "running"
_STATE_SUCCEEDED = "succeeded"
_STATE_FAILED = "failed"

# 任务结束后保留的时长：前端需要至少轮询到一次终态（或收到 404）才能收起浮窗。
_RETENTION_SECONDS = 120.0

# task_id -> dict(status, progress, message, label, started_at, updated_at, finished_at, result)
_registry: dict[str, dict[str, Any]] = {}
_registry_lock = threading.Lock()

ProgressSink = Callable[[int, str], None]


def start_task(label: str, *, total: int | None = None) -> str:
    """创建任务并返回 task_id。

    *total* 用于归一化进度；为 None 时由上报方直接传 0..100 的百分比。
    """
    task_id = uuid.uuid4().hex
    with _registry_lock:
        _purge_locked()
        _registry[task_id] = {
            "task_id": task_id,
            "label": label,
            "status": _STATE_RUNNING,
            "progress": 0,
            "total": total,
            "message": "",
            "started_at": time.time(),
            "updated_at": time.time(),
            "finished_at": None,
            "result": None,
            "error": None,
        }
    return task_id


def task_sink(task_id: str, total: int | None = None) -> ProgressSink:
    """返回写进度回调 ``(done, message)``。

    *total* 未在 :func:`start_task` 提供时也可在此传入；此时按 (done, total)
    计算百分比，message 可省略。
    """

    def _report(done: int, message: str) -> None:
        _update_task(
            task_id,
            progress=_compute_progress(done, total if total is not None else _registry.get(task_id, {}).get("total")),
            message=message,
        )

    return _report


def _compute_progress(done: int, total: int | None) -> int:
    if not total:
        return max(0, min(100, int(done)))
    if total <= 0:
        return 100
    return max(0, min(100, int(done * 100 / total)))


def report_task_progress(task_id: str, *, progress: int | None = None, message: str | None = None) -> None:
    """显式上报进度百分比与/或消息（进程内直接调用）。"""
    if task_id not in _registry:
        return
    _update_task(
        task_id,
        progress=progress,
        message=message if message is not None else "",
    )


def _update_task(task_id: str, *, progress: int | None, message: str | None) -> None:
    if task_id not in _registry:
        return
    with _registry_lock:
        record = _registry.get(task_id)
        if record is None or record["status"] != _STATE_RUNNING:
            return
        if progress is not None:
            record["progress"] = max(0, min(100, int(progress)))
        if message:
            record["message"] = message
        record["updated_at"] = time.time()


def succeed_task(task_id: str, *, result: Any = None, message: str | None = None) -> None:
    with _registry_lock:
        record = _registry.get(task_id)
        if record is None:
            return
        record["status"] = _STATE_SUCCEEDED
        record["progress"] = 100
        record["message"] = message or record["message"]
        record["result"] = result
        record["finished_at"] = time.time()
        record["updated_at"] = time.time()


def fail_task(task_id: str, *, error: str, message: str | None = None) -> None:
    with _registry_lock:
        record = _registry.get(task_id)
        if record is None:
            return
        record["status"] = _STATE_FAILED
        record["message"] = message or record["message"] or error
        record["error"] = error
        record["finished_at"] = time.time()
        record["updated_at"] = time.time()


def get_task_status(task_id: str) -> dict[str, Any] | None:
    """返回任务快照；任务已过期被清理时返回 None。"""
    now = time.time()
    with _registry_lock:
        record = _registry.get(task_id)
        if record is None:
            return None
        if record["finished_at"] is not None and now - record["finished_at"] > _RETENTION_SECONDS:
            _registry.pop(task_id, None)
            return None
        snapshot = dict(record)
        snapshot["progress"] = int(snapshot["progress"])
    return snapshot


def snapshot_registry() -> dict[str, Any]:
    """测试辅助：导出当前注册表内容。"""
    with _registry_lock:
        return {task_id: dict(record) for task_id, record in _registry.items()}


def clear_registry_for_tests() -> None:
    """测试辅助：清空注册表。"""
    with _registry_lock:
        _registry.clear()


def _purge_locked() -> None:
    """惰性清理已过期的终态任务（调用方需持有锁）。"""
    now = time.time()
    expired = [
        task_id
        for task_id, record in _registry.items()
        if record["finished_at"] is not None and now - record["finished_at"] > _RETENTION_SECONDS
    ]
    for task_id in expired:
        _registry.pop(task_id, None)
