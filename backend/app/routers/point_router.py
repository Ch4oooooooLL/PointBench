import json
import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import get_db
from app.schemas import MediaFileOut, PointOut, PointUpdate
from app.services.file_service import resolve_stored_path, storage_relative_path
from app.utils.hash_utils import file_sha256
from app.utils.path_utils import safe_project_dir


router = APIRouter(prefix="/api/points", tags=["points"])

# 允许的图片扩展名白名单
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# 单个上传文件大小上限：20MB
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _safe_filename(filename: str) -> str:
    name = Path(filename).name.strip() or "image"
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    # 扩展名白名单校验：仅允许图片格式
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES:
        raise HTTPException(status_code=400, detail="只支持 .png/.jpg/.jpeg/.gif/.webp 格式的图片")
    return name


def _validate_image_upload(file: UploadFile, content: bytes) -> None:
    """上传图片安全校验：大小限制 + magic bytes 文件类型校验。

    只信任内容实际字节，不信任客户端声明的 content_type。
    """
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="图片大小不能超过 20MB")
    magic = content[:16]
    is_valid = (
        magic.startswith(b"\x89PNG\r\n\x1a\n")
        or magic.startswith(b"\xff\xd8\xff")
        or magic.startswith(b"GIF87a")
        or magic.startswith(b"GIF89a")
        or (magic.startswith(b"RIFF") and magic[8:12] == b"WEBP")
    )
    if not is_valid:
        raise HTTPException(status_code=400, detail="文件内容不是有效的图片（PNG/JPEG/GIF/WEBP）")


@router.get("/{point_id}", response_model=PointOut)
def get_point(point_id: int, db: Session = Depends(get_db)) -> PointOut:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.channels), selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.cae_mappings))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    return PointOut.model_validate(point)


@router.put("/{point_id}", response_model=PointOut)
def update_point(point_id: int, payload: PointUpdate, db: Session = Depends(get_db)) -> PointOut:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.channels), selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.cae_mappings))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    data = payload.model_dump(exclude_unset=True)
    if "point_id" in data:
        next_point_id = (data["point_id"] or "").strip()
        if not next_point_id:
            raise HTTPException(status_code=400, detail="点位编号不能为空")
        exists = db.scalar(
            select(models.TestPoint).where(
                models.TestPoint.project_db_id == point.project_db_id,
                models.TestPoint.point_id == next_point_id,
                models.TestPoint.id != point.id,
            )
        )
        if exists:
            raise HTTPException(status_code=400, detail="点位编号已存在")
        data["point_id"] = next_point_id
    if "point_name" in data and not (data["point_name"] or "").strip():
        raise HTTPException(status_code=400, detail="点位名称不能为空")
    if "point_type" in data and not (data["point_type"] or "").strip():
        raise HTTPException(status_code=400, detail="点位类型不能为空")
    if "install_status" in data and not (data["install_status"] or "").strip():
        raise HTTPException(status_code=400, detail="安装状态不能为空")
    for field, value in data.items():
        setattr(point, field, value)
    point.raw_json = json.dumps({"source": "manual", "last_update": data}, ensure_ascii=False)
    db.commit()
    db.refresh(point)
    return PointOut.model_validate(point)


@router.delete("/{point_id}")
def delete_point(point_id: int, db: Session = Depends(get_db)) -> dict:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.media_files), selectinload(models.TestPoint.crack_records))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")

    stored_files = [
        resolve_stored_path(item.stored_path)
        for item in [*point.media_files, *point.crack_records]
        if item.stored_path
    ]
    db.delete(point)
    db.commit()
    for stored in stored_files:
        if stored.exists():
            stored.unlink()
    return {"ok": True, "action": "permanently_deleted"}


@router.post("/{point_id}/media", response_model=MediaFileOut)
async def upload_point_media(
    point_id: int,
    file: UploadFile = File(...),
    media_type: str = Form("overall"),
    db: Session = Depends(get_db),
) -> MediaFileOut:
    point = db.execute(
        select(models.TestPoint)
        .options(selectinload(models.TestPoint.project))
        .where(models.TestPoint.id == point_id)
    ).scalar_one_or_none()
    if not point:
        raise HTTPException(status_code=404, detail="点位不存在")
    if not file.filename:
        raise HTTPException(status_code=400, detail="请选择图片文件")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持上传图片文件")
    if media_type not in {"overall", "local"}:
        raise HTTPException(status_code=400, detail="图片类型只能是 overall 或 local")

    content = await file.read()
    # 大小限制 + magic bytes 校验（基于实际字节，不信任客户端声明的 content_type）
    _validate_image_upload(file, content)

    safe_name = _safe_filename(file.filename)
    target_dir = safe_project_dir(point.project.project_id) / "uploads" / str(point.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid.uuid4().hex[:10]}_{safe_name}"
    with target.open("wb") as output:
        output.write(content)

    media = models.MediaFile(
        project_db_id=point.project_db_id,
        point_db_id=point.id,
        photo_id=f"manual-{uuid.uuid4().hex[:12]}",
        type=media_type,
        path=f"uploads/{point.id}/{safe_name}",
        stored_path=storage_relative_path(target),
        filename=safe_name,
        sha256=file_sha256(target),
        remark="手动上传",
    )
    db.add(media)
    db.commit()
    db.refresh(media)
    return MediaFileOut.model_validate(media)


@router.delete("/{point_id}/media/{media_id}")
def delete_point_media(point_id: int, media_id: int, db: Session = Depends(get_db)) -> dict:
    media = db.get(models.MediaFile, media_id)
    if not media or media.point_db_id != point_id:
        raise HTTPException(status_code=404, detail="媒体记录不存在")
    stored = resolve_stored_path(media.stored_path)
    db.delete(media)
    db.commit()
    if stored.exists():
        stored.unlink()
    return {"ok": True, "action": "permanently_deleted"}
