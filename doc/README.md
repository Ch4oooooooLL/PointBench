# 实验点位数据管理与分析 Web 系统

本项目用于导入 Android 点位记录 App 导出的 zip 数据包，解析 `manifest.json`，管理实验点位照片和通道信息，并录入后续疲劳试验测量数据，完成基础应变 / 应力分析与异常标记。

## 技术栈

- 后端：FastAPI + SQLite + SQLAlchemy + Pydantic
- 前端：React + TypeScript + ECharts + 普通 CSS

## 运行后端

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## 运行前端

```bash
cd frontend
npm install
npm run dev
```

前端默认地址：`http://127.0.0.1:5173`

## 示例 zip

生成符合 `TEST_POINT_MANIFEST_SPEC.md` 基础结构的 10 点位示例数据包，以及 10 次测试的 CSV 测量数据：

```bash
python scripts/create_sample_zip.py
```

输出文件位于：

```text
sample_data/FRAME-FATIGUE-202606_10points_export.zip
sample_data/FRAME-FATIGUE-202606_10runs_measurements.csv
```

CSV 测试数据导入是调试功能。进入页面左下角 `设置`，开启 `Debug 模式` 后，`项目概览` 页面会显示 `Debug CSV 测试数据导入` 工具。

CSV 表头为：

```text
run_name,cycle_count,test_time,point_id,max_strain_ue,min_strain_ue,remark
```

## manifest 校验方式

导入预览接口 `POST /api/import/preview` 会按 `TEST_POINT_MANIFEST_SPEC.md` 完成以下校验：

1. zip 可读取性、`manifest.json` 是否存在。
2. zip 内部路径安全性，拒绝 `../`、`..\`、绝对路径等路径穿越。
3. `manifest.json` 必须为 UTF-8 且 JSON 合法。
4. 使用 Pydantic 模型校验顶层结构、必填字段、点位、照片、通道、CAE 映射等基础字段。
5. 校验 `schema_version == "1.0.0"`。
6. 校验项目 ID、项目名称、点位列表、点位编号唯一性。
7. 校验点位照片 `photos[].path` 是否存在于 zip 中。
8. 检查重复通道名、重复照片 ID、重复文件 ID，并返回警告或错误。
9. 预览阶段不写入正式项目表，只有 `POST /api/import/confirm` 才会创建项目、点位、照片、通道、CAE 映射记录。

## 应变 / 应力计算

录入 `max_strain_ue` 和 `min_strain_ue` 后，后端自动计算：

```text
mean_strain_ue = (max_strain_ue + min_strain_ue) / 2
amplitude_strain_ue = (max_strain_ue - min_strain_ue) / 2
range_strain_ue = max_strain_ue - min_strain_ue
stress_mpa = 0.206 * strain_ue
```

## 测试数据导入

`项目概览` 页面点击 `录入测试数据` 后，支持三种入口：

1. 手动录入：创建单次测试轮次，并逐点填写最大 / 最小应变。
2. XLSX 模板导入：点击 `下载 XLSX 模板`，填写各点位在各循环次数下的最大 / 最小应变，再上传统一导入。
3. Dewesoft 数据：支持 `.dxd/.dxz/.d7d/.d7z` 原始文件，也支持 Dewesoft 导出的 `.csv/.txt`。

XLSX 模板表头为：

```text
run_name,cycle_count,test_time,point_id,point_name,max_strain_ue,min_strain_ue,remark
```

### Dewesoft 直接读取

`录入测试数据 -> Dewesoft 数据` 支持上传 `.dxd/.dxz/.d7d/.d7z` 原始文件，或 Dewesoft 导出的 `.csv/.txt` 文件，并填写本次导入对应的循环次数。

当前处理规则：

1. 通道名统一使用 `两位数字-点位名称`，例如 `01-左纵梁前段`。
2. 匹配时只使用开头两位数字，例如 `01-左纵梁前段` 匹配系统点位 `01`，后续点位名称不参与匹配。
3. 读取文件总时长。
4. 取总时长中间 1/10 作为稳定数据段。
5. 在稳定段内计算每个通道的最大应变、最小应变、平均应变。
6. 匹配到系统点位的通道会写入 `measurement_records`，并复用已有应力换算与趋势/异常算法。
7. 未匹配到系统点位但符合 `两位数字-点位名称` 的通道会自动新增点位，点位名称取 `-` 后的名称，并在前端弹窗提醒补充点位信息。
8. 其余未匹配到系统点位的通道也会保存，并可在 `Dewesoft 导入记录` 页面查看。

CSV/TXT 解析规则：

- 自动识别逗号、分号、Tab 分隔。
- 自动识别 `time` / `timestamp` 等时间列。
- 支持第二行单位行，例如 `s,ue,ue`。
- 支持表头中带单位，例如 `01-左纵梁前段 [ue]`。
- 其余数值列会按通道处理，通道名开头两位数字与系统点位编号一致时自动匹配。

原始文件解析依赖 `dwdatareader`，并需要本机可加载 Dewesoft 官方 `DWDataReaderLib` 动态库。没有真实 Dewesoft 文件或缺少官方运行库时，导入记录会保存失败原因。

## 异常规则

第一版实现轻量异常判断：

- 当前点位应变幅相对上一轮增长超过 20%，标记异常。
- 当前点位连续 3 次应变幅上升，标记趋势异常。
- 最大 / 最小应变为空时不参与判断。
- 用户手动标记异常时，保留人工标记原因。

## 主要接口

- `POST /api/import/preview`
- `POST /api/import/confirm`
- `GET /api/projects`
- `GET /api/projects/{project_id}`
- `DELETE /api/projects/{project_id}`
- `GET /api/projects/{project_id}/points`
- `GET /api/points/{point_id}`
- `PUT /api/points/{point_id}`
- `GET /api/media/{media_id}`
- `POST /api/projects/{project_id}/test-runs`
- `GET /api/projects/{project_id}/test-runs`
- `GET /api/test-runs/{run_id}`
- `DELETE /api/test-runs/{run_id}`
- `POST /api/test-runs/{run_id}/measurements`
- `GET /api/test-runs/{run_id}/measurements`
- `GET /api/points/{point_id}/measurements`
- `PUT /api/measurements/{measurement_id}`
- `DELETE /api/measurements/{measurement_id}`
- `GET /api/points/{point_id}/trend`
- `GET /api/projects/{project_id}/analysis/abnormal-points`
- `GET /api/projects/{project_id}/analysis/summary`
- `GET /api/projects/{project_id}/export.json`
- `GET /api/projects/{project_id}/export.csv`
