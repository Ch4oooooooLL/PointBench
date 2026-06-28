from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import get_db
from app.schemas import DewesoftImportOut
from app.services.file_service import resolve_stored_path
from app.services.dewesoft_service import import_dewesoft_file, save_dewesoft_upload


router = APIRouter(prefix="/api/dewesoft", tags=["dewesoft"])


@router.post("/projects/{project_id}/imports", response_model=DewesoftImportOut)
async def create_dewesoft_import(
    project_id: int,
    cycle_count: int = Form(...),
    run_name: str | None = Form(None),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> DewesoftImportOut:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    upload_path = await save_dewesoft_upload(project, file)
    import_job = import_dewesoft_file(db, project_id, cycle_count, run_name, upload_path, file.filename)
    return DewesoftImportOut.model_validate(import_job)


@router.get("/projects/{project_id}/imports", response_model=list[DewesoftImportOut])
def list_dewesoft_imports(project_id: int, db: Session = Depends(get_db)) -> list[DewesoftImportOut]:
    if not db.get(models.Project, project_id):
        raise HTTPException(status_code=404, detail="项目不存在")
    imports = db.execute(
        select(models.DewesoftImport)
        .options(selectinload(models.DewesoftImport.channels))
        .where(models.DewesoftImport.project_db_id == project_id)
        .order_by(models.DewesoftImport.created_at.desc())
    ).scalars()
    return [DewesoftImportOut.model_validate(item) for item in imports]


@router.get("/imports/{import_id}", response_model=DewesoftImportOut)
def get_dewesoft_import(import_id: int, db: Session = Depends(get_db)) -> DewesoftImportOut:
    import_job = db.execute(
        select(models.DewesoftImport)
        .options(selectinload(models.DewesoftImport.channels))
        .where(models.DewesoftImport.id == import_id)
    ).scalar_one_or_none()
    if not import_job:
        raise HTTPException(status_code=404, detail="Dewesoft 导入记录不存在")
    return DewesoftImportOut.model_validate(import_job)


@router.delete("/imports/{import_id}")
def delete_dewesoft_import(
    import_id: int,
    permanent: bool = Query(False, description="永久删除（同时删除关联测量数据和文件）"),
    db: Session = Depends(get_db),
) -> dict:
    """删除 Dewesoft 导入记录。默认软删除（标记为 disabled），数据仍参与趋势分析。

    设置 permanent=true 可永久删除记录、关联测量数据和原始文件。
    """
    import_job = db.get(models.DewesoftImport, import_id)
    if not import_job:
        raise HTTPException(status_code=404, detail="Dewesoft 导入记录不存在")

    if permanent:
        # 永久删除：清理关联的测量数据和文件
        stored = resolve_stored_path(import_job.stored_path) if import_job.stored_path else None
        # 删除关联的 DewesoftChannel 和 MeasurementRecord
        for channel in import_job.channels:
            if channel.measurement_id:
                measurement = db.get(models.MeasurementRecord, channel.measurement_id)
                if measurement:
                    db.delete(measurement)
            db.delete(channel)
        db.delete(import_job)
        db.commit()
        if stored and stored.exists():
            stored.unlink()
        return {"ok": True, "action": "permanently_deleted"}

    # 软删除：标记为 disabled
    import_job.status = "disabled"
    import_job.message = (import_job.message or "") + "；已禁用，数据仍保留在趋势分析中"
    db.commit()
    return {
        "ok": True,
        "action": "disabled",
        "message": "导入记录已禁用。关联的测量数据仍保留。如需彻底删除请使用 permanent=true",
    }
