from pathlib import Path

from fastapi import HTTPException

from app import models
from app.database import STORAGE_DIR


def resolve_stored_path(stored_path: str) -> Path:
    root = STORAGE_DIR.resolve()
    raw_path = Path(stored_path)
    if raw_path.is_absolute():
        path = raw_path.resolve()
    elif raw_path.parts and raw_path.parts[0] == STORAGE_DIR.name:
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
