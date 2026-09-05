"""Backup 导入（pointprocess_backup.json）回归测试。

覆盖：
- preview 识别完整 backup 包
- confirm 导入完整 backup（曾因 project_data 定义被误移入内层函数而
  NameError 500，见 import_service._confirm_backup_import）
"""
import io
import json
import uuid
import zipfile
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.database import engine
from app.main import app


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """模块级客户端：with 触发 lifespan（建表/初始化存储）。"""
    with TestClient(app) as c:
        yield c


def _unique_project_id() -> str:
    return f"BKUP-{uuid.uuid4().hex[:8].upper()}"


def _build_backup_zip(project_id: str, project_name: str) -> bytes:
    """构造与旧版导出一致的最小完整 backup 包。"""
    backup = {
        "format": "pointprocess_project_backup",
        "version": "1.0",
        "export_id": f"WEB-{project_id}-20260801",
        "exported_at": "2026-08-01T10:00:00",
        "project": {
            "id": 1,
            "project_id": project_id,
            "project_name": project_name,
            "test_object": "回归测试对象",
            "test_type": "疲劳",
            "department": None,
            "vehicle_or_product": None,
            "test_stage": None,
            "description": None,
            "source_export_id": None,
            "source_export_time": None,
            "raw_manifest_json": None,
            "created_at": "2026-08-01T10:00:00",
            "updated_at": "2026-08-01T10:00:00",
        },
        "points": [
            {
                "id": 1,
                "point_id": f"{project_id}-P1",
                "point_name": "测点1",
                "point_type": "strain",
                "component": None,
                "side": None,
                "position_description": None,
                "direction": None,
                "bridge_type": None,
                "resistance_ohm": None,
                "install_status": "installed",
                "check_status": None,
                "remark": None,
                "raw_json": None,
                "created_at": "2026-08-01T10:00:00",
                "updated_at": "2026-08-01T10:00:00",
                "channel": None,
                "cae_mapping": None,
                "photos": [],
            }
        ],
        "test_runs": [],
        "crack_records": [],
        "dewesoft_imports": [],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.writestr("pointprocess_backup.json", json.dumps(backup, ensure_ascii=False))
    return buf.getvalue()


def test_backup_import_confirm_previously_crashed(client: TestClient) -> None:
    """完整 backup 包能走通 preview + confirm（曾 500 NameError）。"""
    project_id = _unique_project_id()
    project_name = "备份导入回归项目"
    zip_bytes = _build_backup_zip(project_id, project_name)

    # 预览
    preview = client.post(
        "/api/import/preview",
        files={"file": ("old_export.zip", zip_bytes, "application/zip")},
    )
    assert preview.status_code == 200, f"preview 失败: {preview.status_code} {preview.text[:300]}"
    payload = preview.json()
    assert payload["can_import"] is True, f"preview 不可导入: {payload['errors']}"
    assert payload["project_id"] == project_id
    temporary_import_id = payload["temporary_import_id"]

    # 确认（曾在这里 NameError 500）
    confirm = client.post(
        "/api/import/confirm",
        json={"temporary_import_id": temporary_import_id},
    )
    assert confirm.status_code == 200, f"confirm 失败: {confirm.status_code} {confirm.text[:300]}"
    body = confirm.json()
    assert body["project_id"] == project_id
    assert body["project_name"] == project_name

    # 确认结果可从项目列表读回
    listed = client.get("/api/projects")
    assert listed.status_code == 200
    assert any(p["project_id"] == project_id for p in listed.json()), "导入项目未出现在项目列表"

    # 清理
    project_db_id = body["project_db_id"]
    deleted = client.delete(f"/api/projects/{project_db_id}")
    assert deleted.status_code == 200, deleted.text


def test_backup_import_duplicate_rejected(client: TestClient) -> None:
    """已存在项目时 confirm 应 400 而非 500。"""
    project_id = _unique_project_id()
    zip_bytes = _build_backup_zip(project_id, "重复导入项目")

    preview = client.post(
        "/api/import/preview",
        files={"file": ("dup.zip", zip_bytes, "application/zip")},
    )
    assert preview.status_code == 200, preview.text
    temporary_import_id = preview.json()["temporary_import_id"]
    first = client.post("/api/import/confirm", json={"temporary_import_id": temporary_import_id})
    assert first.status_code == 200, first.text
    project_db_id = first.json()["project_db_id"]

    # 同项目再次导入 → preview 阶段就应报已存在
    preview2 = client.post(
        "/api/import/preview",
        files={"file": ("dup.zip", zip_bytes, "application/zip")},
    )
    assert preview2.status_code == 200, preview2.text
    assert preview2.json()["can_import"] is False, "重复项目 preview 应拒绝导入"
    assert any("already exists" in e or "已存在" in e for e in preview2.json()["errors"]), preview2.text

    deleted = client.delete(f"/api/projects/{project_db_id}")
    assert deleted.status_code == 200, deleted.text
