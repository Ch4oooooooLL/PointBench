from __future__ import annotations

import csv
import json
import math
import random
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "sample_data"
ZIP_PATH = OUT_DIR / "FRAME-FATIGUE-202606_12points_export.zip"
CSV_PATH = OUT_DIR / "FRAME-FATIGUE-202606_15runs_measurements.csv"

# ── 点位分类 ──────────────────────────────────────────────────
# Category A (01-03): 基本不怎么变化 — 稳定点位，应变几乎不变
# Category B (04-06): 规律变动 — 线性增长或正弦规律变化
# Category C (07-09): 复杂变动 — 有涨有跌，非单调，偶有突变
# Category D (10-12): 剧烈变动 — 大幅跳变、尖峰、骤降
# ──────────────────────────────────────────────────────────────

CATEGORY_META = {
    "A": {"label": "稳定型", "desc": "应变基本不变，仅微量噪声"},
    "B": {"label": "规律变动型", "desc": "线性增长或正弦规律"},
    "C": {"label": "复杂变动型", "desc": "涨跌交替，偶发突变"},
    "D": {"label": "剧烈变动型", "desc": "大幅跳变，尖峰骤降"},
}


def tiny_svg(text: str, color: str) -> bytes:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
<rect width="800" height="560" fill="{color}"/>
<rect x="60" y="90" width="680" height="330" rx="12" fill="#ffffff" opacity="0.88"/>
<text x="400" y="240" font-family="Arial" font-size="72" text-anchor="middle" fill="#172026">{text}</text>
<text x="400" y="320" font-family="Arial" font-size="28" text-anchor="middle" fill="#5f6f76">sample test point image</text>
</svg>""".encode("utf-8")


def build_points(now: str) -> list[dict]:
    """生成 12 个点位，分属 4 类行为模式"""
    components = ["左纵梁", "右纵梁", "前横梁", "后横梁", "中部连接板", "关键焊缝区"]
    sides = ["left", "right", "front", "rear", "middle"]
    danger_levels = {
        "A": "low",
        "B": "medium",
        "C": "high",
        "D": "critical",
    }
    tags_map = {
        "A": ["稳定区", "非关键点"],
        "B": ["规律变化", "疲劳监测"],
        "C": ["复杂变化", "CAE对应点", "需关注"],
        "D": ["剧烈变动", "危险点", "CAE对应点", "重点监控"],
    }

    points: list[dict] = []
    for index in range(1, 13):
        point_id = f"{index:02d}"
        if index <= 3:
            category = "A"
        elif index <= 6:
            category = "B"
        elif index <= 9:
            category = "C"
        else:
            category = "D"

        component = components[(index - 1) % len(components)]
        side = sides[(index - 1) % len(sides)]
        direction = "longitudinal" if index % 3 == 0 else ("transverse" if index % 3 == 1 else "principal")

        points.append(
            {
                "point_id": point_id,
                "point_name": f"车架疲劳测点 {point_id}（{CATEGORY_META[category]['label']}）",
                "point_type": "strain_gauge",
                "component": component,
                "side": side,
                "position_description": (
                    f"{component} {CATEGORY_META[category]['desc']} — "
                    f"第 {index} 号贴片位置，{side} 侧 {direction} 方向"
                ),
                "direction": direction,
                "bridge_type": "1/4_bridge" if index % 2 else "1/2_bridge",
                "resistance_ohm": round(120.0 + index * 0.08, 2),
                "install_status": "installed",
                "check_status": "checked",
                "channel": {
                    "device": "Dewesoft",
                    "channel_name": point_id,
                    "unit": "ue",
                    "sample_rate_hz": None,
                    "remark": f"Category {category} — {CATEGORY_META[category]['label']}",
                },
                "cae_mapping": {
                    "cae_point_id": f"CAE_{point_id}",
                    "cae_component": f"Frame_Component_{index:02d}",
                    "cae_result_type": "strain",
                    "danger_level": danger_levels[category],
                    "remark": CATEGORY_META[category]['desc'],
                },
                "photos": [
                    {
                        "photo_id": f"P-{point_id}-001",
                        "type": "overview",
                        "path": f"images/{point_id}_overview_001.svg",
                        "filename": f"{point_id}_overview_001.svg",
                        "taken_time": now,
                        "sha256": "",
                        "remark": "总览图",
                    },
                    {
                        "photo_id": f"P-{point_id}-002",
                        "type": "detail",
                        "path": f"images/{point_id}_detail_001.svg",
                        "filename": f"{point_id}_detail_001.svg",
                        "taken_time": now,
                        "sha256": "",
                        "remark": "细节图",
                    },
                ],
                "tags": tags_map[category],
                "remark": f"类别{category} — {CATEGORY_META[category]['desc']}，电阻和零漂正常",
                "created_time": now,
                "updated_time": now,
                "custom_fields": {"behavior_category": category},
            }
        )
    return points


def build_manifest(points: list[dict], now: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "export_info": {
            "export_id": "EXP-20260630-12POINTS-MULTI-PATTERN",
            "export_time": now,
            "app_name": "TestPointRecorder",
            "app_version": "1.0.0",
            "device_name": "Android Device",
            "operator": "Lee Chao",
            "remark": "12 个点位 × 4 类行为模式：稳定/规律/复杂/剧烈变动，15 轮测试数据",
        },
        "project": {
            "project_id": "FRAME-FATIGUE-202606-MULTI-PATTERN",
            "project_name": "车架疲劳台架试验 — 多模式行为测试",
            "test_object": "车架",
            "test_type": "疲劳试验",
            "department": "实验部门",
            "vehicle_or_product": "非公路工程车辆车架",
            "test_stage": "多模式数据验证",
            "description": (
                "验证系统对四类点位行为模式的展示能力："
                "A) 稳定型 — 基本不变；"
                "B) 规律变动 — 线性/正弦趋势；"
                "C) 复杂变动 — 涨跌交替、偶发突变；"
                "D) 剧烈变动 — 大幅跳变、尖峰骤降。"
            ),
            "created_time": now,
            "updated_time": now,
        },
        "points": points,
        "files": [
            {
                "file_id": "001",
                "type": "excel_export",
                "path": "points.xlsx",
                "filename": "points.xlsx",
                "sha256": "",
                "remark": "占位点位表",
            }
        ],
        "custom_fields": {},
    }


def write_zip(points: list[dict], manifest: dict) -> None:
    category_colors = {"A": "#dce7ea", "B": "#d4edda", "C": "#fff3cd", "D": "#f8d7da"}
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        package.writestr("points.xlsx", "sample placeholder")
        package.writestr("raw/readme.txt", "示例原始数据占位目录")
        package.writestr("attachments/readme.txt", "示例附件占位目录")
        for point in points:
            cat = point["custom_fields"]["behavior_category"]
            for photo in point["photos"]:
                color = category_colors.get(cat, "#dce7ea")
                pkg_path = photo["path"]
                # Ensure images/ prefix in zip
                if not pkg_path.startswith("images/"):
                    pkg_path = f"images/{pkg_path}"
                    photo["path"] = pkg_path  # fix manifest entry
                package.writestr(
                    pkg_path,
                    tiny_svg(f"{point['point_id']} {photo['type']}", color),
                )


# ═══════════════════════════════════════════════════════════════
#  测量数据生成 — 四类行为模式
# ═══════════════════════════════════════════════════════════════

def _stable_strain(point_index: int, run_index: int, total_runs: int) -> tuple[float, float]:
    """Category A: 基本不怎么变化 — 仅微小随机噪声"""
    base = 85.0 + point_index * 11.0
    noise = random.gauss(0, 1.5)
    max_val = base + noise
    min_val = base - 6.0 + noise
    return round(max_val, 2), round(min_val, 2)


def _regular_strain(point_index: int, run_index: int, total_runs: int) -> tuple[float, float]:
    """Category B: 规律变动 — 线性增长叠加正弦波"""
    progress = run_index / total_runs
    base_amplitude = 85.0 + point_index * 11.0
    # 线性增长：每轮振幅增长约 2%
    amplitude = base_amplitude * (1.0 + progress * 0.35)
    # 叠加小幅正弦波动
    sine_component = math.sin(progress * math.pi * 2.5) * base_amplitude * 0.06
    amplitude += sine_component
    # 均值也线性漂移
    mean = 10.0 + point_index * 2.0 + run_index * 2.0
    max_val = mean + amplitude
    min_val = mean - amplitude
    return round(max_val, 2), round(min_val, 2)


def _complex_strain(point_index: int, run_index: int, total_runs: int) -> tuple[float, float]:
    """Category C: 复杂变动 — 涨跌交替，有变大变小，偶发突变"""
    progress = run_index / total_runs
    base_amplitude = 85.0 + point_index * 11.0

    # 主趋势：先涨后跌再涨（大周期）
    trend_factor = 1.0 + 0.3 * math.sin(progress * math.pi * 1.8)

    # 中周期波动
    mid_cycle = 0.12 * math.sin(progress * math.pi * 4.5)

    # 偶发突变：在第 4、9、13 轮出现异常跳变
    spike = 0.0
    if run_index == 3:   # 第 4 轮突增
        spike = base_amplitude * 0.28
    elif run_index == 8:  # 第 9 轮骤降
        spike = -base_amplitude * 0.22
    elif run_index == 12:  # 第 13 轮大幅突增
        spike = base_amplitude * 0.35

    amplitude = base_amplitude * (trend_factor + mid_cycle) + spike
    mean = 10.0 + point_index * 2.0 + run_index * 0.8 + 6.0 * math.cos(progress * math.pi * 2.2)

    max_val = mean + abs(amplitude)
    min_val = mean - abs(amplitude)
    return round(max_val, 2), round(min_val, 2)


def _dramatic_strain(point_index: int, run_index: int, total_runs: int) -> tuple[float, float]:
    """Category D: 剧烈变动 — 大幅跳变、尖峰、骤降，模拟危险点位"""
    progress = run_index / total_runs
    base_amplitude = 85.0 + point_index * 11.0

    # 总体剧烈放大
    amp_mult = 1.0 + 0.6 * math.sin(progress * math.pi * 1.3)

    # 大幅尖峰
    spikes = {
        2: 0.55,   # 第 3 轮：尖峰 +55%
        7: 0.70,   # 第 8 轮：大幅尖峰 +70%
        10: -0.45,  # 第 11 轮：骤降 -45%
        13: 0.85,   # 第 14 轮：极端尖峰 +85%
    }
    spike = base_amplitude * spikes.get(run_index, 0.0)

    # 随机剧烈波动
    jitter = random.gauss(0, base_amplitude * 0.08)

    amplitude = base_amplitude * amp_mult + spike + jitter
    amplitude = max(amplitude, base_amplitude * 0.3)  # 防止出现负振幅

    mean = (
        10.0
        + point_index * 3.0
        + run_index * 0.5
        + 12.0 * math.sin(progress * math.pi * 3.0)
        + 8.0 * math.cos(progress * math.pi * 1.7)
    )

    max_val = mean + abs(amplitude)
    min_val = mean - abs(amplitude)
    return round(max_val, 2), round(min_val, 2)


STRAIN_GENERATORS = {
    "A": _stable_strain,
    "B": _regular_strain,
    "C": _complex_strain,
    "D": _dramatic_strain,
}


def write_measurement_csv(points: list[dict], start_time: datetime) -> None:
    """生成 15 轮测试数据，每轮对 12 个点位按各自行为模式计算应变"""
    total_runs = 15
    headers = [
        "run_name", "cycle_count", "test_time", "point_id",
        "max_strain_ue", "min_strain_ue", "remark",
    ]
    random.seed(42)  # 保证可复现

    with CSV_PATH.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader()
        for run_index in range(total_runs):
            cycle_count = (run_index + 1) * 8000
            test_time = (start_time + timedelta(hours=run_index * 2)).isoformat()
            for point in points:
                point_index = int(point["point_id"])
                cat = point["custom_fields"]["behavior_category"]
                generator = STRAIN_GENERATORS[cat]
                max_strain, min_strain = generator(point_index, run_index, total_runs)

                cat_label = CATEGORY_META[cat]["label"]
                writer.writerow(
                    {
                        "run_name": f"CSV-R{run_index + 1:02d}",
                        "cycle_count": cycle_count,
                        "test_time": test_time,
                        "point_id": point["point_id"],
                        "max_strain_ue": max_strain,
                        "min_strain_ue": min_strain,
                        "remark": f"类别{cat}-{cat_label}",
                    }
                )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tz = timezone(timedelta(hours=8))
    now_dt = datetime(2026, 6, 30, 14, 30, tzinfo=tz)
    now = now_dt.isoformat()
    points = build_points(now)
    manifest = build_manifest(points, now)
    write_zip(points, manifest)
    write_measurement_csv(points, now_dt)
    print(f"ZIP  → {ZIP_PATH}")
    print(f"CSV  → {CSV_PATH}")
    print(f"点位: {len(points)} | 轮次: 15 | 记录: {len(points) * 15}")
    print("类别分布:")
    for cat in ["A", "B", "C", "D"]:
        ids = [p["point_id"] for p in points if p["custom_fields"]["behavior_category"] == cat]
        print(f"  {cat} ({CATEGORY_META[cat]['label']}): 点位 {', '.join(ids)}")


if __name__ == "__main__":
    main()
