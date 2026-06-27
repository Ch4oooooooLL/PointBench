import csv
import json
import re
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app import models
from app.database import STORAGE_DIR
from app.services.analysis_service import compute_measurement_fields, refresh_point_abnormal_flags


RAW_SUFFIXES = {".dxd", ".dxz", ".d7d", ".d7z"}
TEXT_SUFFIXES = {".csv", ".txt"}


@dataclass
class ChannelExtract:
    name: str
    unit: str | None
    values: list[float]
    times: list[float]
    metadata: dict[str, Any]


def _safe_filename(filename: str) -> str:
    return Path(filename).name.replace("\\", "_").replace("/", "_")


def _unique_upload_path(target_dir: Path, filename: str) -> Path:
    target = target_dir / filename
    if not target.exists():
        return target
    path = Path(filename)
    return target_dir / f"{path.stem}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}_{uuid.uuid4().hex[:8]}{path.suffix}"


async def save_dewesoft_upload(project: models.Project, upload: UploadFile) -> Path:
    if not upload.filename:
        raise HTTPException(status_code=400, detail="请上传 Dewesoft 数据文件")
    suffix = Path(upload.filename).suffix.lower()
    if suffix not in RAW_SUFFIXES | TEXT_SUFFIXES:
        raise HTTPException(status_code=400, detail="支持 Dewesoft .dxd/.dxz/.d7d/.d7z 原始文件，以及 .csv/.txt 导出文件")
    target_dir = STORAGE_DIR / "dewesoft" / project.project_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = _unique_upload_path(target_dir, _safe_filename(upload.filename))
    with target.open("wb") as output:
        while chunk := await upload.read(1024 * 1024):
            output.write(chunk)
    return target


def read_dewesoft_channels(path: Path) -> tuple[list[ChannelExtract], dict[str, Any]]:
    suffix = path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return read_dewesoft_csv(path)
    return read_dewesoft_raw(path)


def _series_to_values_and_times(series: Any) -> tuple[list[float], list[float]]:
    if hasattr(series, "to_numpy"):
        raw_values = series.to_numpy()
        raw_index = getattr(series, "index", None)
        pairs: list[tuple[float, float]] = []
        if raw_index is not None:
            raw_times = raw_index.to_numpy()
        else:
            raw_times = list(range(len(raw_values)))
        for time_value, value in zip(raw_times, raw_values):
            numeric_value = _to_float(value)
            numeric_time = _to_float(time_value)
            if numeric_value is not None and numeric_time is not None:
                pairs.append((numeric_time, numeric_value))
        return [value for _, value in pairs], [time for time, _ in pairs]

    if isinstance(series, (list, tuple)):
        values = [float(value) for value in series]
        times = [float(index) for index in range(len(values))]
        return values, times

    raise RuntimeError("无法识别 Dewesoft 通道数据结构")


def _channel_unit(channel: Any) -> str | None:
    for attr in ["unit", "units", "unit_name"]:
        value = getattr(channel, attr, None)
        if value:
            return str(value)
    info = getattr(channel, "info", None)
    if isinstance(info, dict):
        for key in ["unit", "units", "Unit", "Units"]:
            if info.get(key):
                return str(info[key])
    return None


def read_dewesoft_raw(path: Path) -> tuple[list[ChannelExtract], dict[str, Any]]:
    try:
        import dwdatareader as dw
    except ModuleNotFoundError as exc:  # pragma: no cover - depends on optional local runtime
        raise RuntimeError("当前 Python 环境缺少 dwdatareader，请安装后重试") from exc
    except Exception as exc:  # pragma: no cover - depends on optional local runtime
        raise RuntimeError(f"dwdatareader 加载失败，请检查 numpy/pandas 和 Dewesoft 官方运行库: {exc}") from exc

    channels: list[ChannelExtract] = []
    metadata: dict[str, Any] = {"source": "dwdatareader"}
    try:
        with dw.DWFile(str(path)) as file:
            info = getattr(file, "info", None)
            metadata["info"] = str(info) if info is not None else None
            items = file.items() if hasattr(file, "items") else []
            values_iter = list(items) if items else [(getattr(channel, "name", f"CH{index}"), channel) for index, channel in enumerate(file.values())]
            for name, channel in values_iter:
                channel_name = str(getattr(channel, "name", name)).strip()
                try:
                    series = channel.series()
                    values, times = _series_to_values_and_times(series)
                except Exception as exc:
                    channels.append(ChannelExtract(channel_name, _channel_unit(channel), [], [], {"error": str(exc), "source": "dwdatareader"}))
                    continue
                channels.append(
                    ChannelExtract(
                        channel_name,
                        _channel_unit(channel),
                        values,
                        times,
                        {"info": str(getattr(channel, "info", "")), "source": "dwdatareader"},
                    )
                )
    except Exception as exc:
        raise RuntimeError(
            "Dewesoft 文件读取失败。请确认已安装 Dewesoft 官方 DWDataReaderLib 动态库，且文件格式为受支持的 .dxd/.dxz/.d7d/.d7z"
        ) from exc
    return channels, metadata


def read_dewesoft_csv(path: Path) -> tuple[list[ChannelExtract], dict[str, Any]]:
    text = _read_text_file(path)
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        raise RuntimeError("CSV/TXT 文件为空")

    delimiter = _detect_delimiter(lines[:8])
    rows = [next(csv.reader([line], delimiter=delimiter)) for line in lines]
    header_index = _find_header_index(rows)
    if header_index is None:
        raise RuntimeError("无法识别 CSV 表头，请确认导出文件包含时间列和通道列")

    headers = [cell.strip() for cell in rows[header_index]]
    unit_row_index = header_index + 1 if header_index + 1 < len(rows) and _looks_like_unit_row(rows[header_index + 1]) else None
    units = [cell.strip() for cell in rows[unit_row_index]] if unit_row_index is not None else [""] * len(headers)
    data_start = header_index + 2 if unit_row_index is not None else header_index + 1

    time_index = _find_time_column(headers, rows[data_start : data_start + 20])
    channel_columns = [index for index, header in enumerate(headers) if index != time_index and header.strip()]
    if not channel_columns:
        raise RuntimeError("CSV 中未识别到通道列")

    parsed_rows = rows[data_start:]
    row_times = _parse_time_column(parsed_rows, time_index)
    channels: list[ChannelExtract] = []
    for column in channel_columns:
        name, unit_from_header = _split_name_unit(headers[column])
        unit = unit_from_header or (units[column] if column < len(units) else None) or None
        values: list[float] = []
        times: list[float] = []
        for row_index, row in enumerate(parsed_rows):
            if column >= len(row):
                continue
            value = _to_float(row[column])
            if value is None:
                continue
            values.append(value)
            times.append(row_times[row_index] if row_index < len(row_times) else float(row_index))
        if values:
            channels.append(
                ChannelExtract(
                    name=name,
                    unit=unit,
                    values=values,
                    times=times,
                    metadata={
                        "source": "csv",
                        "column_index": column,
                        "header": headers[column],
                        "unit_row": units[column] if column < len(units) else None,
                    },
                )
            )

    if not channels:
        raise RuntimeError("CSV 中没有可读取的数值通道")
    return channels, {
        "source": "csv",
        "delimiter": "\\t" if delimiter == "\t" else delimiter,
        "header_index": header_index,
        "unit_row_index": unit_row_index,
        "time_column": headers[time_index] if time_index is not None and time_index < len(headers) else None,
    }


def _read_text_file(path: Path) -> str:
    raw = path.read_bytes()
    for encoding in ["utf-8-sig", "utf-16", "gbk", "latin1"]:
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _detect_delimiter(lines: list[str]) -> str:
    candidates = [",", ";", "\t"]
    scores = {delimiter: sum(max(0, line.count(delimiter)) for line in lines) for delimiter in candidates}
    return max(scores, key=scores.get)


def _find_header_index(rows: list[list[str]]) -> int | None:
    for index, row in enumerate(rows[:20]):
        cells = [cell.strip() for cell in row]
        if len(cells) < 2:
            continue
        if any(_is_time_header(cell) for cell in cells):
            return index
        next_row = rows[index + 1] if index + 1 < len(rows) else []
        numeric_count = sum(1 for cell in next_row if _to_float(cell) is not None)
        if numeric_count >= 2 and any(cell for cell in cells):
            return index
    return None


def _looks_like_unit_row(row: list[str]) -> bool:
    cells = [cell.strip() for cell in row]
    if not cells:
        return False
    numeric_count = sum(1 for cell in cells if _to_float(cell) is not None)
    unit_tokens = {"s", "sec", "second", "seconds", "ue", "µε", "με", "microstrain", "mpa", "v", "mv/v"}
    unit_count = sum(1 for cell in cells if cell.lower() in unit_tokens or "µ" in cell or "ε" in cell)
    return unit_count >= 1 and numeric_count <= max(1, len(cells) // 3)


def _find_time_column(headers: list[str], sample_rows: list[list[str]]) -> int | None:
    for index, header in enumerate(headers):
        if _is_time_header(header):
            return index
    if not sample_rows:
        return None
    best_index: int | None = None
    best_score = -1
    max_cols = max(len(row) for row in sample_rows)
    for column in range(max_cols):
        values = []
        for row in sample_rows:
            if column < len(row):
                value = _to_float(row[column])
                if value is not None:
                    values.append(value)
        if len(values) < 3:
            continue
        monotonic_pairs = sum(1 for left, right in zip(values, values[1:]) if right >= left)
        score = monotonic_pairs + len(values)
        if score > best_score:
            best_index = column
            best_score = score
    return best_index


def _parse_time_column(rows: list[list[str]], time_index: int | None) -> list[float]:
    if time_index is None:
        return [float(index) for index in range(len(rows))]

    numeric_times: list[float | None] = []
    datetime_times: list[datetime | None] = []
    for row in rows:
        cell = row[time_index] if time_index < len(row) else ""
        numeric = _to_float(cell)
        numeric_times.append(numeric)
        datetime_times.append(_to_datetime(cell) if numeric is None else None)

    if any(value is not None for value in numeric_times):
        return [float(value) if value is not None else float(index) for index, value in enumerate(numeric_times)]

    valid_datetimes = [value for value in datetime_times if value is not None]
    if valid_datetimes:
        start = valid_datetimes[0]
        return [(value - start).total_seconds() if value is not None else float(index) for index, value in enumerate(datetime_times)]

    return [float(index) for index in range(len(rows))]


def _is_time_header(value: str) -> bool:
    cleaned = value.strip().lower()
    return cleaned in {"t", "time", "timestamp", "relative time", "absolute time"} or cleaned.startswith("time ") or cleaned.startswith("time[")


def _split_name_unit(header: str) -> tuple[str, str | None]:
    value = header.strip()
    match = re.match(r"^(?P<name>.+?)\s*[\[(](?P<unit>[^)\]]+)[)\]]\s*$", value)
    if match:
        return match.group("name").strip(), match.group("unit").strip()
    return value, None


def _point_number_key(value: str | None) -> str | None:
    if not value:
        return None
    match = re.match(r"^\s*(\d{2})", value)
    return match.group(1) if match else None


def _split_dewesoft_point_name(value: str | None) -> tuple[str, str] | None:
    if not value:
        return None
    match = re.match(r"^\s*(\d{2})-(?P<name>.+?)\s*$", value)
    if not match:
        return None
    point_name = match.group("name").strip()
    if not point_name:
        return None
    return match.group(1), point_name


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    text = text.replace(" ", "")
    if "," in text and "." not in text:
        text = text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def _to_datetime(value: Any) -> datetime | None:
    text = str(value).strip()
    if not text:
        return None
    text = text.replace("Z", "+00:00")
    for candidate in [text, text.replace("/", "-")]:
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue
    for fmt in ["%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%H:%M:%S.%f", "%H:%M:%S"]:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _stable_window(times: list[float]) -> tuple[float, float, float]:
    if not times:
        return 0.0, 0.0, 0.0
    start = min(times)
    end = max(times)
    duration = max(0.0, end - start)
    stable_length = duration / 10
    center = start + duration / 2
    stable_start = center - stable_length / 2
    stable_end = center + stable_length / 2
    return duration, stable_start, stable_end


def _window_values(channel: ChannelExtract, stable_start: float, stable_end: float) -> list[float]:
    if not channel.values:
        return []
    if not channel.times or len(channel.times) != len(channel.values):
        sample_count = len(channel.values)
        start_index = max(0, int(sample_count * 0.45))
        end_index = min(sample_count, max(start_index + 1, int(sample_count * 0.55)))
        return channel.values[start_index:end_index]
    return [value for value, time in zip(channel.values, channel.times) if stable_start <= time <= stable_end]


def import_dewesoft_file(db: Session, project_id: int, cycle_count: int, run_name: str | None, upload_path: Path) -> models.DewesoftImport:
    project = db.get(models.Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    run_name_value = run_name or f"Dewesoft-{cycle_count}"
    import_job = models.DewesoftImport(
        project_db_id=project_id,
        cycle_count=cycle_count,
        run_name=run_name_value,
        filename=upload_path.name,
        stored_path=str(upload_path.relative_to(Path(__file__).resolve().parents[2])),
        status="processing",
    )
    db.add(import_job)
    db.flush()

    try:
        channels, metadata = read_dewesoft_channels(upload_path)
        all_times = [time for channel in channels for time in channel.times]
        duration, stable_start, stable_end = _stable_window(all_times)
        import_job.duration_seconds = duration
        import_job.stable_start_seconds = stable_start
        import_job.stable_end_seconds = stable_end
        import_job.raw_metadata_json = json.dumps(metadata, ensure_ascii=False)

        test_run = db.scalar(
            select(models.TestRun).where(
                models.TestRun.project_db_id == project_id,
                models.TestRun.run_name == run_name_value,
                models.TestRun.cycle_count == cycle_count,
            )
        )
        if not test_run:
            test_run = models.TestRun(
                project_db_id=project_id,
                run_name=run_name_value,
                cycle_count=cycle_count,
                remark=f"Dewesoft import: {upload_path.name}",
            )
            db.add(test_run)
            db.flush()
        import_job.test_run_id = test_run.id

        project_points = db.execute(select(models.TestPoint).where(models.TestPoint.project_db_id == project_id)).scalars().all()
        point_map: dict[str, models.TestPoint] = {}
        for point in project_points:
            match_key = _point_number_key(point.point_id)
            if match_key and match_key not in point_map:
                point_map[match_key] = point

        matched = 0
        unmatched = 0
        created_points: list[models.TestPoint] = []
        for channel in channels:
            window_values = _window_values(channel, stable_start, stable_end)
            min_value = min(window_values) if window_values else None
            max_value = max(window_values) if window_values else None
            mean_value = sum(window_values) / len(window_values) if window_values else None
            channel_match = _split_dewesoft_point_name(channel.name)
            channel_key = channel_match[0] if channel_match else _point_number_key(channel.name)
            point = point_map.get(channel_key)
            if point is None and channel_match:
                point = models.TestPoint(
                    project_db_id=project_id,
                    point_id=channel_match[0],
                    point_name=channel_match[1],
                    point_type="strain",
                    install_status="planned",
                    remark="由 Dewesoft 通道自动创建，请补充点位信息。",
                    raw_json=json.dumps({"source": "dewesoft", "channel_name": channel.name}, ensure_ascii=False),
                )
                db.add(point)
                db.flush()
                db.add(
                    models.SensorChannel(
                        point_db_id=point.id,
                        device="Dewesoft",
                        channel_name=channel.name,
                        unit=channel.unit,
                    )
                )
                point_map[channel_match[0]] = point
                project_points.append(point)
                created_points.append(point)
            measurement_id: int | None = None
            if point and min_value is not None and max_value is not None:
                record = db.scalar(
                    select(models.MeasurementRecord).where(
                        models.MeasurementRecord.run_id == test_run.id,
                        models.MeasurementRecord.point_db_id == point.id,
                    )
                )
                if not record:
                    record = models.MeasurementRecord(run_id=test_run.id, point_db_id=point.id)
                record.max_strain_ue = max_value
                record.min_strain_ue = min_value
                record.remark = f"Dewesoft channel {channel.name}"
                compute_measurement_fields(record)
                db.add(record)
                db.flush()
                measurement_id = record.id
                matched += 1
            else:
                unmatched += 1

            db.add(
                models.DewesoftChannel(
                    import_id=import_job.id,
                    channel_name=channel.name,
                    unit=channel.unit,
                    sample_count=len(channel.values),
                    matched_point_db_id=point.id if point else None,
                    measurement_id=measurement_id,
                    stable_min_strain_ue=min_value,
                    stable_max_strain_ue=max_value,
                    stable_mean_strain_ue=mean_value,
                    raw_json=json.dumps(channel.metadata, ensure_ascii=False),
                )
            )

        import_job.matched_channel_count = matched
        import_job.unmatched_channel_count = unmatched
        import_job.status = "imported"
        message = f"已导入 {matched} 个匹配点位通道，保留 {unmatched} 个未匹配通道"
        if created_points:
            created_summary = "、".join(f"{point.point_id}-{point.point_name}" for point in created_points)
            message += f"；已自动新增 {len(created_points)} 个点位：{created_summary}。请补充对应点位信息"
        import_job.message = message
        db.flush()
        for point in project_points:
            refresh_point_abnormal_flags(db, point.id)
        db.commit()
    except Exception as exc:
        import_job.status = "failed"
        import_job.message = str(exc)
        db.commit()
    db.refresh(import_job)
    return db.execute(
        select(models.DewesoftImport)
        .options(selectinload(models.DewesoftImport.channels))
        .where(models.DewesoftImport.id == import_job.id)
    ).scalar_one()


def delete_dewesoft_project_files(project_id: str) -> None:
    target = STORAGE_DIR / "dewesoft" / project_id
    if target.exists():
        shutil.rmtree(target)
