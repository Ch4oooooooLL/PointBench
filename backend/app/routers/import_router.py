from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import ImportConfirmRequest, ImportConfirmResponse, ImportPreview
from app.services.import_service import confirm_import, create_folder_preview, create_preview


router = APIRouter(prefix="/api/import", tags=["import"])


@router.post("/preview", response_model=ImportPreview)
async def preview_import(file: UploadFile = File(...), db: Session = Depends(get_db)) -> ImportPreview:
    return await create_preview(db, file)


@router.post("/preview-folder", response_model=ImportPreview)
async def preview_folder_import(files: list[UploadFile] = File(...), db: Session = Depends(get_db)) -> ImportPreview:
    return await create_folder_preview(db, files)


@router.post("/confirm", response_model=ImportConfirmResponse)
def confirm_import_route(payload: ImportConfirmRequest, db: Session = Depends(get_db)) -> ImportConfirmResponse:
    project = confirm_import(db, payload.temporary_import_id)
    return ImportConfirmResponse(project_db_id=project.id, project_id=project.project_id, project_name=project.project_name)
