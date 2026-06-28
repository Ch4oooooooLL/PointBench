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
from app.services.analysis_service import compute_measurement_fields
from app.utils.hash_utils import file_sha256
from app.utils.zip_utils import is_safe_zip_path, normalize_zip_name, safe_extract, validate_zip_members


ENCRYPTED_FILE_HINT = "如果文件在公司内网文档加密目录中，请先手动打开或解压为明文文件夹后再导入，或联系 IT 将本系统加入解密白名单。"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKUP_FILENAME = "pointprocess_backup.json"


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


def _load_json_file(path: Path, label: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{label} must use UTF-8") from exc
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"{label} is not valid JSON: {exc}") from exc


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
    if "manifest.json" not in paths and BACKUP_FILENAME not in paths:
        first_parts = [PurePosixPath(path).parts for path in paths]
        common_root = first_parts[0][0] if first_parts and len(first_parts[0]) > 1 else None
        if common_root and all(len(parts) > 1 and parts[0] == common_root for parts in first_parts):
            stripped = [PurePosixPath(*parts[1:]).as_posix() for parts in first_parts]
            if "manifest.json" in stripped or BACKUP_FILENAME in stripped:
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


def _build_backup_preview(
    db: Session,
    temporary_import_id: str,
    temp_dir: Path,
    extract_dir: Path,
    source_name: str,
    zip_path: Path | None,
    errors: list[str],
    warnings: list[str],
) -> ImportPreview:
    backup = _load_json_file(extract_dir / BACKUP_FILENAME, BACKUP_FILENAME)
    backup_errors = [error for error in errors if "manifest" not in error.lower()]
    backup_warnings = list(warnings)
    if backup.get("format") != "pointprocess_project_backup":
        backup_errors.append("PointProcess backup format is invalid")

    project = backup.get("project") or {}
    project_id = project.get("project_id")
    if not project_id:
        backup_errors.append("PointProcess backup is missing project.project_id")
    elif db.scalar(select(models.Project.id).where(models.Project.project_id == project_id)):
        backup_errors.append(f"Project {project_id} already exists. Delete it before importing this backup.")

    point_ids = [point.get("point_id") for point in backup.get("points", []) if point.get("point_id")]
    duplicate_point_ids = _duplicates(point_ids)
    if duplicate_point_ids:
        backup_errors.append("PointProcess backup contains duplicate point ids")

    zip_names = {path.relative_to(extract_dir).as_posix() for path in extract_dir.rglob("*") if path.is_file()}
    missing_files: list[str] = []
    for point in backup.get("points", []):
        for photo in point.get("photos", []):
            path = normalize_zip_name(photo.get("path") or "")
            if path and not is_safe_zip_path(path):
                backup_errors.append(f"Unsafe backup photo path: {path}")
                continue
            if path and path not in zip_names:
                missing_files.append(path)
    for crack in backup.get("crack_records", []):
        path = normalize_zip_name(crack.get("path") or "")
        if path and not is_safe_zip_path(path):
            backup_errors.append(f"Unsafe crack photo path: {path}")
            continue
        if path and path not in zip_names:
            missing_files.append(path)
    for import_job in backup.get("dewesoft_imports", []):
        path = normalize_zip_name(import_job.get("path") or "")
        if path and not is_safe_zip_path(path):
            backup_errors.append(f"Unsafe Dewesoft file path: {path}")
            continue
        if path and path not in zip_names:
            missing_files.append(path)
    if missing_files:
        backup_errors.append("PointProcess backup references files that are missing from the package")

    stored_path = zip_path if zip_path else extract_dir
    job = models.ImportJob(
        export_id=backup.get("export_id"),
        project_id=project_id,
        zip_filename=source_name,
        zip_stored_path=_relative_to_project(stored_path),
        temp_dir=_relative_to_project(temp_dir),
        status="previewed" if not backup_errors else "preview_failed",
        message="; ".join(backup_errors or backup_warnings),
    )
    db.add(job)
    db.commit()

    return ImportPreview(
        temporary_import_id=temporary_import_id,
        export_id=backup.get("export_id"),
        project_id=project_id,
        project_name=project.get("project_name"),
        point_count=len(backup.get("points", [])),
        photo_count=sum(len(point.get("photos", [])) for point in backup.get("points", [])) + len(backup.get("crack_records", [])),
        missing_files=missing_files,
        duplicate_point_ids=duplicate_point_ids,
        duplicate_channel_names=[],
        warnings=backup_warnings + ["Detected a PointProcess full backup. Import will restore points, photos, runs, measurements, cracks, and Dewesoft records."],
        errors=backup_errors,
        can_import=not backup_errors,
    )


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

    if BACKUP_FILENAME in zip_names:
        return _build_backup_preview(db, temporary_import_id, temp_dir, extract_dir, source_name, zip_path, errors, warnings)

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
        message="; ".join(errors + warnings),
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
            if "manifest.json" not in zip_names and BACKUP_FILENAME not in zip_names:
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
    if source_root.resolve() not in source.parents and source != source_root.resolve():
        raise HTTPException(status_code=400, detail=f"Source path escapes import root: {relative_path}")
    if not source.exists():
        raise HTTPException(status_code=400, detail=f"源文件不存在: {relative_path}")
    if project_root.resolve() not in target.parents and target != project_root.resolve():
        raise HTTPException(status_code=400, detail=f"目标路径越界: {relative_path}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return _relative_to_project(target)


def _confirm_backup_import(db: Session, temporary_import_id: str, temp_dir: Path, extract_dir: Path) -> models.Project:
    backup = _load_json_file(extract_dir / BACKUP_FILENAME, BACKUP_FILENAME)
    if backup.get("format") != "pointprocess_project_backup":
        raise HTTPException(status_code=400, detail="PointProcess backup format is invalid")

    project_data = backup.get("project") or {}
    project_id = (project_data.get("project_id") or "").strip()
    project_name = (project_data.get("project_name") or "").strip()
    if not project_id or not project_name:
        raise HTTPException(status_code=400, detail="PointProcess backup is missing project id or name")
    if db.scalar(select(models.Project.id).where(models.Project.project_id == project_id)):
        raise HTTPException(status_code=400, detail=f"Project {project_id} already exists. Delete it before importing this backup.")

    project_root = STORAGE_DIR / "projects" / project_id
    project_root.mkdir(parents=True, exist_ok=True)
    project = models.Project(
        project_id=project_id,
        project_name=project_name,
        test_object=project_data.get("test_object"),
        test_type=project_data.get("test_type"),
        department=project_data.get("department"),
        vehicle_or_product=project_data.get("vehicle_or_product"),
        test_stage=project_data.get("test_stage"),
        description=project_data.get("description"),
        source_export_id=backup.get("export_id") or project_data.get("source_export_id"),
        source_export_time=backup.get("exported_at") or project_data.get("source_export_time"),
        raw_manifest_json=project_data.get("raw_manifest_json") or json.dumps(backup, ensure_ascii=False),
    )
    db.add(project)
    db.flush()

    point_by_code: dict[str, models.TestPoint] = {}
    for point_data in backup.get("points", []):
        point_code = point_data.get("point_id")
        if not point_code:
            continue
        point = models.TestPoint(
            project_db_id=project.id,
            point_id=point_code,
            point_name=point_data.get("point_name") or point_code,
            point_type=point_data.get("point_type") or "strain",
            component=point_data.get("component"),
            side=point_data.get("side"),
            position_description=point_data.get("position_description"),
            direction=point_data.get("direction"),
            bridge_type=point_data.get("bridge_type"),
            resistance_ohm=point_data.get("resistance_ohm"),
            install_status=point_data.get("install_status") or "planned",
            check_status=point_data.get("check_status"),
            remark=point_data.get("remark"),
            raw_json=point_data.get("raw_json") or json.dumps(point_data, ensure_ascii=False),
        )
        db.add(point)
        db.flush()
        point_by_code[point.point_id] = point

        channel = point_data.get("channel")
        if channel:
            db.add(models.SensorChannel(point_db_id=point.id, **channel))
        cae_mapping = point_data.get("cae_mapping")
        if cae_mapping:
            db.add(models.CaeMapping(point_db_id=point.id, **cae_mapping))
        for photo in point_data.get("photos", []):
            path = photo.get("path")
            if not path:
                continue
            stored_path = _copy_member(extract_dir, path, project_root)
            stored_file = PROJECT_ROOT / stored_path
            db.add(
                models.MediaFile(
                    project_db_id=project.id,
                    point_db_id=point.id,
                    photo_id=photo.get("photo_id"),
                    type=photo.get("type") or "photo",
                    path=path,
                    stored_path=stored_path,
                    filename=photo.get("filename") or Path(path).name,
                    taken_time=photo.get("taken_time"),
                    sha256=photo.get("sha256") or file_sha256(stored_file),
                    remark=photo.get("remark"),
                )
            )

    run_by_old_id: dict[int, models.TestRun] = {}
    run_by_cycle: dict[int, models.TestRun] = {}
    measurement_by_old_id: dict[int, models.MeasurementRecord] = {}
    for run_data in backup.get("test_runs", []):
        run = models.TestRun(
            project_db_id=project.id,
            run_name=run_data.get("run_name") or f"cycle-{run_data.get('cycle_count')}",
            cycle_count=int(run_data.get("cycle_count") or 0),
            test_time=run_data.get("test_time"),
            remark=run_data.get("remark"),
        )
        db.add(run)
        db.flush()
        if run_data.get("id") is not None:
            run_by_old_id[int(run_data["id"])] = run
        run_by_cycle[run.cycle_count] = run
        for measurement_data in run_data.get("measurements", []):
            point = point_by_code.get(measurement_data.get("point_id"))
            if not point:
                continue
            record = models.MeasurementRecord(
                run_id=run.id,
                point_db_id=point.id,
                max_strain_ue=measurement_data.get("max_strain_ue"),
                min_strain_ue=measurement_data.get("min_strain_ue"),
                is_abnormal=bool(measurement_data.get("is_abnormal")),
                abnormal_reason=measurement_data.get("abnormal_reason"),
                remark=measurement_data.get("remark"),
            )
            compute_measurement_fields(record)
            db.add(record)
            db.flush()
            if measurement_data.get("id") is not None:
                measurement_by_old_id[int(measurement_data["id"])] = record

    for crack_data in backup.get("crack_records", []):
        point = point_by_code.get(crack_data.get("point_id"))
        path = crack_data.get("path")
        if not point or not path:
            continue
        stored_path = _copy_member(extract_dir, path, project_root)
        stored_file = PROJECT_ROOT / stored_path
        run = None
        if crack_data.get("test_run_id") is not None:
            run = run_by_old_id.get(int(crack_data["test_run_id"]))
        if run is None and crack_data.get("run_cycle_count") is not None:
            run = run_by_cycle.get(int(crack_data["run_cycle_count"]))
        db.add(
            models.CrackRecord(
                project_db_id=project.id,
                point_db_id=point.id,
                test_run_id=run.id if run else None,
                cycle_count=int(crack_data.get("cycle_count") or (run.cycle_count if run else 0)),
                stored_path=stored_path,
                filename=crack_data.get("filename") or Path(path).name,
                content_type=crack_data.get("content_type"),
                sha256=crack_data.get("sha256") or file_sha256(stored_file),
                remark=crack_data.get("remark"),
            )
        )

    for import_data in backup.get("dewesoft_imports", []):
        path = import_data.get("path")
        stored_path = _copy_member(extract_dir, path, project_root) if path else ""
        run = None
        if import_data.get("test_run_id") is not None:
            run = run_by_old_id.get(int(import_data["test_run_id"]))
        if run is None and import_data.get("cycle_count") is not None:
            run = run_by_cycle.get(int(import_data["cycle_count"]))
        dewesoft_import = models.DewesoftImport(
            project_db_id=project.id,
            test_run_id=run.id if run else None,
            cycle_count=int(import_data.get("cycle_count") or (run.cycle_count if run else 0)),
            run_name=import_data.get("run_name") or (run.run_name if run else "Dewesoft"),
            filename=import_data.get("filename") or (Path(path).name if path else "dewesoft"),
            stored_path=stored_path,
            status=import_data.get("status") or "imported",
            message=import_data.get("message"),
            duration_seconds=import_data.get("duration_seconds"),
            stable_start_seconds=import_data.get("stable_start_seconds"),
            stable_end_seconds=import_data.get("stable_end_seconds"),
            matched_channel_count=int(import_data.get("matched_channel_count") or 0),
            unmatched_channel_count=int(import_data.get("unmatched_channel_count") or 0),
            raw_metadata_json=import_data.get("raw_metadata_json"),
        )
        db.add(dewesoft_import)
        db.flush()
        for channel_data in import_data.get("channels", []):
            matched_point = point_by_code.get(channel_data.get("matched_point_id"))
            measurement = None
            if channel_data.get("measurement_id") is not None:
                measurement = measurement_by_old_id.get(int(channel_data["measurement_id"]))
            db.add(
                models.DewesoftChannel(
                    import_id=dewesoft_import.id,
                    channel_name=channel_data.get("channel_name") or "",
                    unit=channel_data.get("unit"),
                    sample_count=channel_data.get("sample_count"),
                    matched_point_db_id=matched_point.id if matched_point else None,
                    measurement_id=measurement.id if measurement else None,
                    stable_min_strain_ue=channel_data.get("stable_min_strain_ue"),
                    stable_max_strain_ue=channel_data.get("stable_max_strain_ue"),
                    stable_mean_strain_ue=channel_data.get("stable_mean_strain_ue"),
                    raw_json=channel_data.get("raw_json"),
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
        job.message = f"Imported PointProcess full backup project {project.project_id}"

    db.commit()
    db.refresh(project)
    return project


def confirm_import(db: Session, temporary_import_id: str) -> models.Project:
    temp_dir = _preview_path(temporary_import_id)
    extract_dir = temp_dir / "extract"
    if (extract_dir / BACKUP_FILENAME).exists():
        return _confirm_backup_import(db, temporary_import_id, temp_dir, extract_dir)
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
