from pathlib import Path

from fastapi import HTTPException

from app import models
from app.database import STORAGE_DIR


def storage_relative_path(path: Path) -> str:
    """Return ``path`` as a string relative to the storage root.

    The database stores paths as ``storage/...`` (legacy, relative to the
    backend directory) or ``...`` (relative to STORAGE_DIR).  Storing the
    STORAGE_DIR-relative form keeps the database independent of where the
    storage root actually lives (source tree, install-local data root, ...).
    """
    resolved = path.resolve()
    root = STORAGE_DIR.resolve()
    try:
        return resolved.relative_to(root).as_posix()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="存储路径越界") from exc


def resolve_stored_path(stored_path: str) -> Path:
    root = STORAGE_DIR.resolve()
    raw_path = Path(stored_path)
    if raw_path.is_absolute():
        path = raw_path.resolve()
    elif raw_path.parts and raw_path.parts[0] in (STORAGE_DIR.name, "storage"):
        # 兼容旧版本数据库中的 "storage/..." 前缀（相对 backend 目录的写法）
        path = (STORAGE_DIR / Path(*raw_path.parts[1:])).resolve()
    else:
        path = (STORAGE_DIR / raw_path).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=400, detail="媒体文件路径越界")
    return path


def media_response_path(media: models.MediaFile) -> Path:
    path = resolve_stored_path(media.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    return path
