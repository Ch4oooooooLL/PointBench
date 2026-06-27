# 实验点位数据管理与分析 Web 系统

本项目用于导入 Android 点位记录 App 导出的 zip 数据包，解析 `manifest.json`，管理实验点位照片和通道信息，并录入后续疲劳试验测量数据，完成基础应变 / 应力分析与异常标记。

## 技术栈

| 层级   | 技术                                       |
| ------ | ------------------------------------------ |
| 后端   | FastAPI + SQLite + SQLAlchemy + Pydantic   |
| 前端   | React + TypeScript + ECharts + 普通 CSS    |

---

## 快速开始

### 1. 运行后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

后端默认地址：`http://127.0.0.1:8000`，API 文档：`http://127.0.0.1:8000/docs`

### 2. 运行前端

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://127.0.0.1:5173`

### 3. 生成示例数据

```bash
python scripts/create_sample_zip.py
```

输出文件：

| 文件 | 说明 |
| ---- | ---- |
| `sample_data/FRAME-FATIGUE-202606_10points_export.zip` | 10 点位示例 zip 包 |
| `sample_data/FRAME-FATIGUE-202606_10runs_measurements.csv` | 10 次测试的 CSV 测量数据 |

> **注意**：CSV 测试数据导入是调试功能。进入页面左下角「设置」，开启「Debug 模式」后，项目概览页面会显示「Debug CSV 测试数据导入」工具。
>
> CSV 表头格式：`run_name,cycle_count,test_time,point_id,max_strain_ue,min_strain_ue,remark`

---

## 核心功能

### 测试数据导入

项目概览页面点击「录入测试数据」后，支持三种导入方式：

| 方式 | 适用场景 | 输入内容 |
| ---- | -------- | -------- |
| 手动录入 | 少量数据或临时补录 | 逐点填写最大 / 最小应变 |
| XLSX 模板导入 | 批量点位、多个循环次数 | 下载模板 → 填写 → 上传 |
| Dewesoft 数据 | 从采集设备自动提取 | 原始文件或导出 CSV/TXT |

**XLSX 模板表头：**

```text
run_name,cycle_count,test_time,point_id,point_name,max_strain_ue,min_strain_ue,remark
```

### Dewesoft 数据导入详解

支持上传 `.dxd` / `.dxz` / `.d7d` / `.d7z` 原始文件，或 Dewesoft 导出的 `.csv` / `.txt` 文件，并填写本次导入对应的循环次数。

**处理规则：**

1. 通道名统一使用 `两位数字-点位名称` 格式，如 `01-左纵梁前段`。
2. 匹配时只使用开头两位数字（如 `01` 匹配系统点位 `01`），后续点位名称不参与匹配。
3. 读取文件总时长，取中间 1/10 作为稳定数据段。
4. 在稳定段内计算每个通道的最大应变、最小应变、平均应变。
5. 匹配到系统点位的通道写入 `measurement_records`，并复用已有应力换算与趋势 / 异常算法。
6. 未匹配但符合 `两位数字-点位名称` 格式的通道自动新增点位，并在前端弹窗提醒补充信息。
7. 其余未匹配通道也会保存，可在「Dewesoft 导入记录」页面查看。

**CSV / TXT 解析规则：**

- 自动识别逗号、分号、Tab 分隔符。
- 自动识别 `time` / `timestamp` 等时间列。
- 支持第二行单位行（如 `s,ue,ue`）。
- 支持表头中带单位（如 `01-左纵梁前段 [ue]`）。
- 其余数值列按通道处理，通道名开头两位数字与系统点位编号一致时自动匹配。

> **依赖说明**：原始文件解析依赖 `dwdatareader`，需要本机可加载 Dewesoft 官方 `DWDataReaderLib` 动态库。没有真实 Dewesoft 文件或缺少官方运行库时，导入记录会保存失败原因。

---

## 技术细节

### Manifest 校验

导入预览接口 `POST /api/import/preview` 按 `TEST_POINT_MANIFEST_SPEC.md` 完成以下校验：

| 序号 | 校验项 | 说明 |
| ---- | ------ | ---- |
| 1 | zip 可读取性 | 检查 `manifest.json` 是否存在 |
| 2 | 路径安全性 | 拒绝 `../`、`..\`、绝对路径等路径穿越 |
| 3 | JSON 合法性 | `manifest.json` 必须为 UTF-8 编码且 JSON 合法 |
| 4 | 结构校验 | Pydantic 模型校验顶层结构、必填字段、点位、照片、通道、CAE 映射 |
| 5 | 版本检查 | `schema_version == "1.0.0"` |
| 6 | 唯一性检查 | 项目 ID、项目名称、点位编号唯一性 |
| 7 | 文件存在性 | 检查 `photos[].path` 是否存在于 zip 中 |
| 8 | 重复检测 | 重复通道名、重复照片 ID、重复文件 ID，返回警告或错误 |
| 9 | 两阶段导入 | 预览阶段不写入；只有 `POST /api/import/confirm` 才创建正式记录 |

### 应变 / 应力计算

录入 `max_strain_ue` 和 `min_strain_ue` 后，后端自动计算：

| 指标 | 公式 |
| ---- | ---- |
| 平均应变 `mean_strain_ue` | `(max_strain_ue + min_strain_ue) / 2` |
| 应变幅 `amplitude_strain_ue` | `(max_strain_ue - min_strain_ue) / 2` |
| 应变范围 `range_strain_ue` | `max_strain_ue - min_strain_ue` |
| 应力 `stress_mpa` | `0.206 × strain_ue` |

### 异常规则

| 规则 | 触发条件 |
| ---- | -------- |
| 增幅异常 | 当前点位应变幅相对上一轮增长超过 20% |
| 趋势异常 | 当前点位连续 3 次应变幅上升 |
| 空值处理 | 最大 / 最小应变为空时不参与判断 |
| 手动覆盖 | 用户手动标记异常时保留人工标记原因 |

---

## API 接口一览

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/import/preview` | 导入预览 |
| `POST` | `/api/import/confirm` | 确认导入 |
| `GET` | `/api/projects` | 项目列表 |
| `GET` | `/api/projects/{id}` | 项目详情 |
| `DELETE` | `/api/projects/{id}` | 删除项目 |
| `GET` | `/api/projects/{id}/points` | 项目点位列表 |
| `GET` | `/api/points/{id}` | 点位详情 |
| `PUT` | `/api/points/{id}` | 更新点位 |
| `GET` | `/api/media/{id}` | 获取媒体文件 |
| `POST` | `/api/projects/{id}/test-runs` | 创建测试轮次 |
| `GET` | `/api/projects/{id}/test-runs` | 测试轮次列表 |
| `GET` | `/api/test-runs/{id}` | 测试轮次详情 |
| `DELETE` | `/api/test-runs/{id}` | 删除测试轮次 |
| `POST` | `/api/test-runs/{id}/measurements` | 创建测量记录 |
| `GET` | `/api/test-runs/{id}/measurements` | 测量记录列表 |
| `GET` | `/api/points/{id}/measurements` | 点位测量记录 |
| `PUT` | `/api/measurements/{id}` | 更新测量记录 |
| `DELETE` | `/api/measurements/{id}` | 删除测量记录 |
| `GET` | `/api/points/{id}/trend` | 点位趋势数据 |
| `GET` | `/api/projects/{id}/analysis/abnormal-points` | 异常点位分析 |
| `GET` | `/api/projects/{id}/analysis/summary` | 项目分析摘要 |
| `GET` | `/api/projects/{id}/export.json` | 导出 JSON |
| `GET` | `/api/projects/{id}/export.csv` | 导出 CSV |
