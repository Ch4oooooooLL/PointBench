from __future__ import annotations

import csv
import json
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "sample_data"
ZIP_PATH = OUT_DIR / "FRAME-FATIGUE-202606_10points_export.zip"
CSV_PATH = OUT_DIR / "FRAME-FATIGUE-202606_10runs_measurements.csv"


def tiny_svg(text: str, color: str) -> bytes:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
<rect width="800" height="560" fill="{color}"/>
<rect x="60" y="90" width="680" height="330" rx="12" fill="#ffffff" opacity="0.88"/>
<text x="400" y="240" font-family="Arial" font-size="72" text-anchor="middle" fill="#172026">{text}</text>
<text x="400" y="320" font-family="Arial" font-size="28" text-anchor="middle" fill="#5f6f76">sample test point image</text>
</svg>""".encode("utf-8")


def build_points(now: str) -> list[dict]:
    components = ["左纵梁", "右纵梁", "前横梁", "后横梁", "中部连接板"]
    points: list[dict] = []
    for index in range(1, 11):
        point_id = f"SG{index:02d}"
        component = components[(index - 1) % len(components)]
        points.append(
            {
                "point_id": point_id,
                "point_name": f"车架疲劳测点 {point_id}",
                "point_type": "strain_gauge",
                "component": component,
                "side": "left" if index % 2 else "right",
                "position_description": f"{component} 关键焊缝附近第 {index} 号贴片位置",
                "direction": "longitudinal" if index % 3 else "transverse",
                "bridge_type": "1/4_bridge",
                "resistance_ohm": round(120.0 + index * 0.08, 2),
                "install_status": "installed",
                "check_status": "checked",
                "channel": {
                    "device": "Dewesoft",
                    "channel_name": point_id,
                    "unit": "ue",
                    "sample_rate_hz": None,
                    "remark": "",
                },
                "cae_mapping": {
                    "cae_point_id": f"CAE_{point_id}",
                    "cae_component": f"Frame_Component_{index:02d}",
                    "cae_result_type": "strain",
                    "danger_level": "high" if index in {3, 7, 10} else "medium",
                    "remark": "",
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
                "tags": ["疲劳", "CAE对应点"],
                "remark": "示例点位，电阻和零漂正常",
                "created_time": now,
                "updated_time": now,
                "custom_fields": {},
            }
        )
    return points


def build_manifest(points: list[dict], now: str) -> dict:
    return {
        "schema_version": "1.0.0",
        "export_info": {
            "export_id": "EXP-20260624-10POINTS",
            "export_time": now,
            "app_name": "TestPointRecorder",
            "app_version": "1.0.0",
            "device_name": "Android Device",
            "operator": "Lee Chao",
            "remark": "10 个点位完整功能测试数据包",
        },
        "project": {
            "project_id": "FRAME-FATIGUE-202606-10POINTS",
            "project_name": "车架疲劳台架试验 10 点位功能测试",
            "test_object": "车架",
            "test_type": "疲劳试验",
            "department": "实验部门",
            "vehicle_or_product": "非公路工程车辆车架",
            "test_stage": "功能测试",
            "description": "用于验证 zip 导入、CSV 测试数据导入、趋势图和风险标识的完整样例",
            "created_time": now,
            "updated_time": now,
        },
        "points": points,
        "files": [
            {
                "file_id": "F-001",
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
    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        package.writestr("points.xlsx", "sample placeholder")
        package.writestr("raw/readme.txt", "sample raw data placeholder")
        package.writestr("attachments/readme.txt", "sample attachment placeholder")
        for index, point in enumerate(points, start=1):
            for photo in point["photos"]:
                color = "#dce7ea" if photo["type"] == "overview" else "#f3e8c8"
                package.writestr(photo["path"], tiny_svg(f"{point['point_id']} {photo['type']}", color))


def write_measurement_csv(points: list[dict], start_time: datetime) -> None:
    headers = ["run_name", "cycle_count", "test_time", "point_id", "max_strain_ue", "min_strain_ue", "remark"]
    with CSV_PATH.open("w", newline="", encoding="utf-8-sig") as file:
        writer = csv.DictWriter(file, fieldnames=headers)
        writer.writeheader()
        for run_index in range(1, 11):
            cycle_count = run_index * 10000
            test_time = (start_time + timedelta(hours=run_index)).isoformat()
            for point_index, point in enumerate(points, start=1):
                base_amplitude = 85 + point_index * 11
                growth_rate = 0.025 + point_index * 0.004
                if point_index in {7, 10}:
                    growth_rate += 0.025
                amplitude = base_amplitude * (1 + (run_index - 1) * growth_rate)
                mean = 10 + point_index * 2 + run_index * 1.5
                max_strain = round(mean + amplitude, 2)
                min_strain = round(mean - amplitude, 2)
                writer.writerow(
                    {
                        "run_name": f"CSV-R{run_index:02d}",
                        "cycle_count": cycle_count,
                        "test_time": test_time,
                        "point_id": point["point_id"],
                        "max_strain_ue": max_strain,
                        "min_strain_ue": min_strain,
                        "remark": "debug csv import sample",
                    }
                )


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tz = timezone(timedelta(hours=8))
    now_dt = datetime(2026, 6, 24, 14, 30, tzinfo=tz)
    now = now_dt.isoformat()
    points = build_points(now)
    manifest = build_manifest(points, now)
    write_zip(points, manifest)
    write_measurement_csv(points, now_dt)
    print(ZIP_PATH)
    print(CSV_PATH)


if __name__ == "__main__":
    main()
