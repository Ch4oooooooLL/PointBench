import re
from pathlib import Path

from fastapi import HTTPException

from app.database import STORAGE_DIR

PROJECT_ID_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$"


def validate_project_id(project_id: str) -> str:
    """校验 project_id 格式，只允许字母、数字、下划线和短横线。

    规则：
    1. 必须以字母或数字开头
    2. 后续只允许 A-Z a-z 0-9 _ -
    3. 最大长度 64 个字符
    4. 不允许空格、斜杠、反斜杠、点号、中文等
    """
    if not re.fullmatch(PROJECT_ID_PATTERN, project_id):
        raise HTTPException(status_code=400, detail="项目编号只能包含字母、数字、下划线和短横线，且不能以符号开头")
    return project_id


def safe_project_dir(project_id: str) -> Path:
    """返回项目在 storage/projects 下的安全路径。

    先校验 project_id 格式，再确保解析后的路径仍然在 storage/projects 目录内，
    防止路径穿越攻击。
    """
    validate_project_id(project_id)

    root = (STORAGE_DIR / "projects").resolve()
    path = (root / project_id).resolve()

    if path != root and root not in path.parents:
        raise HTTPException(status_code=400, detail="非法项目路径")

    return path


def safe_dewesoft_dir(project_id: str) -> Path:
    """返回 Dewesoft 文件在 storage/dewesoft 下的安全路径。"""
    validate_project_id(project_id)

    root = (STORAGE_DIR / "dewesoft").resolve()
    path = (root / project_id).resolve()

    if path != root and root not in path.parents:
        raise HTTPException(status_code=400, detail="非法 Dewesoft 存储路径")

    return path


def safe_fem_dir(project_id: str) -> Path:
    """返回项目 FEM 模型目录（storage/projects/<project_id>/fem）的安全路径。"""
    return safe_project_dir(project_id) / "fem"
