"""点位 ↔ FEM 单元绑定 API 测试（模型预览页点位气泡的数据来源）。"""

import uuid
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """模块级客户端：with 触发 lifespan（建表/初始化存储）。"""
    with TestClient(app) as c:
        yield c


def _create_project(client: TestClient) -> dict:
    resp = client.post(
        "/api/projects",
        json={"project_id": f"BIND-{uuid.uuid4().hex[:8]}", "project_name": "点位绑定测试项目"},
    )
    assert resp.status_code == 200, f"创建项目失败: {resp.status_code} {resp.text[:200]}"
    return resp.json()


def _create_point(client: TestClient, project_db_id: int, point_id: str) -> dict:
    resp = client.post(
        f"/api/projects/{project_db_id}/points",
        json={
            "point_id": point_id,
            "point_name": f"测点{point_id}",
            "point_type": "应变片",
            "install_status": "已安装",
        },
    )
    assert resp.status_code == 200, f"创建点位失败: {resp.status_code} {resp.text[:200]}"
    return resp.json()


def test_binding_list_starts_empty(client: TestClient) -> None:
    project = _create_project(client)
    resp = client.get(f"/api/projects/{project['id']}/point-bindings")
    assert resp.status_code == 200
    assert resp.json() == []


def test_binding_upsert_overwrites_and_lists(client: TestClient) -> None:
    project = _create_project(client)
    pid = project["id"]
    point_a = _create_point(client, pid, "A01")
    point_b = _create_point(client, pid, "A02")

    # 首次绑定：返回携带点位编号/名称，供前端气泡展示
    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point_a["id"], "element_id": 101},
    )
    assert resp.status_code == 200, resp.text[:200]
    assert resp.json() == {
        "point_db_id": point_a["id"],
        "point_id": "A01",
        "point_name": "测点A01",
        "element_id": 101,
    }

    # 同一点位重复绑定 = 覆盖，不产生第二条记录
    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point_a["id"], "element_id": 202},
    )
    assert resp.status_code == 200
    items = client.get(f"/api/projects/{pid}/point-bindings").json()
    assert len(items) == 1
    assert items[0]["element_id"] == 202

    # 第二个点位绑定同一单元：允许（多点位可引用同一单元）
    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point_b["id"], "element_id": 202},
    )
    assert resp.status_code == 200
    items = client.get(f"/api/projects/{pid}/point-bindings").json()
    assert {item["point_db_id"] for item in items} == {point_a["id"], point_b["id"]}


def test_binding_upsert_rejects_foreign_point_and_invalid_element(client: TestClient) -> None:
    project = _create_project(client)
    pid = project["id"]
    point = _create_point(client, pid, "B01")

    # 点位不属于该项目 / 不存在 → 404
    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point["id"] + 99999, "element_id": 1},
    )
    assert resp.status_code == 404

    # element_id 必须为正整数 → 422
    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point["id"], "element_id": 0},
    )
    assert resp.status_code == 422


def test_binding_delete(client: TestClient) -> None:
    project = _create_project(client)
    pid = project["id"]
    point = _create_point(client, pid, "C01")

    resp = client.put(
        f"/api/projects/{pid}/point-bindings",
        json={"point_db_id": point["id"], "element_id": 7},
    )
    assert resp.status_code == 200

    resp = client.delete(f"/api/projects/{pid}/point-bindings/{point['id']}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert client.get(f"/api/projects/{pid}/point-bindings").json() == []

    # 重复删除 → 404
    resp = client.delete(f"/api/projects/{pid}/point-bindings/{point['id']}")
    assert resp.status_code == 404
