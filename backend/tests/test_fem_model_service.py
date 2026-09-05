"""项目级 FEM 模型导入/持久化/导出勾选测试。"""

import uuid
import zipfile
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import models
from app.database import SessionLocal
from app.main import app
from app.services import task_progress
from app.services.fem_model_service import (
    build_fem_model_artifact,
    create_or_replace_fem_model,
    load_fem_model_payload,
)
from app.services.project_export_service import build_project_export_zip
from app.utils.path_utils import safe_dewesoft_dir, safe_fem_dir


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """模块级客户端：with 触发 lifespan（建表/初始化存储）。"""
    with TestClient(app) as c:
        yield c


def _unique_project_id() -> str:
    return f"FEMM-{uuid.uuid4().hex[:8]}"


def _create_project(client: TestClient, project_id: str) -> dict:
    resp = client.post("/api/projects", json={"project_id": project_id, "project_name": "FEM 模型测试项目"})
    assert resp.status_code == 200, f"创建项目失败: {resp.status_code} {resp.text[:200]}"
    return resp.json()


def _card(name: str, *fields: object) -> str:
    return name.ljust(8) + "".join(str(field).rjust(8) for field in fields)


SMALL_FEM = "\n".join(
    [
        "$$ test deck",
        "BEGIN BULK",
        '$HMNAME COMP                   1"plate"',
        "$HMCOMP ID 1",
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


def _upload_fem(client: TestClient, project_db_id: int) -> dict:
    resp = client.post(
        f"/api/projects/{project_db_id}/fem",
        files=[("files", ("model.fem", SMALL_FEM.encode("utf-8"), "text/plain"))],
    )
    assert resp.status_code == 200, f"上传失败: {resp.status_code} {resp.text[:300]}"
    return resp.json()


def test_task_progress_registry() -> None:
    task_progress.clear_registry_for_tests()
    task_id = task_progress.start_task("测试任务")
    assert task_progress.get_task_status(task_id)["status"] == "running"
    task_progress.report_task_progress(task_id, progress=45, message="进行中")
    status = task_progress.get_task_status(task_id)
    assert status["progress"] == 45
    task_progress.succeed_task(task_id, result={"download_url": "/x.zip"})
    status = task_progress.get_task_status(task_id)
    assert status["status"] == "succeeded"
    assert status["progress"] == 100
    # 快照携带 result，供前端导出完成后获取下载地址。
    assert status["result"] == {"download_url": "/x.zip"}
    task_progress.clear_registry_for_tests()


def test_fem_model_artifact_build_and_load(tmp_path) -> None:
    fem_dir = tmp_path / "fem"
    bundle = build_fem_model_artifact(
        fem_dir,
        [("model.fem", SMALL_FEM.encode("utf-8"))],
    )
    assert bundle.node_count == 8
    assert bundle.element_count == 3
    assert (fem_dir / "model.glb").is_file()
    assert (fem_dir / "mapping.json").is_file()
    preview = (fem_dir / "preview.json").read_text(encoding="utf-8")
    assert "artifact_version" in preview
    assert "stats" in preview


def test_fem_upload_persist_and_query(client: TestClient) -> None:
    project = _create_project(client, _unique_project_id())
    resp = client.get(f"/api/projects/{project['id']}/fem")
    assert resp.json()["status"] == "none"

    task = _upload_fem(client, project["id"])
    assert task["task_id"]
    # 任务执行需要时间，轮询等待完成。
    for _ in range(100):
        status = client.get(task["poll_url"])
        if status.status_code == 200 and status.json()["status"] != "running":
            break
        import time

        time.sleep(0.05)
    assert status.status_code == 200, f"任务未完成: {status.text[:200]}"
    assert status.json()["status"] == "succeeded"

    payload = client.get(f"/api/projects/{project['id']}/fem")
    assert payload.status_code == 200
    data = payload.json()
    assert data["status"] == "ready"
    assert data["stats"]["node_count"] == 8
    assert data["stats"]["element_count"] == 3
    assert data["glb_url"].endswith("/model.glb")
    glb = client.get(data["glb_url"])
    assert glb.status_code == 200
    assert glb.content[:4] == b"glTF"

    # 产物持久化在项目 fem 目录（冷启动可再次加载）。
    fem_dir = safe_fem_dir(project["project_id"])
    assert (fem_dir / "model.glb").is_file()
    assert (fem_dir / "preview.json").is_file()

    # 清理：删除项目（级联删记录 + 目录清理）。
    resp = client.delete(f"/api/projects/{project['id']}")
    assert resp.status_code == 200


def test_fem_upload_invalid_marks_task_failed(client: TestClient) -> None:
    project = _create_project(client, _unique_project_id())
    resp = client.post(
        f"/api/projects/{project['id']}/fem",
        files=[("files", ("bad.fem", b"GRID 1 0 0 0\n", "text/plain"))],
    )
    assert resp.status_code == 200
    task = resp.json()
    for _ in range(100):
        status = client.get(task["poll_url"])
        if status.status_code == 200 and status.json()["status"] != "running":
            break
        import time

        time.sleep(0.05)
    assert status.json()["status"] == "failed"
    client.delete(f"/api/projects/{project['id']}")


def test_export_zip_toggles(client: TestClient) -> None:
    project = _create_project(client, _unique_project_id())
    _upload_fem(client, project["id"])
    for _ in range(100):
        import time

        payload = client.get(f"/api/projects/{project['id']}/fem").json()
        if payload["status"] == "ready":
            break
        time.sleep(0.05)

    db = SessionLocal()
    try:
        # dewesoft 文件使用存储路径（相对 STORAGE_DIR）。
        dewe_dir = safe_dewesoft_dir(project["project_id"])
        dewe_dir.mkdir(parents=True, exist_ok=True)
        source = dewe_dir / "job_0001.dwd"
        source.write_bytes(b"fake-dewesoft")
        from app.services.file_service import storage_relative_path

        stored = storage_relative_path(source)
        import_job = models.DewesoftImport(
            project_db_id=project["id"],
            cycle_count=100,
            run_name="Run 100",
            filename="job_0001.dwd",
            stored_path=stored,
            status="imported",
            matched_channel_count=0,
            unmatched_channel_count=0,
        )
        db.add(import_job)
        db.commit()
        db.refresh(import_job)
    finally:
        db.close()

    # 都不勾选：zip 不含 dewesoft/ 与 fem/。
    zip_path, _name = build_project_export_zip(db, project["id"], include_dewesoft=False, include_fem=False)
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
    assert any(name.endswith("records.xlsx") for name in names)
    assert "manifest.json" in names
    assert not any(name.startswith("dewesoft/") for name in names)
    assert not any(name.startswith("fem/") for name in names)

    # 勾选 dewesoft：出现 dewesoft/ 文件。
    zip_path, _name = build_project_export_zip(db, project["id"], include_dewesoft=True, include_fem=False)
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
    assert any(name.startswith("dewesoft/") for name in names)

    # 勾选 fem：出现 fem/（源文件 + model.glb + preview.json）。
    zip_path, _name = build_project_export_zip(db, project["id"], include_dewesoft=False, include_fem=True)
    with zipfile.ZipFile(zip_path) as archive:
        names = set(archive.namelist())
    assert any(name.startswith("fem/source/") for name in names)
    assert any(name == "fem/model.glb" for name in names)
    assert any(name == "fem/preview.json" for name in names)

    client.delete(f"/api/projects/{project['id']}")


def test_fem_api_get_none_project_404(client: TestClient) -> None:
    resp = client.get("/api/projects/999999/fem")
    assert resp.status_code == 404


def test_export_route_task_and_download(client: TestClient) -> None:
    """HTTP 层：POST /export 启动打包任务，轮询后 result 提供可下载 zip。"""
    project = _create_project(client, _unique_project_id())
    resp = client.post(
        f"/api/projects/{project['id']}/export",
        json={"include_dewesoft": False, "include_fem": False},
    )
    assert resp.status_code == 200
    task = resp.json()
    assert task["task_id"]
    assert task["poll_url"] == f"/api/tasks/{task['task_id']}"

    status: dict = {}
    for _ in range(200):
        poll = client.get(task["poll_url"])
        assert poll.status_code == 200
        status = poll.json()
        if status["status"] != "running":
            break
        import time

        time.sleep(0.05)
    assert status["status"] == "succeeded"
    download_url = status["result"]["download_url"]
    assert download_url.startswith("/api/projects/exports/") and download_url.endswith(".zip")

    download = client.get(download_url)
    assert download.status_code == 200
    assert download.content[:2] == b"PK"
    client.delete(f"/api/projects/{project['id']}")

