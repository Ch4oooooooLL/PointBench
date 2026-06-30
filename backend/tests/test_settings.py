import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services import settings_service
from app.services.settings_service import safe_eval, get_stress_formula, save_stress_formula


@pytest.fixture
def temp_settings_file(tmp_path):
    old_file = settings_service.SETTINGS_FILE
    temp_file = tmp_path / "settings.json"
    settings_service.SETTINGS_FILE = temp_file
    yield temp_file
    settings_service.SETTINGS_FILE = old_file


def test_safe_eval() -> None:
    # 1. 正常公式测试
    res = safe_eval("(max-min)*0.21", {"max": 100.0, "min": 50.0})
    assert res == 10.5

    # 2. 算术运算符及括号测试
    assert safe_eval("max + min", {"max": 10.0, "min": 5.0}) == 15.0
    assert safe_eval("max - min", {"max": 10.0, "min": 5.0}) == 5.0
    assert safe_eval("max * min", {"max": 10.0, "min": 5.0}) == 50.0
    assert safe_eval("max / min", {"max": 10.0, "min": 5.0}) == 2.0
    assert safe_eval("((max + min) * 2) / 3", {"max": 10.0, "min": 5.0}) == 10.0

    # 3. 负数与单目运算符测试
    assert safe_eval("-max", {"max": 10.0, "min": 5.0}) == -10.0
    assert safe_eval("+max", {"max": 10.0, "min": 5.0}) == 10.0

    # 4. 边界：除以零
    with pytest.raises(ZeroDivisionError):
        safe_eval("max / (min - 5)", {"max": 10.0, "min": 5.0})

    # 5. 边界：非法字符/代码注入校验
    with pytest.raises(ValueError):
        safe_eval("max * min + eval('__import__(\"os\").system(\"whoami\")')", {"max": 1.0, "min": 1.0})

    with pytest.raises(ValueError):
        safe_eval("max * min; import os", {"max": 1.0, "min": 1.0})

    with pytest.raises(ValueError):
        safe_eval("max * unknown_var", {"max": 1.0, "min": 1.0})


def test_settings_read_write(temp_settings_file) -> None:
    # 初始状态应返回默认值
    assert get_stress_formula() == "(max-min)*0.21"

    # 保存后读取新值
    save_stress_formula("(max-min)*0.42")
    assert get_stress_formula() == "(max-min)*0.42"


def test_settings_router_api(temp_settings_file) -> None:
    client = TestClient(app)

    # 1. 测试 GET 接口获取默认配置
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {"stress_formula": "(max-min)*0.21"}

    # 2. 测试 PUT 接口更新配置
    response = client.put("/api/settings", json={"stress_formula": "(max-min)*0.3"})
    assert response.status_code == 200
    assert response.json() == {"stress_formula": "(max-min)*0.3"}

    # 再次 GET 应该获取到最新配置
    response = client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {"stress_formula": "(max-min)*0.3"}

    # 3. 测试非法公式的校验拦截
    response = client.put("/api/settings", json={"stress_formula": "(max-min) * undefined_var"})
    assert response.status_code == 400
    assert "公式校验失败" in response.json()["detail"]

    response = client.put("/api/settings", json={"stress_formula": "max / (min - min)"})
    assert response.status_code == 400
    assert "除以零" in response.json()["detail"]
