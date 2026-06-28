"""P0 安全边界测试 —— 覆盖 project_id 校验、路径穿越防护、上传文件名安全。"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import models
from app.main import app
from app.utils.path_utils import (
    PROJECT_ID_PATTERN,
    safe_dewesoft_dir,
    safe_project_dir,
    validate_project_id,
)


# ── 单元测试：validate_project_id ──────────────────────────────────────────

VALID_IDS = [
    "TEST-001",
    "FRAME_FATIGUE_2026",
    "abc123",
    "A",
    "a" * 64,  # 最大长度
    "0-start",
    "X_Y-Z",
    "project_2026_06_28",
]

INVALID_IDS = [
    ("../abc", "路径穿越 ../"),
    ("abc/def", "包含斜杠"),
    ("abc\\def", "包含反斜杠"),
    ("", "空字符串"),
    (" abc", "前导空格"),
    ("-abc", "以短横线开头"),
    ("_abc", "以下划线开头"),
    (".abc", "以点号开头"),
    ("a" * 65, "超过最大长度 64"),
    ("中文项目", "包含中文字符"),
    ("abc def", "包含空格"),
    ("abc..def", "包含双点"),
    ("/absolute", "绝对路径风格"),
]


class TestValidateProjectId:
    @pytest.mark.parametrize("project_id", VALID_IDS)
    def test_valid_ids_pass(self, project_id: str) -> None:
        result = validate_project_id(project_id)
        assert result == project_id

    @pytest.mark.parametrize("project_id,reason", INVALID_IDS)
    def test_invalid_ids_raise_400(self, project_id: str, reason: str) -> None:
        with pytest.raises(HTTPException) as exc_info:
            validate_project_id(project_id)
        assert exc_info.value.status_code == 400, f"{reason}: 应返回 400"


# ── 单元测试：safe_project_dir / safe_dewesoft_dir ─────────────────────────

class TestSafeProjectDir:
    def test_returns_path_inside_storage(self) -> None:
        path = safe_project_dir("TEST-PROJECT")
        assert path.name == "TEST-PROJECT"
        assert "storage" in str(path)
        assert "projects" in str(path)

    def test_rejects_path_traversal(self) -> None:
        with pytest.raises(HTTPException) as exc_info:
            safe_project_dir("../evil")
        assert exc_info.value.status_code == 400

    def test_rejects_absolute_path_style(self) -> None:
        with pytest.raises(HTTPException) as exc_info:
            safe_project_dir("/etc/passwd")
        assert exc_info.value.status_code == 400


class TestSafeDewesoftDir:
    def test_returns_path_inside_storage(self) -> None:
        path = safe_dewesoft_dir("TEST-PROJECT")
        assert path.name == "TEST-PROJECT"
        assert "storage" in str(path)
        assert "dewesoft" in str(path)

    def test_rejects_invalid_project_id(self) -> None:
        with pytest.raises(HTTPException) as exc_info:
            safe_dewesoft_dir("../evil")
        assert exc_info.value.status_code == 400


# ── 接口测试：非法 project_id ──────────────────────────────────────────────

client = TestClient(app)


@pytest.fixture(scope="class")
def admin_token() -> str:
    """Class-scoped fixture: login once and reuse token."""
    # First ensure admin exists via API-direct DB
    from app.database import SessionLocal
    from app.utils.auth_utils import hash_password

    db = SessionLocal()
    try:
        from sqlalchemy import select as sa_select
        admin = db.scalar(sa_select(models.User).where(models.User.username == "admin"))
        if admin:
            admin.password_hash = hash_password("admin123")
        else:
            db.add(models.User(
                username="admin",
                password_hash=hash_password("admin123"),
                role="admin",
                display_name="管理员",
            ))
        db.commit()
    finally:
        db.close()

    resp = client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]


class TestProjectIdValidationAPI:
    @pytest.fixture(autouse=True)
    def _setup(self, admin_token: str) -> None:
        self.token = admin_token

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.token}"}

    def test_create_project_with_invalid_id_returns_422(self) -> None:
        """Pydantic schema 校验应拒绝非法 project_id（即使已认证）。"""
        payload = {
            "project_id": "../malicious",
            "project_name": "Test Project",
        }
        response = client.post("/api/projects", json=payload, headers=self._headers())
        assert response.status_code == 422, response.text

    def test_create_project_with_valid_id_succeeds(self) -> None:
        """合法 project_id 可以创建项目（管理员认证）。"""
        payload = {
            "project_id": "SECURITY-TEST-001",
            "project_name": "Security Test Project",
        }
        response = client.post("/api/projects", json=payload, headers=self._headers())
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["project_id"] == "SECURITY-TEST-001"
        # Clean up via API
        proj_id = data["id"]
        client.delete(f"/api/projects/{proj_id}?permanent=true", headers=self._headers())

    def test_create_project_without_auth_returns_401(self) -> None:
        """未登录用户不能创建项目。"""
        payload = {
            "project_id": "NO-AUTH-TEST",
            "project_name": "No Auth",
        }
        response = client.post("/api/projects", json=payload)
        assert response.status_code == 401, response.text

    def test_create_project_with_traversal_id_blocked(self) -> None:
        """路径穿越风格的 project_id 被拒绝。"""
        payload = {
            "project_id": "..\\..\\windows",
            "project_name": "Evil",
        }
        response = client.post("/api/projects", json=payload, headers=self._headers())
        assert response.status_code == 422, response.text

    def test_create_project_with_slash_blocked(self) -> None:
        """包含 / 的 project_id 被拒绝。"""
        payload = {
            "project_id": "abc/def",
            "project_name": "Slash Project",
        }
        response = client.post("/api/projects", json=payload, headers=self._headers())
        assert response.status_code == 422, response.text

    def test_create_project_with_special_chars_blocked(self) -> None:
        """包含特殊字符的 project_id 被拒绝。"""
        for bad_id in ["中文名", "a b", ".hidden"]:
            payload = {"project_id": bad_id, "project_name": "Bad"}
            response = client.post("/api/projects", json=payload, headers=self._headers())
            assert response.status_code == 422, f"{bad_id} should be rejected"

    def test_health_check(self) -> None:
        """健康检查接口正常。"""
        response = client.get("/api/health")
        assert response.status_code == 200
        assert response.json() == {"ok": True}


# ── 接口测试：zip 上传使用安全文件名 ────────────────────────────────────────

class TestZipUploadFilenameSafety:
    def test_upload_zip_not_called_client_filename(self) -> None:
        """验证 zip 导入接口接受正常请求（文件名安全由后端生成，客户端不可控）。"""
        # 构造一个最小合法 zip（含 manifest.json）
        import io
        import json
        from zipfile import ZIP_DEFLATED, ZipFile

        manifest = {
            "schema_version": "1.0.0",
            "export_info": {
                "export_id": "TEST-EXPORT-001",
                "export_time": "2026-06-28T00:00:00",
                "app_name": "TestApp",
                "app_version": "1.0",
            },
            "project": {
                "project_id": "ZIP-TEST-001",
                "project_name": "Zip Test Project",
            },
            "points": [
                {
                    "point_id": "P01",
                    "point_name": "Test Point 1",
                    "point_type": "strain",
                    "install_status": "planned",
                    "photos": [],
                }
            ],
        }
        zip_buffer = io.BytesIO()
        with ZipFile(zip_buffer, "w", ZIP_DEFLATED) as zf:
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        zip_buffer.seek(0)

        response = client.post(
            "/api/import/preview",
            files={"file": ("../../../evil.zip", zip_buffer, "application/zip")},
        )
        # 应返回 200（preview 成功）而非 400/422；物理文件名已是 UUID
        assert response.status_code == 200, response.text
        data = response.json()
        assert data.get("can_import") is True
        assert data.get("project_id") == "ZIP-TEST-001"

    def test_upload_non_zip_rejected(self) -> None:
        """非 zip 文件被拒绝。"""
        response = client.post(
            "/api/import/preview",
            files={"file": ("test.txt", b"not a zip", "text/plain")},
        )
        assert response.status_code == 400, response.text

    def test_upload_zip_with_traversal_members_blocked(self) -> None:
        """zip 内含路径穿越文件时被拒绝。"""
        import io
        from zipfile import ZIP_DEFLATED, ZipFile

        zip_buffer = io.BytesIO()
        with ZipFile(zip_buffer, "w", ZIP_DEFLATED) as zf:
            zf.writestr("../evil.txt", "malicious content")
            zf.writestr("manifest.json", '{"schema_version":"1.0.0"}')
        zip_buffer.seek(0)

        response = client.post(
            "/api/import/preview",
            files={"file": ("traversal.zip", zip_buffer, "application/zip")},
        )
        # zip slip 检测应触发错误
        data = response.json()
        assert not data.get("can_import", True), "包含路径穿越的 zip 不应允许导入"
