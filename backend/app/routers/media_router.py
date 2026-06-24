from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app import models
from app.database import get_db
from app.services.file_service import media_response_path


router = APIRouter(prefix="/api/media", tags=["media"])


@router.get("/{media_id}")
def get_media(media_id: int, db: Session = Depends(get_db)) -> FileResponse:
    media = db.get(models.MediaFile, media_id)
    if not media:
        raise HTTPException(status_code=404, detail="媒体记录不存在")
    path = media_response_path(media)
    return FileResponse(path, filename=media.filename)
