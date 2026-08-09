"""审计日志工具 —— 记录所有写操作的追溯信息。"""
import json
from typing import Any

from sqlalchemy.orm import Session

from app import models


def log_action(
    db: Session,
    action: str,
    object_type: str,
    object_id: str | None = None,
    project_id: str | None = None,
    summary: str | None = None,
    before: Any = None,
    after: Any = None,
    user_id: str | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> models.AuditLog:
    """写入一条审计日志。

    Args:
        db: 数据库会话
        action: 操作类型 (create/update/delete/import/export/upload 等)
        object_type: 对象类型 (project/point/media/test_run/measurement/crack 等)
        object_id: 对象标识符
        project_id: 关联项目 ID
        summary: 人类可读的操作摘要
        before: 操作前状态（可序列化对象）
        after: 操作后状态（可序列化对象）
        user_id: 操作者标识（暂用 'system'，后续接入认证体系）
        client_ip: 客户端 IP（可选）
        user_agent: 客户端 User-Agent（可选）
    """
    log_entry = models.AuditLog(
        user_id=user_id or "system",
        action=action,
        object_type=object_type,
        object_id=str(object_id) if object_id is not None else None,
        project_id=project_id,
        summary=summary,
        before_snapshot=json.dumps(before, ensure_ascii=False, default=str) if before is not None else None,
        after_snapshot=json.dumps(after, ensure_ascii=False, default=str) if after is not None else None,
        ip_address=client_ip,
        user_agent=user_agent,
    )
    db.add(log_entry)
    return log_entry
