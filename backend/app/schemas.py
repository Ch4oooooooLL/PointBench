from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChannelIn(BaseModel):
    device: str | None = None
    channel_name: str | None = None
    unit: str | None = "ue"
    sample_rate_hz: float | None = None
    remark: str | None = None


class CaeMappingIn(BaseModel):
    cae_point_id: str | None = None
    cae_component: str | None = None
    cae_result_type: str | None = None
    danger_level: str | None = None
    remark: str | None = None


class PhotoIn(BaseModel):
    photo_id: str
    type: str
    path: str
    filename: str
    taken_time: str | None = None
    sha256: str | None = None
    remark: str | None = None


class FileIn(BaseModel):
    file_id: str
    type: str
    path: str
    filename: str
    sha256: str | None = None
    remark: str | None = None


class PointIn(BaseModel):
    point_id: str = Field(min_length=1)
    point_name: str = Field(min_length=1)
    point_type: str
    component: str | None = None
    side: str | None = None
    position_description: str | None = None
    direction: str | None = None
    bridge_type: str | None = None
    resistance_ohm: float | None = None
    install_status: str
    check_status: str | None = None
    channel: ChannelIn | None = None
    cae_mapping: CaeMappingIn | None = None
    photos: list[PhotoIn]
    tags: list[str] | None = None
    remark: str | None = None
    created_time: str | None = None
    updated_time: str | None = None
    custom_fields: dict[str, Any] | None = None


class ExportInfoIn(BaseModel):
    export_id: str = Field(min_length=1)
    export_time: str
    app_name: str = Field(min_length=1)
    app_version: str = Field(min_length=1)
    device_name: str | None = None
    operator: str | None = None
    remark: str | None = None


class ProjectIn(BaseModel):
    project_id: str = Field(min_length=1)
    project_name: str = Field(min_length=1)
    test_object: str | None = None
    test_type: str | None = None
    department: str | None = None
    vehicle_or_product: str | None = None
    test_stage: str | None = None
    description: str | None = None
    created_time: str | None = None
    updated_time: str | None = None


class ManifestIn(BaseModel):
    schema_version: str
    export_info: ExportInfoIn
    project: ProjectIn
    points: list[PointIn] = Field(min_length=1)
    files: list[FileIn] | None = None
    custom_fields: dict[str, Any] | None = None


class ImportPreview(BaseModel):
    temporary_import_id: str
    export_id: str | None = None
    project_id: str | None = None
    project_name: str | None = None
    point_count: int = 0
    photo_count: int = 0
    missing_files: list[str] = []
    duplicate_point_ids: list[str] = []
    duplicate_channel_names: list[str] = []
    warnings: list[str] = []
    errors: list[str] = []
    can_import: bool = False


class ImportConfirmRequest(BaseModel):
    temporary_import_id: str


class ImportConfirmResponse(BaseModel):
    project_db_id: int
    project_id: str
    project_name: str


class SensorChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    device: str | None
    channel_name: str | None
    unit: str | None
    sample_rate_hz: float | None
    remark: str | None


class CaeMappingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    cae_point_id: str | None
    cae_component: str | None
    cae_result_type: str | None
    danger_level: str | None
    remark: str | None


class MediaFileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    photo_id: str | None
    type: str
    path: str
    filename: str
    taken_time: str | None
    sha256: str | None
    remark: str | None


class PointUpdate(BaseModel):
    point_name: str | None = None
    component: str | None = None
    side: str | None = None
    position_description: str | None = None
    direction: str | None = None
    bridge_type: str | None = None
    resistance_ohm: float | None = None
    install_status: str | None = None
    check_status: str | None = None
    remark: str | None = None


class PointOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_db_id: int
    point_id: str
    point_name: str
    point_type: str
    component: str | None
    side: str | None
    position_description: str | None
    direction: str | None
    bridge_type: str | None
    resistance_ohm: float | None
    install_status: str
    check_status: str | None
    remark: str | None
    channels: list[SensorChannelOut] = []
    media_files: list[MediaFileOut] = []
    cae_mappings: list[CaeMappingOut] = []


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: str
    project_name: str
    test_object: str | None
    test_type: str | None
    department: str | None
    vehicle_or_product: str | None
    test_stage: str | None
    description: str | None
    source_export_id: str | None
    source_export_time: str | None
    created_at: datetime
    updated_at: datetime
    point_count: int = 0


class ProjectUpdate(BaseModel):
    project_name: str | None = None
    test_object: str | None = None
    test_type: str | None = None
    department: str | None = None
    vehicle_or_product: str | None = None
    test_stage: str | None = None
    description: str | None = None


class TestRunCreate(BaseModel):
    run_name: str = Field(min_length=1)
    cycle_count: int
    test_time: str | None = None
    remark: str | None = None


class TestRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_db_id: int
    run_name: str
    cycle_count: int
    test_time: str | None
    remark: str | None
    created_at: datetime


class MeasurementCreate(BaseModel):
    point_db_id: int
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None


class MeasurementUpdate(BaseModel):
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    run_id: int
    point_db_id: int
    max_strain_ue: float | None
    min_strain_ue: float | None
    mean_strain_ue: float | None
    amplitude_strain_ue: float | None
    range_strain_ue: float | None
    stress_max_mpa: float | None
    stress_min_mpa: float | None
    stress_mean_mpa: float | None
    stress_amplitude_mpa: float | None
    stress_range_mpa: float | None
    is_abnormal: bool
    abnormal_reason: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime


class MeasurementBatchCreate(BaseModel):
    measurements: list[MeasurementCreate]


class TrendItem(BaseModel):
    run_id: int
    run_name: str
    cycle_count: int
    max_strain_ue: float | None
    min_strain_ue: float | None
    amplitude_strain_ue: float | None
    stress_amplitude_mpa: float | None
    is_abnormal: bool
    abnormal_reason: str | None


class AnalysisSummary(BaseModel):
    project_db_id: int
    point_count: int
    run_count: int
    measurement_count: int
    abnormal_count: int
    max_amplitude_points: list[dict[str, Any]]
    fastest_growth_points: list[dict[str, Any]]


class DewesoftChannelOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    import_id: int
    channel_name: str
    unit: str | None
    sample_count: int | None
    matched_point_db_id: int | None
    measurement_id: int | None
    stable_min_strain_ue: float | None
    stable_max_strain_ue: float | None
    stable_mean_strain_ue: float | None
    raw_json: str | None
    created_at: datetime


class DewesoftImportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_db_id: int
    test_run_id: int | None
    cycle_count: int
    run_name: str
    filename: str
    stored_path: str
    status: str
    message: str | None
    duration_seconds: float | None
    stable_start_seconds: float | None
    stable_end_seconds: float | None
    matched_channel_count: int
    unmatched_channel_count: int
    raw_metadata_json: str | None
    created_at: datetime
    channels: list[DewesoftChannelOut] = []
