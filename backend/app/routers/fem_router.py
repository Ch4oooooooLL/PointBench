import logging
from typing import Annotated

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.services.fem import FemPreviewError, fem_preview_service

logger = logging.getLogger("app.fem_router")

router = APIRouter(prefix="/api/fem-preview", tags=["fem-preview"])


@router.post("/upload")
async def upload_fem_preview(
    files: Annotated[list[UploadFile], File(description="FEM 模型文件，文件名可携带相对路径")],
) -> dict:
    """接收一个或多个 .fem/.dat 文件（含 INCLUDE 引用的配套文件），生成 3D 预览产物。"""

    uploads: list[tuple[str, bytes]] = []
    for upload in files or []:
        content = await upload.read()
        uploads.append((upload.filename or "", content))
    try:
        return fem_preview_service.create_preview(uploads)
    except FemPreviewError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{preview_id}/model.glb")
async def get_fem_model_glb(preview_id: str) -> FileResponse:
    try:
        preview_dir = fem_preview_service.resolve_preview_dir(preview_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="预览不存在或已过期") from exc
    glb_path = preview_dir / "model.glb"
    if not glb_path.is_file():
        raise HTTPException(status_code=404, detail="预览产物缺失")
    return FileResponse(glb_path, media_type="model/gltf-binary")


@router.get("/{preview_id}/mapping.json")
async def get_fem_mapping(preview_id: str) -> FileResponse:
    try:
        preview_dir = fem_preview_service.resolve_preview_dir(preview_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="预览不存在或已过期") from exc
    mapping_path = preview_dir / "mapping.json"
    if not mapping_path.is_file():
        raise HTTPException(status_code=404, detail="预览产物缺失")
    return FileResponse(mapping_path, media_type="application/json")
