"""生成 PointProcess 全要素演示数据包（可直接完整导入）。

产出（默认写入 ``sample_data/``）：

- ``POINTPROCESS_DEMO_FULL_<date>.zip``            完整备份导入包
- ``POINTPROCESS_DEMO_FULL_<date>_summary.json``   包内容摘要

包内同时携带 ``manifest.json``（应用兼容视图）与 ``pointprocess_backup.json``
（完整迁移数据），并包含 ``fem/`` 源文件目录（主文件 + INCLUDE 子文件）。
通过 导入 → 上传 zip → 预览 → 确认导入 即可一次性恢复：

- 项目（车架疲劳台架试验）
- 8 个点位：通道、CAE 映射、安装/检查状态、点位照片
- 10 个测试轮次 × 8 点位测量数据（含异常记录）
- 12 条裂缝记录（裂缝照片，关联点位与轮次）
- 2 条 Dewesoft 导入记录（含匹配/未匹配通道）
- FEM 模型（OptiStruct 格式，导入端自动解析并生成 GLB 渲染产物）

用法::

    python scripts/create_full_sample.py [--out sample_data] [--seed 20260905]

脚本在打包前会用后端 FEM 解析器实际解析生成的模型文件，确保随包分发的
FEM 可被系统直接解析。
"""

from __future__ import annotations

import argparse
import json
import math
import random
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

PROJECT_ID = "POINTPROCESS-DEMO-FULL-20260905"
PROJECT_NAME = "车架疲劳台架试验 — 全要素演示项目"
EXPORT_ID = "DEMO-FULL-20260905-FULL-BACKUP"

TOTAL_RUNS = 10
CYCLE_STEP = 8000
ABNORMAL_AMPLITUDE_UE = 1300.0

CATEGORY_META = {
    "A": {"label": "稳定型", "desc": "应变基本不变，仅微量噪声"},
    "B": {"label": "规律变动型", "desc": "线性增长叠加正弦规律"},
    "C": {"label": "复杂变动型", "desc": "涨跌交替，偶发突变"},
    "D": {"label": "剧烈变动型", "desc": "大幅跳变，尖峰骤降"},
}

# 点位布局与 FEM 模型部件一一对应，便于对照"测点 ↔ CAE 模型"。
POINT_PLAN = [
    ("01", "A", "左纵梁", "left", "principal", "low"),
    ("02", "A", "右纵梁", "right", "principal", "low"),
    ("03", "B", "左纵梁", "left", "longitudinal", "medium"),
    ("04", "B", "右纵梁", "right", "longitudinal", "medium"),
    ("05", "C", "前横梁", "front", "transverse", "high"),
    ("06", "C", "中部横梁", "middle", "transverse", "high"),
    ("07", "D", "后横梁", "rear", "transverse", "critical"),
    ("08", "D", "焊缝加强板", "middle", "principal", "critical"),
]

TAGS_MAP = {
    "A": ["稳定区", "非关键点"],
    "B": ["规律变化", "疲劳监测"],
    "C": ["复杂变化", "CAE对应点", "需关注"],
    "D": ["剧烈变动", "危险点", "CAE对应点", "重点监控"],
}

CATEGORY_COLORS = {"A": "#dce7ea", "B": "#d4edda", "C": "#fff3cd", "D": "#f8d7da"}


# ═══════════════════════════════════════════════════════════════
#  SVG 图片生成（点位照片 / 裂缝照片）
# ═══════════════════════════════════════════════════════════════

def photo_svg(point_id: str, photo_type: str, category: str, component: str) -> bytes:
    color = CATEGORY_COLORS[category]
    label = "总览" if photo_type == "overview" else "细节"
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
<rect width="800" height="560" fill="{color}"/>
<rect x="60" y="80" width="680" height="360" rx="12" fill="#ffffff" opacity="0.9"/>
<line x1="60" y1="170" x2="740" y2="170" stroke="#9ab5bd" stroke-dasharray="6 4"/>
<line x1="60" y1="260" x2="740" y2="260" stroke="#9ab5bd" stroke-dasharray="6 4"/>
<line x1="60" y1="350" x2="740" y2="350" stroke="#9ab5bd" stroke-dasharray="6 4"/>
<circle cx="400" cy="260" r="64" fill="none" stroke="#c2504a" stroke-width="5"/>
<circle cx="400" cy="260" r="10" fill="#c2504a"/>
<text x="400" y="140" font-family="Arial" font-size="44" text-anchor="middle" fill="#172026">测点 {point_id} {label}照片</text>
<text x="400" y="480" font-family="Arial" font-size="26" text-anchor="middle" fill="#5f6f76">{component} · 类别 {category} · 演示数据</text>
</svg>""".encode("utf-8")


def crack_svg(point_id: str, cycle_count: int, seq: int) -> bytes:
    """生成带锯齿裂缝形态的示意图（随循环次数增加裂缝变长）。"""
    length = min(300, 120 + cycle_count // CYCLE_STEP * 20 + seq * 10)
    x0, y0 = 180, 300
    segments: list[str] = []
    random.seed(f"crack-{point_id}-{cycle_count}")
    x, y = x0, y0
    steps = 8
    for index in range(steps):
        x += length / steps
        y += random.randint(-26, 26)
        segments.append(f'L {x:.0f} {y:.0f}')
    path = f"M {x0} {y0} " + " ".join(segments)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560">
<rect width="800" height="560" fill="#e8e2d6"/>
<rect x="60" y="80" width="680" height="400" rx="10" fill="#cfd6da"/>
<line x1="60" y1="280" x2="740" y2="280" stroke="#aab6bc" stroke-width="2"/>
<line x1="120" y1="80" x2="120" y2="480" stroke="#aab6bc" stroke-width="2"/>
<path d="{path}" stroke="#7a1f1f" stroke-width="6" fill="none" stroke-linecap="round"/>
<circle cx="{x0}" cy="{y0}" r="10" fill="#7a1f1f"/>
<text x="400" y="60" font-family="Arial" font-size="34" text-anchor="middle" fill="#172026">测点 {point_id} 裂缝照片 — 循环 {cycle_count} 次</text>
<text x="400" y="530" font-family="Arial" font-size="22" text-anchor="middle" fill="#5f6f76">裂缝扩展观测（演示数据）</text>
</svg>""".encode("utf-8")


# ═══════════════════════════════════════════════════════════════
#  FEM 模型生成（OptiStruct/Nastran 格式，主文件 + INCLUDE 子文件）
# ═══════════════════════════════════════════════════════════════

def _card(name: str, *fields: object) -> str:
    return name.ljust(8) + "".join(str(field).rjust(8) for field in fields)


def _fmt(value: float) -> str:
    return f"{value:.1f}"


class _TubeBuilder:
    """沿轴向扫掠矩形截面管件，生成 GRID + CQUAD4（4 个面）。"""

    def __init__(self) -> None:
        self.next_node = 1
        self.next_elem = 1

    def build(
        self,
        stations: list[float],
        axis: str,
        center: float,
        width: float,
        z0: float,
        z1: float,
        pid: int,
    ) -> tuple[list[str], list[str]]:
        """返回 (grid 行, cquad4 行)。axis 为 "x" 或 "y"。"""
        grid_lines: list[str] = []
        elem_lines: list[str] = []
        corner_nodes: list[list[int]] = []
        for station in stations:
            ids: list[int] = []
            low, high = center - width / 2, center + width / 2
            for perp, z in ((low, z0), (high, z0), (high, z1), (low, z1)):
                if axis == "x":
                    coords = (station, perp, z)
                else:
                    coords = (perp, station, z)
                grid_lines.append(_card("GRID", self.next_node, "", _fmt(coords[0]), _fmt(coords[1]), _fmt(coords[2])))
                ids.append(self.next_node)
                self.next_node += 1
            corner_nodes.append(ids)
        for index in range(len(stations) - 1):
            a, b = corner_nodes[index], corner_nodes[index + 1]
            for c1, c2 in ((0, 1), (1, 2), (2, 3), (3, 0)):
                elem_lines.append(_card("CQUAD4", self.next_elem, pid, a[c1], a[c2], b[c2], b[c1]))
                self.next_elem += 1
        return grid_lines, elem_lines


def build_fem_source_files() -> dict[str, str]:
    """生成 FEM 源文件文本：frame_assembly.fem（主） + parts/rails.fem（INCLUDE）。"""
    builder = _TubeBuilder()

    # 纵梁：沿 X 方向，截面 60×80，位于 y=±160
    rail_stations = [float(-600 + 120 * i) for i in range(11)]
    left_grids, left_elems = builder.build(rail_stations, "x", 160.0, 60.0, 0.0, 80.0, pid=1)
    right_grids, right_elems = builder.build(rail_stations, "x", -160.0, 60.0, 0.0, 80.0, pid=2)

    # 横梁：沿 Y 方向连接两纵梁内壁（y=-130..130），截面 50×60
    cross_stations = [-130.0, -65.0, 0.0, 65.0, 130.0]
    cross_defs: list[tuple[str, int, str, list[str], list[str]]] = []
    for comp_id, comp_name, hw_color, x_center, pid in (
        (3, "前横梁", 3, -300.0, 3),
        (4, "中部横梁", 4, 0.0, 4),
        (5, "后横梁", 2, 300.0, 5),
    ):
        grids, elems = builder.build(cross_stations, "y", x_center, 50.0, 0.0, 60.0, pid=pid)
        cross_defs.append((comp_name, comp_id, hw_color, grids, elems))

    # 焊缝加强板：前/后横梁与纵梁交接处的竖直加强板
    gusset_grids: list[str] = []
    gusset_elems: list[str] = []
    for x_center in (-300.0, 300.0):
        for y_center in (160.0, -160.0):
            ids = []
            for perp_y, z in ((y_center - 30, 0.0), (y_center + 30, 0.0), (y_center + 30, 80.0), (y_center - 30, 80.0)):
                gusset_grids.append(_card("GRID", builder.next_node, "", _fmt(x_center), _fmt(perp_y), _fmt(z)))
                ids.append(builder.next_node)
                builder.next_node += 1
            gusset_elems.append(_card("CQUAD4", builder.next_elem, 0, *ids))
            builder.next_elem += 1

    rails_deck = "\n".join(
        [
            "$$ 纵梁子文件（由 frame_assembly.fem INCLUDE）",
            '$HMNAME COMP 1 "左纵梁"',
            "$HWCOLOR COMP 1 5",
            "$HMCOMP ID 1",
            *left_grids,
            *left_elems,
            '$HMNAME COMP 2 "右纵梁"',
            "$HWCOLOR COMP 2 1",
            "$HMCOMP ID 2",
            *right_grids,
            *right_elems,
            "",
        ]
    )

    main_sections: list[str] = [
        "$$ ==================================================",
        "$$ PointProcess 全要素演示 — 车架疲劳台架 FEM 模型",
        "$$ 单位: mm / N / MPa   生成: scripts/create_full_sample.py",
        "$$ ==================================================",
        "BEGIN BULK",
        "$",
        "$$ ---- 材料: 普通钢材 ----",
        _card("MAT1", 1, "2.06+5", "7.91+4", ".3", "7.85-9"),
        "$",
        "$$ ---- 属性 ----",
        _card("PSHELL", 1, 1, "3.0"),
        _card("PSHELL", 2, 1, "3.0"),
        _card("PSHELL", 3, 1, "4.0"),
        _card("PSHELL", 4, 1, "4.0"),
        _card("PSHELL", 5, 1, "4.0"),
        _card("PSHELL", 6, 1, "5.0"),
        "$",
        "$$ ---- 纵梁（INCLUDE 子文件，部件 1/2）----",
        "INCLUDE parts/rails.fem",
        "$",
    ]
    for comp_name, comp_id, hw_color, grids, elems in cross_defs:
        main_sections.extend(
            [
                f"$$ ---- {comp_name} ----",
                f'$HMNAME COMP {comp_id} "{comp_name}"',
                f"$HWCOLOR COMP {comp_id} {hw_color}",
                f"$HMCOMP ID {comp_id}",
                *grids,
                *elems,
                "$",
            ]
        )
    main_sections.extend(
        [
            "$$ ---- 焊缝加强板 ----",
            '$HMNAME COMP 6 "焊缝加强板"',
            "$HWCOLOR COMP 6 6",
            "$HMCOMP ID 6",
            *gusset_grids,
            *gusset_elems,
            "",
            "ENDDATA",
            "",
        ]
    )
    return {
        "frame_assembly.fem": "\n".join(main_sections),
        "parts/rails.fem": rails_deck,
    }


def validate_fem_source(source_dir: Path) -> dict[str, int]:
    """用后端解析器实际解析生成的 FEM，确保随包模型可被系统导入。"""
    from app.services.fem.parser import FemModelProvider

    main_path = source_dir / "frame_assembly.fem"
    model = FemModelProvider(main_path, include_root=source_dir).load()
    stats = {
        "node_count": len(model.nodes),
        "element_count": len(model.elements),
        "component_count": len(model.components),
        "included_files": len(model.metadata.get("included_files", [])),
    }
    if stats["node_count"] == 0 or stats["element_count"] == 0:
        raise RuntimeError(f"FEM 校验失败：模型为空 {stats}")
    if not model.metadata.get("element_component_ids"):
        raise RuntimeError("FEM 校验失败：部件分组信息缺失（$HMCOMP 块未被识别）")
    if stats["included_files"] != 1:
        raise RuntimeError(f"FEM 校验失败：INCLUDE 子文件未正确加载 {model.metadata.get('included_files')}")
    return stats


# ═══════════════════════════════════════════════════════════════
#  测量数据生成（四类行为模式）
# ═══════════════════════════════════════════════════════════════

def _strain_for(category: str, point_seq: int, run_index: int, total_runs: int) -> tuple[float, float]:
    progress = run_index / total_runs
    base_amplitude = 120.0 + point_seq * 90.0
    if category == "A":
        base = 85.0 + point_seq * 11.0
        noise = random.gauss(0, 1.5)
        return round(base + noise, 2), round(base - 6.0 + noise, 2)
    if category == "B":
        amplitude = base_amplitude * (1.0 + progress * 0.35)
        amplitude += math.sin(progress * math.pi * 2.5) * base_amplitude * 0.06
        mean = 10.0 + point_seq * 2.0 + run_index * 2.0
        return round(mean + amplitude, 2), round(mean - amplitude, 2)
    if category == "C":
        trend = 1.0 + 0.3 * math.sin(progress * math.pi * 1.8)
        mid = 0.12 * math.sin(progress * math.pi * 4.5)
        spike = 0.0
        if run_index == 3:
            spike = base_amplitude * 0.28
        elif run_index == 7:
            spike = -base_amplitude * 0.22
        amplitude = base_amplitude * (trend + mid) + spike
        mean = 10.0 + point_seq * 2.0 + run_index * 0.8
        return round(mean + abs(amplitude), 2), round(mean - abs(amplitude), 2)
    # D: 剧烈变动
    amp_mult = 1.0 + 0.6 * math.sin(progress * math.pi * 1.3)
    spikes = {2: 0.55, 5: 0.70, 8: -0.45, 9: 0.85}
    spike = base_amplitude * spikes.get(run_index, 0.0)
    jitter = random.gauss(0, base_amplitude * 0.08)
    amplitude = max(base_amplitude * amp_mult + spike + jitter, base_amplitude * 0.3)
    mean = 10.0 + point_seq * 3.0 + run_index * 0.5 + 12.0 * math.sin(progress * math.pi * 3.0)
    return round(mean + abs(amplitude), 2), round(mean - abs(amplitude), 2)


# ═══════════════════════════════════════════════════════════════
#  数据组装
# ═══════════════════════════════════════════════════════════════

def build_dataset(now: str, start_time: datetime) -> dict[str, Any]:
    random.seed(20260905)
    points: list[dict[str, Any]] = []
    package_files: dict[str, bytes] = {}

    for point_seq, (point_id, category, component, side, direction, danger) in enumerate(POINT_PLAN, start=1):
        meta = CATEGORY_META[category]
        photos = []
        for photo_seq, photo_type in enumerate(("overview", "detail"), start=1):
            photo_path = f"photos/{point_id}/{point_id}_{photo_type}_001.svg"
            package_files[photo_path] = photo_svg(point_id, photo_type, category, component)
            photos.append(
                {
                    "photo_id": f"P-{point_id}-00{photo_seq}",
                    "type": photo_type,
                    "path": photo_path,
                    "filename": Path(photo_path).name,
                    "taken_time": now,
                    "sha256": "",
                    "remark": "总览图" if photo_type == "overview" else "细节图",
                }
            )
        points.append(
            {
                "point_id": point_id,
                "point_name": f"车架疲劳测点 {point_id}（{meta['label']}）",
                "point_type": "strain_gauge",
                "component": component,
                "side": side,
                "position_description": f"{component} — {meta['desc']}，{side} 侧 {direction} 方向贴片",
                "direction": direction,
                "bridge_type": "1/4_bridge" if point_seq % 2 else "1/2_bridge",
                "resistance_ohm": round(120.0 + point_seq * 0.08, 2),
                "install_status": "installed",
                "check_status": "checked",
                "category": category,
                "danger": danger,
                "photos": photos,
            }
        )

    runs: list[dict[str, Any]] = []
    measurement_id = 0
    for run_index in range(TOTAL_RUNS):
        cycle_count = (run_index + 1) * CYCLE_STEP
        test_time = (start_time + timedelta(hours=run_index * 2)).isoformat()
        measurements = []
        for point in points:
            measurement_id += 1
            point_seq = int(point["point_id"])
            category = point["category"]
            max_strain, min_strain = _strain_for(category, point_seq, run_index, TOTAL_RUNS)
            amplitude = round((max_strain - min_strain) / 2, 2)
            is_abnormal = amplitude > ABNORMAL_AMPLITUDE_UE
            reason = f"应变幅 {amplitude} με 超过阈值 {ABNORMAL_AMPLITUDE_UE:.0f} με" if is_abnormal else None
            measurements.append(
                {
                    "id": measurement_id,
                    "point_id": point["point_id"],
                    "max_strain_ue": max_strain,
                    "min_strain_ue": min_strain,
                    "mean_strain_ue": round((max_strain + min_strain) / 2, 2),
                    "amplitude_strain_ue": amplitude,
                    "range_strain_ue": round(max_strain - min_strain, 2),
                    "is_abnormal": is_abnormal,
                    "abnormal_reason": reason,
                    "remark": f"类别{category}-{CATEGORY_META[category]['label']}",
                }
            )
        runs.append(
            {
                "id": run_index + 1,
                "run_name": f"RUN-{run_index + 1:02d}",
                "cycle_count": cycle_count,
                "test_time": test_time,
                "remark": f"第 {run_index + 1} 轮台架疲劳加载",
                "measurements": measurements,
            }
        )

    # 人工标注异常：测点 05 在第 7 轮疑似裂纹扩展
    run7 = runs[6]
    for measurement in run7["measurements"]:
        if measurement["point_id"] == "05":
            measurement["is_abnormal"] = True
            measurement["abnormal_reason"] = "人工复核：应变幅突增，疑似裂纹扩展"

    # 裂缝记录：测点 05-08 在第 4/7/10 轮各一条
    crack_records: list[dict[str, Any]] = []
    crack_id = 0
    for run_index in (3, 6, 9):
        run = runs[run_index]
        for point in points:
            if point["point_id"] < "05":
                continue
            crack_id += 1
            cycle_count = run["cycle_count"]
            path = f"cracks/{point['point_id']}/{point['point_id']}_cycle_{cycle_count}_001.svg"
            package_files[path] = crack_svg(point["point_id"], cycle_count, crack_id)
            crack_records.append(
                {
                    "id": crack_id,
                    "point_id": point["point_id"],
                    "test_run_id": run["id"],
                    "run_cycle_count": cycle_count,
                    "cycle_count": cycle_count,
                    "path": path,
                    "filename": Path(path).name,
                    "original_filename": Path(path).name,
                    "content_type": "image/svg+xml",
                    "sha256": "",
                    "remark": f"裂缝观测：{CATEGORY_META[point['category']]['label']}点位",
                }
            )

    # Dewesoft 导入记录：第 1 轮与第 10 轮
    dewesoft_imports: list[dict[str, Any]] = []
    for dewe_seq, run_index in ((0, 0), (1, TOTAL_RUNS - 1)):
        run = runs[run_index]
        data_path = f"dewesoft/{run['run_name']}_frame.dat"
        channel_names = [point["point_id"] for point in points] + ["TEMP-01"]
        package_files[data_path] = (
            "$$ PointProcess 示例 Dewesoft 导出数据（占位内容）\n"
            f"$$ run: {run['run_name']}  cycle: {run['cycle_count']}\n"
            f"$$ channels: {','.join(channel_names)}\n"
            "$$ ...\n"
        ).encode("utf-8")
        measurement_by_point = {m["point_id"]: m for m in run["measurements"]}
        channels = []
        for point in points:
            measurement = measurement_by_point[point["point_id"]]
            channels.append(
                {
                    "id": len(channels) + 1,
                    "channel_name": point["point_id"],
                    "unit": "ue",
                    "sample_count": 60000,
                    "matched_point_id": point["point_id"],
                    "measurement_id": measurement["id"],
                    "stable_min_strain_ue": measurement["min_strain_ue"],
                    "stable_max_strain_ue": measurement["max_strain_ue"],
                    "stable_mean_strain_ue": measurement["mean_strain_ue"],
                    "raw_json": json.dumps({"device": "Dewesoft", "demo": True}, ensure_ascii=False),
                }
            )
        channels.append(
            {
                "id": len(channels) + 1,
                "channel_name": "TEMP-01",
                "unit": "degC",
                "sample_count": 60000,
                "matched_point_id": None,
                "measurement_id": None,
                "stable_min_strain_ue": None,
                "stable_max_strain_ue": None,
                "stable_mean_strain_ue": None,
                "raw_json": None,
            }
        )
        dewesoft_imports.append(
            {
                "id": dewe_seq + 1,
                "test_run_id": run["id"],
                "cycle_count": run["cycle_count"],
                "run_name": run["run_name"],
                "filename": Path(data_path).name,
                "path": data_path,
                "status": "imported",
                "message": None,
                "duration_seconds": 62.5,
                "stable_start_seconds": 10.0,
                "stable_end_seconds": 55.0,
                "matched_channel_count": len(points),
                "unmatched_channel_count": 1,
                "raw_metadata_json": json.dumps(
                    {"device": "Dewesoft", "sample_rate_hz": 1200, "demo": True}, ensure_ascii=False
                ),
                "channels": channels,
            }
        )

    return {
        "points": points,
        "runs": runs,
        "crack_records": crack_records,
        "dewesoft_imports": dewesoft_imports,
        "package_files": package_files,
    }


# ═══════════════════════════════════════════════════════════════
#  manifest.json / pointprocess_backup.json / records.xlsx
# ═══════════════════════════════════════════════════════════════

def build_manifest(dataset: dict[str, Any], now: str, fem_stats: dict[str, int]) -> dict[str, Any]:
    manifest_points = []
    for point in dataset["points"]:
        manifest_points.append(
            {
                "point_id": point["point_id"],
                "point_name": point["point_name"],
                "point_type": point["point_type"],
                "component": point["component"],
                "side": point["side"],
                "position_description": point["position_description"],
                "direction": point["direction"],
                "bridge_type": point["bridge_type"],
                "resistance_ohm": point["resistance_ohm"],
                "install_status": point["install_status"],
                "check_status": point["check_status"],
                "channel": {
                    "device": "Dewesoft",
                    "channel_name": point["point_id"],
                    "unit": "ue",
                    "sample_rate_hz": 1200.0,
                    "remark": f"Category {point['category']} — {CATEGORY_META[point['category']]['label']}",
                },
                "cae_mapping": {
                    "cae_point_id": f"CAE_{point['point_id']}",
                    "cae_component": point["component"],
                    "cae_result_type": "strain",
                    "danger_level": point["danger"],
                    "remark": CATEGORY_META[point["category"]]["desc"],
                },
                "photos": [
                    {
                        "photo_id": photo["photo_id"],
                        "type": photo["type"],
                        "path": photo["path"],
                        "filename": photo["filename"],
                        "taken_time": photo["taken_time"],
                        "sha256": photo["sha256"],
                        "remark": photo["remark"],
                    }
                    for photo in point["photos"]
                ],
                "tags": TAGS_MAP[point["category"]],
                "remark": f"类别{point['category']} — {CATEGORY_META[point['category']]['desc']}",
                "created_time": now,
                "updated_time": now,
                "custom_fields": {"behavior_category": point["category"]},
            }
        )
    return {
        "schema_version": "1.0.0",
        "export_info": {
            "export_id": EXPORT_ID,
            "export_time": now,
            "app_name": "PointProcess Web",
            "app_version": "1.0",
            "device_name": "Demo Generator",
            "operator": "Lee Chao",
            "remark": "PointProcess 全要素演示数据包（点位 + 测量数据 + 裂缝 + Dewesoft + FEM）",
        },
        "project": {
            "project_id": PROJECT_ID,
            "project_name": PROJECT_NAME,
            "test_object": "车架",
            "test_type": "疲劳试验",
            "department": "整车试验部",
            "vehicle_or_product": "非公路工程车辆车架",
            "test_stage": "全要素演示验证",
            "description": (
                "演示项目：包含 8 个点位（4 类行为模式）、10 轮测量数据、12 条裂缝记录、"
                "2 条 Dewesoft 导入记录以及带 INCLUDE 子文件与部件分组的 FEM 模型，"
                "可通过完整备份导入一次性恢复全部内容。"
            ),
            "created_time": now,
            "updated_time": now,
        },
        "points": manifest_points,
        "files": [
            {
                "file_id": "POINTPROCESS-RECORDS-XLSX",
                "type": "analysis_workbook",
                "path": "records.xlsx",
                "filename": "records.xlsx",
                "sha256": "",
                "remark": "演示记录工作簿",
            },
            {
                "file_id": "POINTPROCESS-FEM-MODEL",
                "type": "fem_model",
                "path": "fem",
                "filename": "fem",
                "sha256": "",
                "remark": "项目 FEM 模型源文件（导入时自动解析渲染）",
            },
        ],
        "custom_fields": {"pointprocess_backup": "pointprocess_backup.json"},
    }


def build_backup(
    dataset: dict[str, Any],
    manifest: dict[str, Any],
    now: str,
    fem_stats: dict[str, int],
) -> dict[str, Any]:
    manifest_point_by_id = {point["point_id"]: point for point in manifest["points"]}
    backup_points = []
    for point_seq, point in enumerate(dataset["points"], start=1):
        manifest_point = manifest_point_by_id[point["point_id"]]
        backup_points.append(
            {
                "id": point_seq,
                "point_id": point["point_id"],
                "point_name": point["point_name"],
                "point_type": point["point_type"],
                "component": point["component"],
                "side": point["side"],
                "position_description": point["position_description"],
                "direction": point["direction"],
                "bridge_type": point["bridge_type"],
                "resistance_ohm": point["resistance_ohm"],
                "install_status": point["install_status"],
                "check_status": point["check_status"],
                "remark": manifest_point["remark"],
                "raw_json": json.dumps(manifest_point, ensure_ascii=False),
                "created_at": now,
                "updated_at": now,
                "channel": manifest_point["channel"],
                "cae_mapping": manifest_point["cae_mapping"],
                "photos": [
                    {
                        "id": point_seq * 10 + photo_seq,
                        "photo_id": photo["photo_id"],
                        "type": photo["type"],
                        "path": photo["path"],
                        "original_path": photo["path"],
                        "filename": photo["filename"],
                        "original_filename": photo["filename"],
                        "taken_time": photo["taken_time"],
                        "sha256": "",
                        "remark": photo["remark"],
                    }
                    for photo_seq, photo in enumerate(point["photos"])
                ],
            }
        )

    return {
        "format": "pointprocess_project_backup",
        "version": "1.0",
        "export_id": EXPORT_ID,
        "exported_at": now,
        "project": {
            "id": 1,
            "project_id": PROJECT_ID,
            "project_name": PROJECT_NAME,
            "test_object": "车架",
            "test_type": "疲劳试验",
            "department": "整车试验部",
            "vehicle_or_product": "非公路工程车辆车架",
            "test_stage": "全要素演示验证",
            "description": manifest["project"]["description"],
            "source_export_id": None,
            "source_export_time": None,
            "raw_manifest_json": json.dumps(manifest, ensure_ascii=False),
            "created_at": now,
            "updated_at": now,
        },
        "points": backup_points,
        "test_runs": [
            {
                "id": run["id"],
                "run_name": run["run_name"],
                "cycle_count": run["cycle_count"],
                "test_time": run["test_time"],
                "remark": run["remark"],
                "created_at": now,
                "measurements": [
                    {
                        "id": measurement["id"],
                        "point_id": measurement["point_id"],
                        "max_strain_ue": measurement["max_strain_ue"],
                        "min_strain_ue": measurement["min_strain_ue"],
                        "mean_strain_ue": measurement["mean_strain_ue"],
                        "amplitude_strain_ue": measurement["amplitude_strain_ue"],
                        "range_strain_ue": measurement["range_strain_ue"],
                        "is_abnormal": measurement["is_abnormal"],
                        "abnormal_reason": measurement["abnormal_reason"],
                        "remark": measurement["remark"],
                        "created_at": now,
                        "updated_at": now,
                    }
                    for measurement in run["measurements"]
                ],
            }
            for run in dataset["runs"]
        ],
        "crack_records": dataset["crack_records"],
        "dewesoft_imports": dataset["dewesoft_imports"],
        "fem_model": {
            "main_filename": "frame_assembly.fem",
            "source_name": "frame_assembly.fem",
            "node_count": fem_stats["node_count"],
            "element_count": fem_stats["element_count"],
            "triangle_count": fem_stats["element_count"] * 2,
            "status": "ready",
            "error_message": None,
            "artifact_version": None,
        },
    }


def build_records_xlsx(dataset: dict[str, Any], manifest: dict[str, Any]) -> bytes:
    import io

    from openpyxl import Workbook

    wb = Workbook()
    summary = wb.active
    summary.title = "项目概览"
    summary.append(["字段", "值"])
    project = manifest["project"]
    for key, label in (
        ("project_id", "项目ID"),
        ("project_name", "项目名称"),
        ("test_object", "测试对象"),
        ("test_type", "试验类型"),
        ("department", "部门"),
        ("vehicle_or_product", "产品/车型"),
        ("test_stage", "试验阶段"),
    ):
        summary.append([label, project[key]])
    summary.append(["点位数量", len(dataset["points"])])
    summary.append(["测试轮次数量", len(dataset["runs"])])
    summary.append(["裂缝记录数量", len(dataset["crack_records"])])

    point_sheet = wb.create_sheet("点位清单")
    point_sheet.append(["点位编号", "点位名称", "类型", "部件", "方位", "位置描述", "方向", "桥路", "电阻", "安装状态", "检查状态", "备注"])
    for point in manifest["points"]:
        point_sheet.append(
            [
                point["point_id"], point["point_name"], point["point_type"], point["component"],
                point["side"], point["position_description"], point["direction"], point["bridge_type"],
                point["resistance_ohm"], point["install_status"], point["check_status"], point["remark"],
            ]
        )

    crack_sheet = wb.create_sheet("裂缝照片")
    crack_sheet.append(["点位编号", "循环次数", "轮次", "导出路径", "备注"])
    for crack in dataset["crack_records"]:
        crack_sheet.append([crack["point_id"], crack["cycle_count"], f"RUN-{crack['test_run_id']:02d}", crack["path"], crack["remark"]])

    stress_sheet = wb.create_sheet("应力变化情况")
    stress_sheet.append(["点位编号", "点位名称", "部件", "方向"] + [f"{run['cycle_count']}次应力幅(MPa)" for run in dataset["runs"]])
    modulus = 206000.0
    for point in manifest["points"]:
        values = []
        for run in dataset["runs"]:
            measurement = next(m for m in run["measurements"] if m["point_id"] == point["point_id"])
            values.append(round(measurement["amplitude_strain_ue"] * modulus / 1e6, 2))
        stress_sheet.append([point["point_id"], point["point_name"], point["component"], point["direction"], *values])

    for run in dataset["runs"]:
        sheet = wb.create_sheet(str(run["cycle_count"]))
        sheet.append(["点位编号", "点位名称", "最大应变(ue)", "最小应变(ue)", "应变幅(ue)", "应变范围(ue)", "应力幅(MPa)", "是否异常", "异常原因"])
        for measurement in run["measurements"]:
            point = next(p for p in manifest["points"] if p["point_id"] == measurement["point_id"])
            sheet.append(
                [
                    measurement["point_id"], point["point_name"],
                    measurement["max_strain_ue"], measurement["min_strain_ue"],
                    measurement["amplitude_strain_ue"], measurement["range_strain_ue"],
                    round(measurement["amplitude_strain_ue"] * modulus / 1e6, 2),
                    measurement["is_abnormal"], measurement["abnormal_reason"],
                ]
            )

    buffer = io.BytesIO()
    wb.save(buffer)
    return buffer.getvalue()


# ═══════════════════════════════════════════════════════════════
#  打包
# ═══════════════════════════════════════════════════════════════

def main() -> None:
    parser = argparse.ArgumentParser(description="生成 PointProcess 全要素演示数据包")
    parser.add_argument("--out", default=str(ROOT / "sample_data"), help="输出目录（默认 sample_data/）")
    parser.add_argument("--seed", type=int, default=20260905, help="随机种子")
    args = parser.parse_args()
    random.seed(args.seed)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    tz = timezone(timedelta(hours=8))
    now_dt = datetime(2026, 9, 5, 10, 0, tzinfo=tz)
    now = now_dt.isoformat()
    start_time = now_dt

    dataset = build_dataset(now, start_time)

    # FEM 源文件：生成后立即用后端解析器校验，确保可被系统导入
    fem_files = build_fem_source_files()
    staging = out_dir / ".fem_validate_tmp"
    source_dir = staging / "parts"
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "frame_assembly.fem").write_text(fem_files["frame_assembly.fem"], encoding="utf-8")
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "rails.fem").write_text(fem_files["parts/rails.fem"], encoding="utf-8")
    try:
        fem_stats = validate_fem_source(staging)
    finally:
        import shutil

        shutil.rmtree(staging, ignore_errors=True)
    print(f"FEM 校验通过: {fem_stats}")
    for relative, text in fem_files.items():
        dataset["package_files"][f"fem/source/{relative}"] = text.encode("utf-8")

    manifest = build_manifest(dataset, now, fem_stats)
    backup = build_backup(dataset, manifest, now, fem_stats)
    dataset["package_files"]["records.xlsx"] = build_records_xlsx(dataset, manifest)
    dataset["package_files"]["raw/readme.txt"] = "示例原始数据目录（演示数据）\n".encode("utf-8")
    dataset["package_files"]["attachments/试验大纲.txt"] = (
        "车架疲劳台架试验大纲（演示数据）\n\n"
        "1. 加载波形：正弦波，频率 5 Hz\n"
        "2. 目标循环次数：80,000 次\n"
        "3. 数据采集：Dewesoft，采样率 1200 Hz\n"
        "4. 每 8,000 次循环记录一轮应变极值并巡检裂缝\n"
    ).encode("utf-8")

    zip_path = out_dir / "POINTPROCESS_DEMO_FULL_20260905.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        package.writestr("pointprocess_backup.json", json.dumps(backup, ensure_ascii=False, indent=2))
        for relative, content in sorted(dataset["package_files"].items()):
            package.writestr(relative, content)

    summary = {
        "zip_path": str(zip_path),
        "project_id": PROJECT_ID,
        "point_count": len(dataset["points"]),
        "photo_count": sum(len(point["photos"]) for point in dataset["points"]),
        "test_run_count": len(dataset["runs"]),
        "measurement_count": sum(len(run["measurements"]) for run in dataset["runs"]),
        "abnormal_measurement_count": sum(
            1 for run in dataset["runs"] for m in run["measurements"] if m["is_abnormal"]
        ),
        "crack_record_count": len(dataset["crack_records"]),
        "dewesoft_import_count": len(dataset["dewesoft_imports"]),
        "dewesoft_channel_count": sum(len(item["channels"]) for item in dataset["dewesoft_imports"]),
        "fem_stats": fem_stats,
        "package_file_count": 2 + len(dataset["package_files"]),
        "zip_size_bytes": zip_path.stat().st_size,
        "coverage": [
            "project create/list/detail via full backup import",
            "8 points with channels, CAE mappings, photos and tags",
            "10 fatigue runs and 80 measurement records (4 behavior patterns)",
            "manual and threshold-based abnormal measurement cases",
            "12 crack timeline records linked to points and runs",
            "2 Dewesoft import records with matched/unmatched channels",
            "raw/ and attachments/ folder copy",
            "FEM model with INCLUDE sub-file and HyperMesh component grouping",
        ],
        "import_guide": "系统内选择 导入 → 上传该 zip → 预览 → 确认导入，即可一次性恢复全部内容（含 FEM 模型）",
    }
    summary_path = out_dir / "POINTPROCESS_DEMO_FULL_20260905_summary.json"
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"ZIP     → {zip_path}")
    print(f"SUMMARY → {summary_path}")
    print(
        f"点位 {summary['point_count']} | 照片 {summary['photo_count']} | 轮次 {summary['test_run_count']} "
        f"| 测量 {summary['measurement_count']}（异常 {summary['abnormal_measurement_count']}）"
        f"| 裂缝 {summary['crack_record_count']} | Dewesoft {summary['dewesoft_import_count']}"
    )


if __name__ == "__main__":
    main()
