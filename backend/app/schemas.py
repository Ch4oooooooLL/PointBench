import math
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.utils.path_utils import PROJECT_ID_PATTERN


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
    project_id: str = Field(min_length=1, max_length=64, pattern=PROJECT_ID_PATTERN)
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
    point_id: str | None = None
    point_name: str | None = None
    point_type: str | None = None
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
    material_name: str | None = None
    elastic_modulus_mpa: float | None = None
    poisson_ratio: float | None = None
    yield_strength_mpa: float | None = None
    tensile_strength_mpa: float | None = None
    strain_unit: str | None = None
    stress_unit: str | None = None
    created_at: datetime
    updated_at: datetime
    point_count: int = 0


class ProjectCacheVersionOut(BaseModel):
    project_db_id: int
    scope: str
    version: str


class ProjectCreate(BaseModel):
    project_id: str = Field(min_length=1, max_length=64, pattern=PROJECT_ID_PATTERN)
    project_name: str = Field(min_length=1)
    test_object: str | None = None
    test_type: str | None = None
    department: str | None = None
    vehicle_or_product: str | None = None
    test_stage: str | None = None
    description: str | None = None
    material_name: str | None = None
    elastic_modulus_mpa: float | None = None
    poisson_ratio: float | None = None
    yield_strength_mpa: float | None = None
    tensile_strength_mpa: float | None = None
    strain_unit: str | None = None
    stress_unit: str | None = None


class ProjectUpdate(BaseModel):
    project_name: str | None = None
    test_object: str | None = None
    test_type: str | None = None
    department: str | None = None
    vehicle_or_product: str | None = None
    test_stage: str | None = None
    description: str | None = None
    material_name: str | None = None
    elastic_modulus_mpa: float | None = None
    poisson_ratio: float | None = None
    yield_strength_mpa: float | None = None
    tensile_strength_mpa: float | None = None
    strain_unit: str | None = None
    stress_unit: str | None = None


class PointCreate(BaseModel):
    point_id: str | None = None
    point_name: str | None = None
    point_type: str | None = None
    component: str | None = None
    side: str | None = None
    position_description: str | None = None
    direction: str | None = None
    bridge_type: str | None = None
    resistance_ohm: float | None = None
    install_status: str | None = None
    check_status: str | None = None
    remark: str | None = None


class TestRunCreate(BaseModel):
    run_name: str = Field(min_length=1)
    cycle_count: int = Field(ge=0, le=10_000_000_000)
    test_time: str | None = None
    remark: str | None = None


class TestRunUpdate(BaseModel):
    run_name: str | None = None
    cycle_count: int | None = None
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


def _validate_strain_value(v: float | None) -> float | None:
    """校验应变值：必须为有限数值且在合理范围内。"""
    if v is None:
        return v
    if not math.isfinite(v):
        raise ValueError("应变值必须为有限数值，不能为 NaN 或 Infinity")
    if v < -1_000_000 or v > 1_000_000:
        raise ValueError("应变值超出合理范围 (-1e6 ~ 1e6 με)")
    return v


class MeasurementCreate(BaseModel):
    point_db_id: int
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None

    @field_validator("max_strain_ue", "min_strain_ue")
    @classmethod
    def check_strain_finite(cls, v: float | None) -> float | None:
        return _validate_strain_value(v)


class MeasurementUpdate(BaseModel):
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None

    @field_validator("max_strain_ue", "min_strain_ue")
    @classmethod
    def check_strain_finite(cls, v: float | None) -> float | None:
        return _validate_strain_value(v)


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


class PointMeasurementRowCreate(BaseModel):
    run_name: str | None = None
    cycle_count: int = Field(ge=0, le=10_000_000_000)
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None

    @field_validator("max_strain_ue", "min_strain_ue")
    @classmethod
    def check_strain_finite(cls, v: float | None) -> float | None:
        return _validate_strain_value(v)


class PointMeasurementRowUpdate(BaseModel):
    run_name: str | None = None
    cycle_count: int | None = Field(None, ge=0, le=10_000_000_000)
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None

    @field_validator("max_strain_ue", "min_strain_ue")
    @classmethod
    def check_strain_finite(cls, v: float | None) -> float | None:
        return _validate_strain_value(v)


class PointMeasurementRowSave(BaseModel):
    id: int | None = None
    run_name: str | None = None
    cycle_count: int = Field(ge=0, le=10_000_000_000)
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    is_abnormal: bool | None = None
    abnormal_reason: str | None = None
    remark: str | None = None

    @field_validator("max_strain_ue", "min_strain_ue")
    @classmethod
    def check_strain_finite(cls, v: float | None) -> float | None:
        return _validate_strain_value(v)


class PointMeasurementRowsSave(BaseModel):
    deleted_measurement_ids: list[int] = []
    measurements: list[PointMeasurementRowSave] = []


class PointMeasurementRowOut(MeasurementOut):
    run_name: str
    cycle_count: int


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


class CrackRecordOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_db_id: int
    point_db_id: int
    test_run_id: int | None
    cycle_count: int
    filename: str
    content_type: str | None
    sha256: str | None
    remark: str | None
    created_at: datetime
    updated_at: datetime
    point_id: str
    point_name: str
    run_name: str | None


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


# ── XLSX 导入预览 / 确认 ──────────────────────────────────────────────────

from enum import Enum


class XlsxRowStatus(str, Enum):
    """XLSX 行导入状态分类。"""
    NEW_MEASUREMENT = "new_measurement"            # 新测量记录
    EXISTING_MEASUREMENT = "existing_measurement"   # 已有测量记录（可更新/覆盖）
    UNKNOWN_POINT = "unknown_point"                 # 点位不存在于当前项目
    FILE_DUPLICATE = "file_duplicate"               # 文件内重复（同一 cycle_count + point_id）
    INVALID = "invalid"                             # 无效行（缺少必要字段或数据错误）


class XlsxImportStrategyEnum(str, Enum):
    """XLSX 导入策略。

    - append_only: 仅新增不存在的记录，已有记录跳过
    - fill_missing: 新增不存在的记录；已有记录仅填补 NULL 字段
    - overwrite: 新增不存在的记录；已有记录用非空字段覆盖
    - strict: 存在任何已有记录/未知点位/重复/无效行则拒绝导入
    """
    APPEND_ONLY = "append_only"
    FILL_MISSING = "fill_missing"
    OVERWRITE = "overwrite"
    STRICT = "strict"


class XlsxImportRowError(BaseModel):
    """单行校验错误/警告。"""
    row: int
    field: str | None = None
    message: str
    severity: str = "error"  # "error" | "warning"


class XlsxPreviewItem(BaseModel):
    """单行的预览信息，包含状态和对比数据。"""
    row_index: int
    cycle_count: int | None = None
    point_id: str | None = None
    point_name: str | None = None
    run_name: str | None = None
    test_time: str | None = None
    max_strain_ue: float | None = None
    min_strain_ue: float | None = None
    status: XlsxRowStatus
    message: str | None = None
    # 已有记录值（用于前端对比展示）
    existing_max_strain_ue: float | None = None
    existing_min_strain_ue: float | None = None
    existing_run_name: str | None = None
    incoming_max_strain_ue: float | None = None
    incoming_min_strain_ue: float | None = None


class XlsxImportPreview(BaseModel):
    """XLSX 导入预览完整报告。"""
    preview_id: str
    filename: str
    total_rows: int
    valid_rows: int
    invalid_rows: int
    cycle_counts: list[int] = []
    new_run_count: int = 0
    existing_run_count: int = 0
    new_measurement_count: int = 0
    existing_measurement_count: int = 0
    will_update_count: int = 0
    unknown_point_count: int = 0
    file_duplicate_count: int = 0
    warnings: list[XlsxImportRowError] = []
    errors: list[XlsxImportRowError] = []
    items: list[XlsxPreviewItem] = []
    can_confirm: bool = False


class XlsxImportConfirmRequest(BaseModel):
    """确认导入请求。"""
    preview_id: str
    strategy: XlsxImportStrategyEnum = XlsxImportStrategyEnum.APPEND_ONLY
    update_run_meta: bool = False
    skip_unknown_points: bool = False
    skip_file_duplicates: bool = False


class XlsxImportResult(BaseModel):
    """导入结果统计。"""
    success: bool
    strategy: str
    created_run_count: int = 0
    created_measurement_count: int = 0
    updated_measurement_count: int = 0
    filled_missing_count: int = 0
    skipped_existing_count: int = 0
    skipped_invalid_count: int = 0
    skipped_unknown_point_count: int = 0
    skipped_file_duplicate_count: int = 0
    message: str = ""
