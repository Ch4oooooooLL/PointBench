import re
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import STORAGE_DIR, get_db
from app.schemas import CrackRecordOut
from app.services.file_service import resolve_stored_path
from app.utils.hash_utils import file_sha256
from app.utils.path_utils import safe_project_dir


router = APIRouter(prefix="/api", tags=["crack-records"])

BACKEND_ROOT = Path(__file__).resolve().parents[2]

# 允许的图片扩展名白名单（裂纹记录上传的是图片）
ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
# 单个上传文件大小上限：20MB
MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _safe_filename(filename: str) -> str:
    name = Path(filename).name.strip() or "crack-image"
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


def _relative_to_backend(path: Path) -> str:
    return str(path.relative_to(BACKEND_ROOT))


def _record_out(record: models.CrackRecord) -> CrackRecordOut:
    return CrackRecordOut.model_validate(
        {
            "id": record.id,
            "project_db_id": record.project_db_id,
            "point_db_id": record.point_db_id,
            "test_run_id": record.test_run_id,
            "cycle_count": record.cycle_count,
            "filename": record.filename,
            "content_type": record.content_type,
            "sha256": record.sha256,
            "remark": record.remark,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "point_id": record.point.point_id,
            "point_name": record.point.point_name,
            "run_name": record.run.run_name if record.run else None,
        }
    )


def _load_project_record(record_id: int, db: Session) -> models.CrackRecord:
    record = db.execute(
        select(models.CrackRecord)
        .options(selectinload(models.CrackRecord.point), selectinload(models.CrackRecord.run))
        .where(models.CrackRecord.id == record_id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=404, detail="裂纹记录不存在")
    return record


@router.get("/projects/{project_id}/crack-records", response_model=list[CrackRecordOut])
def list_project_crack_records(project_id: int, db: Session = Depends(get_db)) -> list[CrackRecordOut]:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    records = db.execute(
        select(models.CrackRecord)
        .options(selectinload(models.CrackRecord.point), selectinload(models.CrackRecord.run))
        .where(models.CrackRecord.project_db_id == project_id)
        .order_by(models.CrackRecord.cycle_count.desc(), models.CrackRecord.created_at.desc())
    ).scalars()
    return [_record_out(record) for record in records]


@router.post("/projects/{project_id}/crack-records", response_model=CrackRecordOut)
async def create_project_crack_record(
    project_id: int,
    point_db_id: int = Form(...),
    test_run_id: int | None = Form(None),
    cycle_count: int | None = Form(None),
    remark: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> CrackRecordOut:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    point = db.get(models.TestPoint, point_db_id)
    if not point or point.project_db_id != project_id:
        raise HTTPException(status_code=400, detail="点位不属于当前项目")
    run = None
    if test_run_id is not None:
        run = db.get(models.TestRun, test_run_id)
        if not run or run.project_db_id != project_id:
            raise HTTPException(status_code=400, detail="测试轮次不属于当前项目")
        if cycle_count is not None and cycle_count != run.cycle_count:
            raise HTTPException(status_code=400, detail="填写的循环次数与所选测试轮次不一致")
        cycle_count = run.cycle_count
    if cycle_count is None:
        raise HTTPException(status_code=400, detail="请选择或填写循环次数")
    if cycle_count < 0:
        raise HTTPException(status_code=400, detail="循环次数不能为负数")
    if not file.filename:
        raise HTTPException(status_code=400, detail="请选择裂纹图片")
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持上传图片文件")

    content = await file.read()
    # 大小限制 + magic bytes 校验（基于实际字节，不信任客户端声明的 content_type）
    _validate_image_upload(file, content)

    safe_name = _safe_filename(file.filename)
    target_dir = safe_project_dir(project.project_id) / "cracks" / str(point.id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{uuid.uuid4().hex[:10]}_{safe_name}"
    with target.open("wb") as output:
        output.write(content)

    record = models.CrackRecord(
        project_db_id=project_id,
        point_db_id=point.id,
        test_run_id=run.id if run else None,
        cycle_count=cycle_count,
        stored_path=_relative_to_backend(target),
        filename=safe_name,
        content_type=file.content_type,
        sha256=file_sha256(target),
        remark=remark.strip() if remark else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    record = _load_project_record(record.id, db)
    return _record_out(record)


@router.put("/crack-records/{record_id}", response_model=CrackRecordOut)
async def update_crack_record(
    record_id: int,
    point_db_id: int = Form(...),
    test_run_id: int | None = Form(None),
    cycle_count: int | None = Form(None),
    remark: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
) -> CrackRecordOut:
    record = _load_project_record(record_id, db)
    point = db.get(models.TestPoint, point_db_id)
    if not point or point.project_db_id != record.project_db_id:
        raise HTTPException(status_code=400, detail="点位不属于当前项目")

    run = None
    if test_run_id is not None:
        run = db.get(models.TestRun, test_run_id)
        if not run or run.project_db_id != record.project_db_id:
            raise HTTPException(status_code=400, detail="测试轮次不属于当前项目")
        if cycle_count is not None and cycle_count != run.cycle_count:
            raise HTTPException(status_code=400, detail="填写的循环次数与所选测试轮次不一致")
        cycle_count = run.cycle_count
    if cycle_count is None:
        raise HTTPException(status_code=400, detail="请选择或填写循环次数")
    if cycle_count < 0:
        raise HTTPException(status_code=400, detail="循环次数不能为负数")
    if file and file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持上传图片文件")

    old_stored_path = resolve_stored_path(record.stored_path)
    if file and file.filename:
        content = await file.read()
        # 大小限制 + magic bytes 校验（基于实际字节，不信任客户端声明的 content_type）
        _validate_image_upload(file, content)
        safe_name = _safe_filename(file.filename)
        project = db.get(models.Project, record.project_db_id)
        target_dir = safe_project_dir(project.project_id) / "cracks" / str(point.id)
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / f"{uuid.uuid4().hex[:10]}_{safe_name}"
        with target.open("wb") as output:
            output.write(content)
        record.stored_path = _relative_to_backend(target)
        record.filename = safe_name
        record.content_type = file.content_type
        record.sha256 = file_sha256(target)

    record.point_db_id = point.id
    record.test_run_id = run.id if run else None
    record.cycle_count = cycle_count
    record.remark = remark.strip() if remark else None
    db.commit()
    if file and file.filename and old_stored_path.exists() and old_stored_path != resolve_stored_path(record.stored_path):
        old_stored_path.unlink()
    record = _load_project_record(record.id, db)
    return _record_out(record)


@router.get("/crack-records/{record_id}/image")
def get_crack_record_image(record_id: int, db: Session = Depends(get_db)) -> FileResponse:
    record = db.get(models.CrackRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="裂纹记录不存在")
    # 与 media_router 保持一致：先做根目录包含校验，防止 stored_path 越界读取
    path = resolve_stored_path(record.stored_path)
    if not path.exists():
        raise HTTPException(status_code=404, detail="裂纹图片不存在")
    return FileResponse(path, filename=record.filename, media_type=record.content_type or "application/octet-stream")


@router.delete("/crack-records/{record_id}")
def delete_crack_record(record_id: int, db: Session = Depends(get_db)) -> dict:
    record = db.get(models.CrackRecord, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="裂纹记录不存在")
    stored = resolve_stored_path(record.stored_path)
    db.delete(record)
    db.commit()
    if stored.exists():
        stored.unlink()
    return {"ok": True, "action": "permanently_deleted"}
