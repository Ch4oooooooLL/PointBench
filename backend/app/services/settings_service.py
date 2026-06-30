import ast
import json
import logging
import operator
from pathlib import Path
from app.database import STORAGE_DIR

logger = logging.getLogger("app.services.settings_service")

SETTINGS_FILE = STORAGE_DIR / "settings.json"
DEFAULT_FORMULA = "(max-min)*0.21"

# 支持的安全双目运算符
OPERATORS_BIN = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
}

# 支持的安全单目运算符
OPERATORS_UNARY = {
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}


def get_stress_formula() -> str:
    """读取全局应力计算公式，若不存在或读取失败则返回默认公式。"""
    if not SETTINGS_FILE.exists():
        return DEFAULT_FORMULA
    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("stress_formula", DEFAULT_FORMULA)
    except Exception:
        logger.exception("Failed to read settings.json, fallback to default formula")
        return DEFAULT_FORMULA


def save_stress_formula(formula: str) -> None:
    """将全局应力计算公式保存到本地 settings.json。"""
    data = {}
    if SETTINGS_FILE.exists():
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            logger.warning("settings.json format is invalid, will overwrite")
            pass
    data["stress_formula"] = formula
    try:
        with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        logger.exception("Failed to write to settings.json")
        raise RuntimeError("保存设置失败，请检查系统写入权限")


def safe_eval(expr: str, variables: dict[str, float]) -> float:
    """使用 AST 安全地解析并计算含有 max 和 min 的算术表达式。"""
    # 移除所有空格
    expr_clean = "".join(expr.split())
    if not expr_clean:
        raise ValueError("公式不能为空")

    try:
        node = ast.parse(expr_clean, mode="eval")
    except SyntaxError as e:
        raise ValueError(f"公式语法错误: {e.msg}")

    def _eval(n):
        if isinstance(n, ast.Expression):
            return _eval(n.body)
        elif isinstance(n, ast.Constant):  # Python 3.8+
            if isinstance(n.value, (int, float)):
                return float(n.value)
            raise ValueError(f"公式中包含非法字符: '{n.value}'")
        elif hasattr(ast, "Num") and isinstance(n, getattr(ast, "Num")):  # 兼容 Python 3.8 以下版本
            return float(n.n)
        elif isinstance(n, ast.Name):
            name = n.id
            if name in variables:
                return float(variables[name])
            raise ValueError(f"未定义变量: '{name}'，仅支持 'max' 和 'min'")
        elif isinstance(n, ast.BinOp):
            left_val = _eval(n.left)
            right_val = _eval(n.right)
            op_type = type(n.op)
            if op_type in OPERATORS_BIN:
                if op_type == ast.Div and right_val == 0:
                    raise ZeroDivisionError("公式中检测到除以零的操作")
                return OPERATORS_BIN[op_type](left_val, right_val)
            raise ValueError(f"不支持的运算符类型: {op_type.__name__}")
        elif isinstance(n, ast.UnaryOp):
            operand_val = _eval(n.operand)
            op_type = type(n.op)
            if op_type in OPERATORS_UNARY:
                return OPERATORS_UNARY[op_type](operand_val)
            raise ValueError(f"不支持的单目运算符类型: {op_type.__name__}")
        else:
            raise ValueError("公式中包含不支持的代码结构（仅支持基本算术运算、括号及数字）")

    try:
        return _eval(node)
    except (ValueError, ZeroDivisionError) as e:
        raise e
    except Exception as e:
        raise ValueError(f"计算失败: {str(e)}")
