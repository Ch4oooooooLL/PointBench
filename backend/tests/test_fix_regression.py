"""本次修复的回归测试。

覆盖以下已修复问题：
- SQLite 外键/WAL 未启用（app/database.py connect event listener）
- XLSX confirm preview_id 路径穿越（app/routers/measurement_router.py）
- 同项目 cycle 唯一冲突 500 → 409（app/routers/measurement_router.py）
- 项目弹性模量配置不生效（app/services/analysis_service.py）
- is_abnormal=false 残留异常原因（app/routers/measurement_router.py）
- zip 炸弹无防护（app/utils/zip_utils.py）
- create_project 审计日志不落库（app/routers/project_router.py）
- 图片上传无大小限制（app/routers/point_router.py）
"""
import io
import uuid
import zipfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import database, models
from app.database import engine
from app.main import app
from app.routers.measurement_router import apply_measurement_payload
from app.schemas import MeasurementUpdate
from app.services.analysis_service import compute_measurement_fields
from app.utils.zip_utils import MAX_COMPRESSION_RATIO, safe_extract


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """模块级客户端：with 触发 lifespan（建表/初始化存储）。"""
    with TestClient(app) as c:
        yield c


def _unique_project_id() -> str:
    return f"REGT-{uuid.uuid4().hex[:8]}"


def _create_project(client: TestClient, project_id: str) -> int:
    resp = client.post("/api/projects", json={"project_id": project_id, "project_name": "回归测试项目"})
    assert resp.status_code == 200, f"创建项目失败: {resp.status_code} {resp.text[:200]}"
    return resp.json()["id"]


# ── 1. SQLite 外键 / WAL ────────────────────────────────────────────────────


def test_sqlite_foreign_keys_enabled() -> None:
    """PRAGMA foreign_keys 必须为 1：级联删除在 DB 层生效。"""
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1


def test_sqlite_wal_enabled() -> None:
    """PRAGMA journal_mode 应为 WAL，提升并发读写。"""
    with engine.connect() as conn:
        assert conn.exec_driver_sql("PRAGMA journal_mode").scalar() == "wal"


# ── 2. preview_id 路径穿越 / 非法格式 ───────────────────────────────────────


def test_xlsx_confirm_rejects_traversal_preview_id(client: TestClient) -> None:
    """`../../xxx` 形式的 preview_id 必须被 400 拦截，防止路径穿越读删文件。"""
    pid = _create_project(client, _unique_project_id())
    resp = client.post(
        f"/api/projects/{pid}/measurements/import-xlsx/confirm",
        json={"preview_id": "../../etc/passwd", "rows": []},
    )
    assert resp.status_code == 400, resp.text[:200]


def test_xlsx_confirm_rejects_invalid_preview_id_format(client: TestClient) -> None:
    """含特殊字符（分号等）的 preview_id 必须被 400 拦截。"""
    pid = _create_project(client, _unique_project_id())
    resp = client.post(
        f"/api/projects/{pid}/measurements/import-xlsx/confirm",
        json={"preview_id": "XLSX-deadbeef;rm -rf /", "rows": []},
    )
    assert resp.status_code == 400, resp.text[:200]


# ── 3. cycle 唯一冲突 409 ───────────────────────────────────────────────────


def test_duplicate_cycle_returns_409(client: TestClient) -> None:
    """同项目同 cycle_count 的 TestRun 冲突应返回 409 而非 500。"""
    pid = _create_project(client, _unique_project_id())
    resp = client.post(
        f"/api/projects/{pid}/test-runs",
        json={"cycle_count": 1, "run_name": "run-A"},
    )
    assert resp.status_code in (200, 201), f"创建 run 失败: {resp.text[:200]}"
    resp = client.post(
        f"/api/projects/{pid}/test-runs",
        json={"cycle_count": 1, "run_name": "run-B"},
    )
    assert resp.status_code == 409, f"cycle 冲突未返回 409: {resp.status_code} {resp.text[:200]}"


# ── 4. 弹性模量配置生效 ─────────────────────────────────────────────────────


def test_elastic_modulus_param_affects_stress(monkeypatch) -> None:
    """全局公式求值失败回退弹性模量换算时，elastic_modulus_mpa 参数必须生效。"""
    # 模拟全局公式缺失/非法 → safe_eval 抛异常 → 走弹性模量回退路径
    monkeypatch.setattr("app.services.analysis_service.get_stress_formula", lambda: "invalid formula !!")
    default = models.MeasurementRecord(run_id=1, point_db_id=1, max_strain_ue=1000.0, min_strain_ue=0.0)
    compute_measurement_fields(default)  # 默认 206000 MPa
    configured = models.MeasurementRecord(run_id=1, point_db_id=1, max_strain_ue=1000.0, min_strain_ue=0.0)
    compute_measurement_fields(configured, elastic_modulus_mpa=100000)
    assert default.stress_amplitude_mpa is not None
    assert configured.stress_amplitude_mpa is not None
    assert configured.stress_amplitude_mpa != default.stress_amplitude_mpa
    # 100000 < 206000 → 应力幅应更小
    assert configured.stress_amplitude_mpa < default.stress_amplitude_mpa


def test_project_elastic_modulus_config_takes_effect(monkeypatch) -> None:
    """项目级 elastic_modulus_mpa 配置在单条计算时经懒加载生效。"""
    # 使用内存库，避免污染开发数据库
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session, sessionmaker

    engine_mem = create_engine("sqlite:///:memory:")
    from app.database import Base

    Base.metadata.create_all(engine_mem)
    session_factory = sessionmaker(bind=engine_mem)
    db: Session = session_factory()

    try:
        project = models.Project(
            project_id="REGT-MOD",
            project_name="弹性模量项目",
            elastic_modulus_mpa=150000,
            raw_manifest_json='{"source": "test"}',
        )
        db.add(project)
        db.flush()
        point = models.TestPoint(
            project_db_id=project.id,
            point_id="P1",
            point_name="测点",
            point_type="应变片",
            install_status="已安装",
            raw_json="{}",
        )
        db.add(point)
        db.flush()
        run = models.TestRun(project_db_id=project.id, cycle_count=1, run_name="run1")
        db.add(run)
        db.flush()
        record = models.MeasurementRecord(run_id=run.id, point_db_id=point.id, max_strain_ue=1000.0, min_strain_ue=0.0)
        db.add(record)
        db.commit()

        monkeypatch.setattr("app.services.analysis_service.get_stress_formula", lambda: "invalid formula !!")
        compute_measurement_fields(record)  # 不传参数 → 应经懒加载使用项目配置 150000
        # 默认 206000 时: 500 * 206000/1e6 = 103；项目 150000 时: 500 * 0.15 = 75
        assert record.stress_amplitude_mpa is not None
        assert abs(record.stress_amplitude_mpa - 75.0) < 1e-6, f"实际值: {record.stress_amplitude_mpa}"
    finally:
        db.close()


# ── 5. is_abnormal=false 清除异常原因 ───────────────────────────────────────


def test_is_abnormal_false_clears_reason() -> None:
    """显式传 is_abnormal=false 时必须清空历史 abnormal_reason。"""
    record = models.MeasurementRecord(run_id=1, point_db_id=1, is_abnormal=True, abnormal_reason="旧原因")
    apply_measurement_payload(record, MeasurementUpdate(is_abnormal=False))
    assert record.is_abnormal is False
    assert record.abnormal_reason is None


# ── 6. zip 炸弹防护 ─────────────────────────────────────────────────────────


def test_zip_bomb_high_compression_ratio_blocked(tmp_path) -> None:
    """高压缩比 zip（2MB 零字节压缩成几 KB）必须被 safe_extract 拦截。"""
    buf = io.BytesIO()
    payload = b"\x00" * (2 * 1024 * 1024)  # 2MB，压缩后极小 → 压缩比远超上限
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("bomb.txt", payload)
    buf.seek(0)
    with zipfile.ZipFile(buf) as zf:
        member = zf.infolist()[0]
        assert member.file_size / member.compress_size > MAX_COMPRESSION_RATIO
        with pytest.raises(ValueError, match="压缩比异常"):
            safe_extract(zf, tmp_path)


# ── 7. create_project 审计日志落库 ──────────────────────────────────────────


def test_create_project_writes_audit_log(client: TestClient) -> None:
    """创建项目后 audit_logs 必须有一条 create 记录（此前被静默回滚）。"""
    project_id = _unique_project_id()
    pid = _create_project(client, project_id)
    try:
        db = database.SessionLocal()
        try:
            logs = db.scalars(
                select(models.AuditLog).where(
                    models.AuditLog.object_type == "project",
                    models.AuditLog.object_id == project_id,
                    models.AuditLog.action == "create",
                )
            ).all()
            assert len(logs) == 1, f"期望 1 条 create 审计，实际 {len(logs)} 条"
        finally:
            db.close()
    finally:
        resp = client.delete(f"/api/projects/{pid}")
        assert resp.status_code == 200, f"清理项目失败: {resp.status_code} {resp.text[:200]}"


# ── 8. 图片上传大小限制 ─────────────────────────────────────────────────────


def test_image_upload_over_20mb_rejected(client: TestClient) -> None:
    """超过 20MB 的图片上传必须被 400 拒绝。"""
    pid = _create_project(client, _unique_project_id())
    resp = client.post(f"/api/projects/{pid}/points", json={"point_id": "REGT-P1", "point_name": "测点1"})
    assert resp.status_code == 200, f"创建测点失败: {resp.text[:200]}"
    point_id = resp.json()["id"]
    # 先造一个合法的极小 PNG magic bytes，再填充到超限（content_type 通过 + 大小超限）
    big = b"\x89PNG\r\n\x1a\n" + b"\x00" * (20 * 1024 * 1024 + 1)
    resp = client.post(
        f"/api/points/{point_id}/media",
        files={"file": ("big.png", big, "image/png")},
        data={"media_type": "overall"},
    )
    assert resp.status_code == 400, f"超限上传未被拒绝: {resp.status_code} {resp.text[:200]}"
