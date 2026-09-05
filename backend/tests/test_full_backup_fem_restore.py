"""完整备份导入恢复 FEM 模型 + 全要素演示包端到端导入测试。

覆盖：
- 备份包含 fem/source/ 源文件时，confirm 导入会解析生成 GLB 产物并写入
  fem_models 记录（此前导入侧不恢复 FEM，导出包内 fem/ 会被静默丢弃）
- 样例生成脚本 scripts/create_full_sample.py 产出的演示 zip 可直接完整
  导入：点位、照片、轮次、测量、裂缝、Dewesoft、FEM 全部恢复
"""
import io
import json
import subprocess
import sys
import uuid
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app import models
from app.database import SessionLocal
from app.main import app

REPO_ROOT = Path(__file__).resolve().parents[2]
SAMPLE_SCRIPT = REPO_ROOT / "scripts" / "create_full_sample.py"


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


def _delete_project_if_exists(client: TestClient, project_id: str) -> None:
    db = SessionLocal()
    try:
        project = db.scalar(select(models.Project).where(models.Project.project_id == project_id))
        db_id = project.id if project else None
    finally:
        db.close()
    if db_id is not None:
        client.delete(f"/api/projects/{db_id}")


def _run_import(client: TestClient, zip_bytes: bytes, filename: str) -> dict:
    preview = client.post(
        "/api/import/preview",
        files={"file": (filename, zip_bytes, "application/zip")},
    )
    assert preview.status_code == 200, f"preview 失败: {preview.status_code} {preview.text[:300]}"
    payload = preview.json()
    assert payload["can_import"] is True, f"preview 不可导入: {payload['errors']}"
    confirm = client.post("/api/import/confirm", json={"temporary_import_id": payload["temporary_import_id"]})
    assert confirm.status_code == 200, f"confirm 失败: {confirm.status_code} {confirm.text[:300]}"
    return confirm.json()


def _card(name: str, *fields: object) -> str:
    return name.ljust(8) + "".join(str(field).rjust(8) for field in fields)


def test_backup_import_restores_fem_model(client: TestClient) -> None:
    """备份包带 fem/source 源文件时，导入后 FEM 模型自动解析恢复。"""
    project_id = f"FEMBK-{uuid.uuid4().hex[:8].upper()}"
    backup = {
        "format": "pointprocess_project_backup",
        "version": "1.0",
        "export_id": f"WEB-{project_id}-20260905",
        "exported_at": "2026-09-05T10:00:00",
        "project": {"id": 1, "project_id": project_id, "project_name": "FEM 恢复测试项目"},
        "points": [],
        "test_runs": [],
        "crack_records": [],
        "dewesoft_imports": [],
        "fem_model": {
            "main_filename": "model.fem",
            "source_name": "model.fem",
            "node_count": 8,
            "element_count": 3,
        },
    }
    deck = "\n".join(
        [
            "BEGIN BULK",
            _card("GRID", 1, "", 0.0, 0.0, 0.0),
            _card("GRID", 2, "", 10.0, 0.0, 0.0),
            _card("GRID", 3, "", 10.0, 10.0, 0.0),
            _card("GRID", 4, "", 0.0, 10.0, 0.0),
            _card("GRID", 5, "", 0.0, 0.0, 10.0),
            _card("GRID", 6, "", 10.0, 0.0, 10.0),
            _card("GRID", 7, "", 10.0, 10.0, 10.0),
            _card("GRID", 8, "", 0.0, 10.0, 10.0),
            _card("CQUAD4", 1, 1, 1, 2, 3, 4),
            _card("CTRIA3", 2, 1, 5, 6, 7),
            _card("CHEXA", 3, 1, 1, 2, 3, 4, 5, 6),
            "+       " + "".join(str(field).rjust(8) for field in (7, 8)),
            "ENDDATA",
        ]
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("pointprocess_backup.json", json.dumps(backup, ensure_ascii=False))
        archive.writestr("fem/source/model.fem", deck)
    zip_bytes = buffer.getvalue()

    imported = _run_import(client, zip_bytes, "fem_backup.zip")
    project_db_id = imported["project_db_id"]
    try:
        payload = client.get(f"/api/projects/{project_db_id}/fem")
        assert payload.status_code == 200, payload.text
        data = payload.json()
        assert data["status"] == "ready", f"FEM 模型未恢复: {data}"
        assert data["stats"]["node_count"] == 8
        assert data["stats"]["element_count"] == 3
        assert data["stats"]["source_name"] == "model.fem"

        glb = client.get(data["glb_url"])
        assert glb.status_code == 200
        assert glb.content[:4] == b"glTF"

        # 产物持久化在项目 fem 目录，且包含导入时重新生成的 preview.json
        from app.utils.path_utils import safe_fem_dir

        fem_dir = safe_fem_dir(project_id)
        assert (fem_dir / "model.glb").is_file()
        assert (fem_dir / "preview.json").is_file()
        preview_payload = json.loads((fem_dir / "preview.json").read_text(encoding="utf-8"))
        assert preview_payload["stats"]["node_count"] == 8
    finally:
        client.delete(f"/api/projects/{project_db_id}")


def test_full_sample_zip_imports_end_to_end(client: TestClient, tmp_path: Path) -> None:
    """运行样例生成脚本并对产出的 zip 走完整导入，全部内容可恢复。"""
    assert SAMPLE_SCRIPT.is_file(), f"缺少样例生成脚本: {SAMPLE_SCRIPT}"
    result = subprocess.run(
        [sys.executable, str(SAMPLE_SCRIPT), "--out", str(tmp_path)],
        capture_output=True,
        text=True,
        timeout=300,
    )
    assert result.returncode == 0, f"样例生成失败: {result.stdout[-500:]} {result.stderr[-800:]}"

    zip_path = tmp_path / "POINTPROCESS_DEMO_FULL_20260905.zip"
    assert zip_path.is_file(), result.stdout
    zip_bytes = zip_path.read_bytes()

    project_id = "POINTPROCESS-DEMO-FULL-20260905"
    _delete_project_if_exists(client, project_id)

    preview = client.post(
        "/api/import/preview",
        files={"file": (zip_path.name, zip_bytes, "application/zip")},
    )
    assert preview.status_code == 200, preview.text[:300]
    payload = preview.json()
    if not payload["can_import"]:
        pytest.skip(f"样例项目已存在于当前数据库，跳过导入验证: {payload['errors']}")
    assert payload["point_count"] == 8
    # 备份预览的 photo_count = 点位照片 + 裂缝照片
    assert payload["photo_count"] == 16 + 12
    assert any("FEM" in warning for warning in payload["warnings"]), payload["warnings"]

    confirm = client.post("/api/import/confirm", json={"temporary_import_id": payload["temporary_import_id"]})
    assert confirm.status_code == 200, confirm.text[:300]
    project_db_id = confirm.json()["project_db_id"]
    try:
        db = SessionLocal()
        try:
            project = db.get(models.Project, project_db_id)
            assert project is not None and project.project_id == project_id
            points = db.scalars(select(models.TestPoint).where(models.TestPoint.project_db_id == project_db_id)).all()
            assert len(points) == 8
            runs = db.scalars(select(models.TestRun).where(models.TestRun.project_db_id == project_db_id)).all()
            assert len(runs) == 10
            measurements = (
                db.query(models.MeasurementRecord)
                .join(models.TestRun, models.MeasurementRecord.run_id == models.TestRun.id)
                .filter(models.TestRun.project_db_id == project_db_id)
                .all()
            )
            assert len(measurements) == 80
            assert any(record.is_abnormal for record in measurements)
            cracks = (
                db.query(models.CrackRecord)
                .filter(models.CrackRecord.project_db_id == project_db_id)
                .all()
            )
            assert len(cracks) == 12
            assert all(crack.stored_path for crack in cracks)
            dewe_imports = (
                db.query(models.DewesoftImport)
                .filter(models.DewesoftImport.project_db_id == project_db_id)
                .all()
            )
            assert len(dewe_imports) == 2
            dewe_channels = (
                db.query(models.DewesoftChannel)
                .join(models.DewesoftImport, models.DewesoftChannel.import_id == models.DewesoftImport.id)
                .filter(models.DewesoftImport.project_db_id == project_db_id)
                .all()
            )
            assert len(dewe_channels) == 18
            assert sum(1 for channel in dewe_channels if channel.matched_point_db_id) == 16
            media = (
                db.query(models.MediaFile)
                .filter(models.MediaFile.project_db_id == project_db_id)
                .all()
            )
            assert len(media) == 16
        finally:
            db.close()

        # FEM 模型：导入时由 fem/source 重新解析生成
        fem_payload = client.get(f"/api/projects/{project_db_id}/fem").json()
        assert fem_payload["status"] == "ready", fem_payload
        assert fem_payload["stats"]["node_count"] == 148
        assert fem_payload["stats"]["element_count"] == 116
        groups = fem_payload["grouping"]["groups"]
        assert fem_payload["grouping"]["coloring_mode"] == "component"
        assert {group["name"] for group in groups} == {"左纵梁", "右纵梁", "前横梁", "中部横梁", "后横梁", "焊缝加强板"}
        assert client.get(fem_payload["glb_url"]).content[:4] == b"glTF"
        assert client.get(fem_payload["mapping_url"]).status_code == 200

        # 裂缝图片可通过存储路径访问
        from app.services.file_service import resolve_stored_path

        db = SessionLocal()
        try:
            record = db.scalars(
                select(models.CrackRecord).where(models.CrackRecord.project_db_id == project_db_id)
            ).first()
            assert resolve_stored_path(record.stored_path).is_file()
        finally:
            db.close()
    finally:
        client.delete(f"/api/projects/{project_db_id}")
