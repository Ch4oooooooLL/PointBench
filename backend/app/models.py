from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def now() -> datetime:
    """返回当前 UTC 时间的 naive 表示（SQLite 统一存 naive UTC，兼容原 utcnow 语义）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class SoftDeleteMixin:
    """软删除 Mixin：为模型添加 deleted_at / deleted_by 字段。"""
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    deleted_by: Mapped[str | None] = mapped_column(String(128), nullable=True, default=None)


class Project(Base, SoftDeleteMixin):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    project_name: Mapped[str] = mapped_column(String(255))
    test_object: Mapped[str | None] = mapped_column(String(255), nullable=True)
    test_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vehicle_or_product: Mapped[str | None] = mapped_column(String(255), nullable=True)
    test_stage: Mapped[str | None] = mapped_column(String(255), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_export_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    source_export_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    raw_manifest_json: Mapped[str] = mapped_column(Text)
    # 材料参数（项目级可配置，默认普通钢材）
    material_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    elastic_modulus_mpa: Mapped[float | None] = mapped_column(Float, nullable=True, default=206000.0)
    poisson_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    yield_strength_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    tensile_strength_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    strain_unit: Mapped[str | None] = mapped_column(String(64), nullable=True, default="με")
    stress_unit: Mapped[str | None] = mapped_column(String(64), nullable=True, default="MPa")
    # 异常识别规则（项目级可配置，JSON 格式存储便于扩展）
    anomaly_rules_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    points: Mapped[list["TestPoint"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    media_files: Mapped[list["MediaFile"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    test_runs: Mapped[list["TestRun"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    dewesoft_imports: Mapped[list["DewesoftImport"]] = relationship(back_populates="project", cascade="all, delete-orphan")
    crack_records: Mapped[list["CrackRecord"]] = relationship(back_populates="project", cascade="all, delete-orphan")


class TestPoint(Base, SoftDeleteMixin):
    __tablename__ = "test_points"
    __table_args__ = (UniqueConstraint("project_db_id", "point_id", name="uq_project_point"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_db_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    point_id: Mapped[str] = mapped_column(String(128), index=True)
    point_name: Mapped[str] = mapped_column(String(255))
    point_type: Mapped[str] = mapped_column(String(64))
    component: Mapped[str | None] = mapped_column(String(255), nullable=True)
    side: Mapped[str | None] = mapped_column(String(64), nullable=True)
    position_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    direction: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bridge_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    resistance_ohm: Mapped[float | None] = mapped_column(Float, nullable=True)
    install_status: Mapped[str] = mapped_column(String(64))
    check_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    raw_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    project: Mapped[Project] = relationship(back_populates="points")
    channels: Mapped[list["SensorChannel"]] = relationship(back_populates="point", cascade="all, delete-orphan")
    media_files: Mapped[list["MediaFile"]] = relationship(back_populates="point", cascade="all, delete-orphan")
    cae_mappings: Mapped[list["CaeMapping"]] = relationship(back_populates="point", cascade="all, delete-orphan")
    measurements: Mapped[list["MeasurementRecord"]] = relationship(back_populates="point", cascade="all, delete-orphan")
    crack_records: Mapped[list["CrackRecord"]] = relationship(back_populates="point", cascade="all, delete-orphan")


class SensorChannel(Base):
    __tablename__ = "sensor_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    point_db_id: Mapped[int] = mapped_column(ForeignKey("test_points.id", ondelete="CASCADE"), index=True)
    device: Mapped[str | None] = mapped_column(String(255), nullable=True)
    channel_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sample_rate_hz: Mapped[float | None] = mapped_column(Float, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    point: Mapped[TestPoint] = relationship(back_populates="channels")


class MediaFile(Base, SoftDeleteMixin):
    __tablename__ = "media_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_db_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    point_db_id: Mapped[int | None] = mapped_column(ForeignKey("test_points.id", ondelete="CASCADE"), nullable=True, index=True)
    photo_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    type: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(String(500))
    stored_path: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(255))
    taken_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="media_files")
    point: Mapped[TestPoint | None] = relationship(back_populates="media_files")


class CaeMapping(Base):
    __tablename__ = "cae_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    point_db_id: Mapped[int] = mapped_column(ForeignKey("test_points.id", ondelete="CASCADE"), index=True)
    cae_point_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cae_component: Mapped[str | None] = mapped_column(String(255), nullable=True)
    cae_result_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    danger_level: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)

    point: Mapped[TestPoint] = relationship(back_populates="cae_mappings")


class TestRun(Base, SoftDeleteMixin):
    __tablename__ = "test_runs"
    __table_args__ = (UniqueConstraint("project_db_id", "cycle_count", name="uq_project_cycle"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_db_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    run_name: Mapped[str] = mapped_column(String(255))
    cycle_count: Mapped[int] = mapped_column(Integer)
    test_time: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    project: Mapped[Project] = relationship(back_populates="test_runs")
    measurements: Mapped[list["MeasurementRecord"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    crack_records: Mapped[list["CrackRecord"]] = relationship(back_populates="run")


class MeasurementRecord(Base, SoftDeleteMixin):
    __tablename__ = "measurement_records"
    __table_args__ = (UniqueConstraint("run_id", "point_db_id", name="uq_run_point_measurement"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("test_runs.id", ondelete="CASCADE"), index=True)
    point_db_id: Mapped[int] = mapped_column(ForeignKey("test_points.id", ondelete="CASCADE"), index=True)
    max_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    mean_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    amplitude_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    stress_max_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    stress_min_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    stress_mean_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    stress_amplitude_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    stress_range_mpa: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_abnormal: Mapped[bool] = mapped_column(Boolean, default=False)
    abnormal_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    run: Mapped[TestRun] = relationship(back_populates="measurements")
    point: Mapped[TestPoint] = relationship(back_populates="measurements")


class CrackRecord(Base, SoftDeleteMixin):
    __tablename__ = "crack_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_db_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    point_db_id: Mapped[int] = mapped_column(ForeignKey("test_points.id", ondelete="CASCADE"), index=True)
    test_run_id: Mapped[int | None] = mapped_column(ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    cycle_count: Mapped[int] = mapped_column(Integer, index=True)
    stored_path: Mapped[str] = mapped_column(String(500))
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str | None] = mapped_column(String(128), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(128), nullable=True)
    remark: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)

    project: Mapped[Project] = relationship(back_populates="crack_records")
    point: Mapped[TestPoint] = relationship(back_populates="crack_records")
    run: Mapped[TestRun | None] = relationship(back_populates="crack_records")


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    export_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    zip_filename: Mapped[str] = mapped_column(String(255))
    zip_stored_path: Mapped[str] = mapped_column(String(500))
    temp_dir: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="previewed")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)


class DewesoftImport(Base):
    __tablename__ = "dewesoft_imports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_db_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    test_run_id: Mapped[int | None] = mapped_column(ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True, index=True)
    cycle_count: Mapped[int] = mapped_column(Integer)
    run_name: Mapped[str] = mapped_column(String(255))
    filename: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(64), default="pending")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    stable_start_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    stable_end_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    matched_channel_count: Mapped[int] = mapped_column(Integer, default=0)
    unmatched_channel_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    project: Mapped[Project] = relationship(back_populates="dewesoft_imports")
    channels: Mapped[list["DewesoftChannel"]] = relationship(back_populates="import_job", cascade="all, delete-orphan")


class DewesoftChannel(Base):
    __tablename__ = "dewesoft_channels"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    import_id: Mapped[int] = mapped_column(ForeignKey("dewesoft_imports.id", ondelete="CASCADE"), index=True)
    channel_name: Mapped[str] = mapped_column(String(255), index=True)
    unit: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sample_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    matched_point_db_id: Mapped[int | None] = mapped_column(ForeignKey("test_points.id", ondelete="SET NULL"), nullable=True, index=True)
    measurement_id: Mapped[int | None] = mapped_column(ForeignKey("measurement_records.id", ondelete="SET NULL"), nullable=True)
    stable_min_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    stable_max_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    stable_mean_strain_ue: Mapped[float | None] = mapped_column(Float, nullable=True)
    raw_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)

    import_job: Mapped[DewesoftImport] = relationship(back_populates="channels")


class User(Base):
    """系统用户 —— 支持本地账号密码认证。"""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="viewer")  # viewer / editor / admin
    display_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=now, onupdate=now)


class AuditLog(Base):
    """操作审计日志 —— 记录所有写操作的追溯信息。"""
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True, default=None)
    action: Mapped[str] = mapped_column(String(64), index=True)
    object_type: Mapped[str] = mapped_column(String(64), index=True)
    object_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    before_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=now, index=True)
