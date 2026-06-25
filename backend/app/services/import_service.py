import json
import shutil
import uuid
from collections import Counter
from pathlib import Path, PurePosixPath
from zipfile import BadZipFile, ZipFile

from fastapi import HTTPException, UploadFile
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models
from app.database import STORAGE_DIR
from app.schemas import ImportPreview, ManifestIn
from app.utils.hash_utils import file_sha256
from app.utils.zip_utils import is_safe_zip_path, normalize_zip_name, safe_extract, validate_zip_members


ENCRYPTED_FILE_HINT = "如果文件在公司内网文档加密目录中，请先手动打开或解压为明文文件夹后再导入，或联系 IT 将本系统加入解密白名单。"
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _temp_id() -> str:
    return f"TMP-{uuid.uuid4().hex[:12]}"


def _preview_path(temporary_import_id: str) -> Path:
    return STORAGE_DIR / "temp" / temporary_import_id


def _load_manifest(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="manifest.json 必须使用 UTF-8 编码") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"manifest.json 不是合法 JSON: {exc}") from exc


def _duplicates(values: list[str]) -> list[str]:
    return sorted([value for value, count in Counter(values).items() if value and count > 1])


def _relative_to_project(path: Path) -> str:
    return str(path.relative_to(PROJECT_ROOT))


def _unsafe_folder_path_error(path: str) -> HTTPException:
    return HTTPException(status_code=400, detail=f"文件夹内路径不安全: {path}")


def _normalize_folder_upload_paths(uploads: list[UploadFile]) -> list[tuple[UploadFile, str]]:
    raw_paths = [normalize_zip_name(upload.filename or "") for upload in uploads]
    if not raw_paths:
        raise HTTPException(status_code=400, detail="请选择包含 manifest.json 的文件夹")
    for raw_path in raw_paths:
        if not is_safe_zip_path(raw_path):
            raise _unsafe_folder_path_error(raw_path)

    paths = raw_paths
    if "manifest.json" not in paths:
        first_parts = [PurePosixPath(path).parts for path in paths]
        common_root = first_parts[0][0] if first_parts and len(first_parts[0]) > 1 else None
        if common_root and all(len(parts) > 1 and parts[0] == common_root for parts in first_parts):
            stripped = [PurePosixPath(*parts[1:]).as_posix() for parts in first_parts]
            if "manifest.json" in stripped:
                paths = stripped

    normalized: list[tuple[UploadFile, str]] = []
    for upload, path in zip(uploads, paths, strict=True):
        if not is_safe_zip_path(path):
            raise _unsafe_folder_path_error(path)
        normalized.append((upload, path))
    return normalized


async def _write_upload(upload: UploadFile, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            output.write(chunk)


def _validate_manifest_business(manifest: ManifestIn, zip_names: set[str], db: Session) -> tuple[list[str], list[str], list[str], list[str], list[str]]:
    warnings: list[str] = []
    errors: list[str] = []
    missing_files: list[str] = []

    if manifest.schema_version != "1.0.0":
        errors.append(f"不支持的 schema_version: {manifest.schema_version}")
    if db.scalar(select(models.Project.id).where(models.Project.project_id == manifest.project.project_id)):
        errors.append(f"项目 {manifest.project.project_id} 已存在，请先删除后重新导入")

    point_ids = [point.point_id for point in manifest.points]
    duplicate_point_ids = _duplicates(point_ids)
    if duplicate_point_ids:
        errors.append("存在重复点位编号")

    channel_names = [
        point.channel.channel_name
        for point in manifest.points
        if point.channel and point.channel.channel_name
    ]
    duplicate_channel_names = _duplicates(channel_names)
    if duplicate_channel_names:
        warnings.append("存在重复通道名，请确认采集系统通道是否需要区分")

    photo_ids: list[str] = []
    for point in manifest.points:
        for photo in point.photos:
            photo_ids.append(photo.photo_id)
            normalized = normalize_zip_name(photo.path)
            if not is_safe_zip_path(normalized):
                errors.append(f"照片路径不安全: {photo.path}")
            if PurePosixPath(normalized).name != photo.filename:
                warnings.append(f"照片 filename 与 path 文件名不一致: {photo.path}")
            if normalized not in zip_names:
                missing_files.append(photo.path)

    duplicate_photo_ids = _duplicates(photo_ids)
    if duplicate_photo_ids:
        errors.append(f"存在重复照片 ID: {', '.join(duplicate_photo_ids)}")
    if missing_files:
        errors.append("存在 manifest 中引用但 zip 内缺失的照片文件")

    if manifest.files:
        file_ids = [file.file_id for file in manifest.files]
        duplicate_file_ids = _duplicates(file_ids)
        if duplicate_file_ids:
            errors.append(f"存在重复文件 ID: {', '.join(duplicate_file_ids)}")
        for file in manifest.files:
            normalized = normalize_zip_name(file.path)
            if not is_safe_zip_path(normalized):
                errors.append(f"附件路径不安全: {file.path}")
            elif normalized not in zip_names:
                warnings.append(f"manifest.files 引用的文件不存在: {file.path}")

    return missing_files, duplicate_point_ids, duplicate_channel_names, warnings, errors


def _build_preview_from_extract(
    db: Session,
    temporary_import_id: str,
    temp_dir: Path,
    extract_dir: Path,
    source_name: str,
    zip_path: Path | None,
    errors: list[str] | None = None,
    warnings: list[str] | None = None,
) -> ImportPreview:
    errors = errors or []
    warnings = warnings or []
    manifest_data: dict | None = None
    manifest: ManifestIn | None = None
    zip_names = {path.relative_to(extract_dir).as_posix() for path in extract_dir.rglob("*") if path.is_file()}

    if "manifest.json" not in zip_names:
        errors.append("导入内容根目录缺少 manifest.json。请选择已解压后的非嵌套文件夹，或上传原始 zip 数据包。")

    if not errors:
        manifest_data = _load_manifest(extract_dir / "manifest.json")

    if manifest_data is not None:
        try:
            manifest = ManifestIn.model_validate(manifest_data)
        except ValidationError as exc:
            validation_errors = [f"{'.'.join(str(p) for p in error['loc'])}: {error['msg']}" for error in exc.errors()]
            errors.extend(validation_errors)

    missing_files: list[str] = []
    duplicate_point_ids: list[str] = []
    duplicate_channel_names: list[str] = []
    if manifest is not None:
        missing_files, duplicate_point_ids, duplicate_channel_names, business_warnings, business_errors = _validate_manifest_business(
            manifest, zip_names, db
        )
        warnings.extend(business_warnings)
        errors.extend(business_errors)

    stored_path = zip_path if zip_path else extract_dir
    job = models.ImportJob(
        export_id=manifest.export_info.export_id if manifest else None,
        project_id=manifest.project.project_id if manifest else None,
        zip_filename=source_name,
        zip_stored_path=_relative_to_project(stored_path),
        temp_dir=_relative_to_project(temp_dir),
        status="previewed" if not errors else "preview_failed",
        message="; ".join(errors or warnings),
    )
    db.add(job)
    db.commit()

    return ImportPreview(
        temporary_import_id=temporary_import_id,
        export_id=manifest.export_info.export_id if manifest else None,
        project_id=manifest.project.project_id if manifest else None,
        project_name=manifest.project.project_name if manifest else None,
        point_count=len(manifest.points) if manifest else 0,
        photo_count=sum(len(point.photos) for point in manifest.points) if manifest else 0,
        missing_files=missing_files,
        duplicate_point_ids=duplicate_point_ids,
        duplicate_channel_names=duplicate_channel_names,
        warnings=warnings,
        errors=errors,
        can_import=not errors and manifest is not None,
    )


async def create_preview(db: Session, upload: UploadFile) -> ImportPreview:
    if not upload.filename or not upload.filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="请上传 zip 文件")

    temporary_import_id = _temp_id()
    temp_dir = _preview_path(temporary_import_id)
    temp_dir.mkdir(parents=True, exist_ok=True)
    zip_path = temp_dir / upload.filename
    await _write_upload(upload, zip_path)

    errors: list[str] = []
    try:
        with ZipFile(zip_path) as zip_file:
            errors.extend(validate_zip_members(zip_file))
            zip_names = {normalize_zip_name(name) for name in zip_file.namelist() if not name.endswith("/")}
            if "manifest.json" not in zip_names:
                errors.append("zip 中缺少 manifest.json")
            if not errors:
                extract_dir = temp_dir / "extract"
                safe_extract(zip_file, extract_dir)
            else:
                extract_dir = temp_dir / "extract"
    except BadZipFile as exc:
        raise HTTPException(status_code=400, detail=f"zip 文件不可读取或已损坏。{ENCRYPTED_FILE_HINT}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _build_preview_from_extract(db, temporary_import_id, temp_dir, extract_dir, upload.filename, zip_path, errors=errors)


async def create_folder_preview(db: Session, uploads: list[UploadFile]) -> ImportPreview:
    if not uploads:
        raise HTTPException(status_code=400, detail="请选择包含 manifest.json 的文件夹")

    temporary_import_id = _temp_id()
    temp_dir = _preview_path(temporary_import_id)
    extract_dir = temp_dir / "extract"
    extract_dir.mkdir(parents=True, exist_ok=True)

    normalized_uploads = _normalize_folder_upload_paths(uploads)
    source_parts = PurePosixPath(normalize_zip_name(uploads[0].filename or "folder")).parts
    source_name = source_parts[0] if source_parts else "folder"
    for upload, relative_path in normalized_uploads:
        target = (extract_dir / relative_path).resolve()
        if extract_dir.resolve() not in target.parents and target != extract_dir.resolve():
            raise _unsafe_folder_path_error(relative_path)
        await _write_upload(upload, target)

    return _build_preview_from_extract(db, temporary_import_id, temp_dir, extract_dir, f"{source_name} (folder)", None)


def _copy_member(source_root: Path, relative_path: str, project_root: Path) -> str:
    normalized = normalize_zip_name(relative_path)
    source = (source_root / normalized).resolve()
    target = (project_root / normalized).resolve()
    if not source.exists():
        raise HTTPException(status_code=400, detail=f"源文件不存在: {relative_path}")
    if project_root.resolve() not in target.parents and target != project_root.resolve():
        raise HTTPException(status_code=400, detail=f"目标路径越界: {relative_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return _relative_to_project(target)


def confirm_import(db: Session, temporary_import_id: str) -> models.Project:
    temp_dir = _preview_path(temporary_import_id)
    extract_dir = temp_dir / "extract"
    manifest_path = extract_dir / "manifest.json"
    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="临时导入不存在或已失效，请重新预览")

    manifest_data = _load_manifest(manifest_path)
    manifest = ManifestIn.model_validate(manifest_data)
    zip_names = {path.relative_to(extract_dir).as_posix() for path in extract_dir.rglob("*") if path.is_file()}
    missing_files, duplicate_point_ids, _, warnings, errors = _validate_manifest_business(manifest, zip_names, db)
    if errors or missing_files or duplicate_point_ids:
        raise HTTPException(status_code=400, detail="; ".join(errors + warnings))

    project_root = STORAGE_DIR / "projects" / manifest.project.project_id
    project_root.mkdir(parents=True, exist_ok=True)

    zip_files = list(temp_dir.glob("*.zip"))
    if zip_files:
        imports_target = STORAGE_DIR / "imports" / f"{temporary_import_id}_{zip_files[0].name}"
        shutil.copy2(zip_files[0], imports_target)
    else:
        imports_target = temp_dir

    project = models.Project(
        project_id=manifest.project.project_id,
        project_name=manifest.project.project_name,
        test_object=manifest.project.test_object,
        test_type=manifest.project.test_type,
        department=manifest.project.department,
        vehicle_or_product=manifest.project.vehicle_or_product,
        test_stage=manifest.project.test_stage,
        description=manifest.project.description,
        source_export_id=manifest.export_info.export_id,
        source_export_time=manifest.export_info.export_time,
        raw_manifest_json=json.dumps(manifest_data, ensure_ascii=False),
    )
    db.add(project)
    db.flush()

    for point_in in manifest.points:
        point = models.TestPoint(
            project_db_id=project.id,
            point_id=point_in.point_id,
            point_name=point_in.point_name,
            point_type=point_in.point_type,
            component=point_in.component,
            side=point_in.side,
            position_description=point_in.position_description,
            direction=point_in.direction,
            bridge_type=point_in.bridge_type,
            resistance_ohm=point_in.resistance_ohm,
            install_status=point_in.install_status,
            check_status=point_in.check_status,
            remark=point_in.remark,
            raw_json=point_in.model_dump_json(),
        )
        db.add(point)
        db.flush()

        if point_in.channel:
            db.add(models.SensorChannel(point_db_id=point.id, **point_in.channel.model_dump()))
        if point_in.cae_mapping:
            db.add(models.CaeMapping(point_db_id=point.id, **point_in.cae_mapping.model_dump()))

        for photo in point_in.photos:
            stored_path = _copy_member(extract_dir, photo.path, project_root)
            stored_file = PROJECT_ROOT / stored_path
            sha256 = photo.sha256 or file_sha256(stored_file)
            db.add(
                models.MediaFile(
                    project_db_id=project.id,
                    point_db_id=point.id,
                    photo_id=photo.photo_id,
                    type=photo.type,
                    path=photo.path,
                    stored_path=stored_path,
                    filename=photo.filename,
                    taken_time=photo.taken_time,
                    sha256=sha256,
                    remark=photo.remark,
                )
            )

    for folder in ["raw", "attachments"]:
        source = extract_dir / folder
        target = project_root / folder
        if source.exists() and source.is_dir():
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(source, target)

    job = db.scalar(select(models.ImportJob).where(models.ImportJob.temp_dir == _relative_to_project(temp_dir)))
    if job:
        job.status = "imported"
        job.message = f"已导入项目 {project.project_id}"
        job.zip_stored_path = _relative_to_project(imports_target)

    db.commit()
    db.refresh(project)
    return project
