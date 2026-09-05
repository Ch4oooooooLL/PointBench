from fastapi import APIRouter, HTTPException

from app.services.task_progress import get_task_status


router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("/{task_id}")
def get_task(task_id: str) -> dict:
    """查询后端耗时任务的解析/渲染/导出进度。"""
    if not task_id or len(task_id) > 64:
        raise HTTPException(status_code=404, detail="任务不存在")
    status = get_task_status(task_id)
    if status is None:
        # 任务已结束并被清理：前端应停止轮询并自动收起浮窗。
        raise HTTPException(status_code=404, detail="任务不存在或已结束")
    return status
