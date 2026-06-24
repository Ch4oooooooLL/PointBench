from pathlib import Path

from fastapi import HTTPException

from app import models
from app.database import STORAGE_DIR


def resolve_stored_path(stored_path: str) -> Path:
    root = STORAGE_DIR.resolve()
    path = (Path(__file__).resolve().parents[2] / stored_path).resolve()
    if root not in path.parents and path != root:
        raise HTTPException(status_code=400, detail="媒体文件路径越界")
    return path


def media_response_path(media: models.MediaFile) -> Path:
    path = resolve_stored_path(media.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="媒体文件不存在")
    return path
