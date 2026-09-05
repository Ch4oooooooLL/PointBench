# 实验点位数据管理与分析 Web 系统

本项目用于导入 Android 点位记录 App 导出的 zip 数据包，解析 `manifest.json`，管理实验点位照片和通道信息，并录入后续疲劳试验测量数据，完成基础应变 / 应力分析与异常标记。

## 技术栈

| 层级   | 技术                                       |
| ------ | ------------------------------------------ |
| 后端   | FastAPI + SQLite + SQLAlchemy + Pydantic   |
| 前端   | React + TypeScript + ECharts + 普通 CSS    |

---

## 快速开始（便携版）

本项目按无管理员权限的离线应用发布，代码和依赖分别生成 EXE 安装器：

| 安装器 | 说明 |
| ---- | ---- |
| `PointBench-Dependencies-<版本>.exe` | 便携 Python、Node.js 和前后端依赖，必须先安装 |
| `PointBench-Code-<版本>.exe` | 项目代码、图标和启动入口；安装时校核依赖版本 |

两个安装器均安装到当前用户可写目录，并在 `HKCU\Software\PointBench` 分别记录代码/依赖版本、安装位置和安装时间，不需要管理员权限。安装器载荷使用 PointBench 原始文件容器，不使用 ZIP/CAB。

### Windows 启动

正式安装后双击桌面的 PointBench 快捷方式。源码目录可执行：

```text
scripts\start.bat
```

或在命令行执行：

```bat
scripts\run.bat
```

默认地址：

| 服务 | 地址 |
| ---- | ---- |
| 前端 | `http://127.0.0.1:5173` |
| 后端 API | `http://127.0.0.1:8000` |
| API 文档 | `http://127.0.0.1:8000/docs` |

### 安装便携依赖

在联网的 Windows 构建机上执行：

```bat
scripts\setup-portable-deps.bat
```

脚本会生成 `runtime/python/`、`runtime/node/` 和 `frontend/node_modules/`。下载产生的临时归档在展开后立即删除，并检查最终依赖中不存在 `.zip`、`.whl`、`.7z`、`.tar`、`.gz` 等压缩文件。

### 构建双 EXE 安装器

准备好便携依赖后执行：

```bat
scripts\build-installers.bat
```

也可继续使用统一发布入口 `scripts\pack-portable.bat`。产物默认位于 `dist/`：

| 产物 | 格式 | 内容 |
| ---- | ---- | ---- |
| `PointBench-Dependencies-<依赖版本>.exe` | EXE | 共享依赖安装器 |
| `PointBench-Code-<代码版本>.exe` | EXE | 代码安装器 |

版本统一配置在 `config/version.json`。完整安装、升级、注册表和静默安装说明见 [离线安装与发布说明](OFFLINE_INSTALLATION.md)。

### 示例数据

仓库的 `sample_data/` 目录保留了可直接导入的示例数据：

| 文件 | 说明 |
| ---- | ---- |
| `sample_data/POINTPROCESS_DEMO_FULL_20260905.zip` | 全要素演示包：8 点位（含照片/通道/CAE 映射）、10 轮 80 条测量数据、12 条裂缝记录、2 条 Dewesoft 导入记录、FEM 模型（含 INCLUDE 子文件与部件分组），通过完整备份导入一次性恢复 |
| `sample_data/FRAME-FATIGUE-202606_10points_export.zip` | 10 点位示例 zip 包 |
| `sample_data/FRAME-FATIGUE-202606_10runs_measurements.csv` | 10 次测试的 CSV 测量数据 |

> 全要素演示包由 `scripts/create_full_sample.py` 生成，重新生成命令：`python scripts/create_full_sample.py`。

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
| 应力幅 `stress_amplitude_mpa` | 按自定义公式计算（变量 `max` / `min`），默认 `(max-min)*0.21` |

> **说明**：应力换算已改为可配置的自定义公式，默认公式为 `(max-min)*0.21`（变量 `max`、`min` 分别对应最大 / 最小应变）。可在页面左下角「设置」中修改，公式通过 `PUT /api/settings` 保存为全局配置；公式解析失败时回退到弹性模量换算（默认弹性模量 206000 MPa）。

### 异常规则

| 规则 | 触发条件 |
| ---- | -------- |
| 变化异常 | 当前点位应变幅相对首次有效数据（baseline）变化超过 20%（默认阈值，可按项目配置） |
| 趋势异常 | 当前点位连续 3 次应变幅上升 |
| 空值处理 | 最大 / 最小应变为空时不参与判断 |
| 手动覆盖 | 用户手动标记异常时保留人工标记原因 |

---

## API 接口一览

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| **导入** | | |
| `POST` | `/api/import/preview` | 导入预览 |
| `POST` | `/api/import/preview-folder` | 文件夹导入预览 |
| `POST` | `/api/import/confirm` | 确认导入 |
| **项目** | | |
| `GET` | `/api/projects` | 项目列表 |
| `POST` | `/api/projects` | 创建项目 |
| `GET` | `/api/projects/{id}` | 项目详情 |
| `PUT` | `/api/projects/{id}` | 更新项目 |
| `DELETE` | `/api/projects/{id}` | 删除项目 |
| `GET` | `/api/projects/{id}/cache-version` | 项目缓存版本 |
| `GET` | `/api/projects/delete-exports/{filename}` | 下载已删除项目的导出文件 |
| `GET` | `/api/projects/{id}/points` | 项目点位列表 |
| `POST` | `/api/projects/{id}/points` | 创建点位 |
| **点位与媒体** | | |
| `GET` | `/api/points/{id}` | 点位详情 |
| `PUT` | `/api/points/{id}` | 更新点位 |
| `DELETE` | `/api/points/{id}` | 删除点位 |
| `POST` | `/api/points/{id}/media` | 上传点位媒体 |
| `DELETE` | `/api/points/{id}/media/{media_id}` | 删除点位媒体 |
| `GET` | `/api/media/{id}` | 获取媒体文件 |
| **测试轮次** | | |
| `POST` | `/api/projects/{id}/test-runs` | 创建测试轮次 |
| `GET` | `/api/projects/{id}/test-runs` | 测试轮次列表 |
| `GET` | `/api/test-runs/{id}` | 测试轮次详情 |
| `PUT` | `/api/test-runs/{id}` | 更新测试轮次 |
| `DELETE` | `/api/test-runs/{id}` | 删除测试轮次 |
| **测量记录** | | |
| `POST` | `/api/test-runs/{id}/measurements` | 创建测量记录 |
| `GET` | `/api/test-runs/{id}/measurements` | 测量记录列表 |
| `GET` | `/api/points/{id}/measurements` | 点位测量记录 |
| `PUT` | `/api/measurements/{id}` | 更新测量记录 |
| `DELETE` | `/api/measurements/{id}` | 删除测量记录 |
| `POST` | `/api/projects/{id}/measurements/import-xlsx` | XLSX 批量导入 |
| `POST` | `/api/projects/{id}/measurements/import-xlsx/preview` | XLSX 导入预览 |
| `POST` | `/api/projects/{id}/measurements/import-xlsx/confirm` | XLSX 导入确认 |
| `GET` | `/api/points/{id}/measurement-rows` | 点位测量记录行（含文件名） |
| `POST` | `/api/points/{id}/measurement-rows` | 创建测量记录行 |
| `PUT` | `/api/points/{id}/measurement-rows/{measurement_id}` | 更新测量记录行 |
| `PUT` | `/api/points/{id}/measurement-rows` | 批量更新测量记录行 |
| `DELETE` | `/api/points/{id}/measurement-rows/{measurement_id}` | 删除测量记录行 |
| **趋势与分析** | | |
| `GET` | `/api/points/{id}/trend` | 点位趋势数据 |
| `GET` | `/api/projects/{id}/trends` | 项目点位趋势 |
| `GET` | `/api/projects/{id}/analysis/abnormal-points` | 异常点位分析 |
| `GET` | `/api/projects/{id}/analysis/summary` | 项目分析摘要 |
| **导出** | | |
| `GET` | `/api/projects/{id}/export.json` | 导出 JSON |
| `GET` | `/api/projects/{id}/export.csv` | 导出 CSV |
| `GET` | `/api/projects/{id}/export.zip` | 导出 ZIP 包 |
| **Dewesoft 导入** | | |
| `POST` | `/api/projects/{id}/imports` | 提交 Dewesoft 导入 |
| `GET` | `/api/projects/{id}/imports` | Dewesoft 导入记录列表 |
| `GET` | `/api/imports/{import_id}` | Dewesoft 导入记录详情 |
| `DELETE` | `/api/imports/{import_id}` | 删除 Dewesoft 导入记录 |
| **裂纹记录** | | |
| `GET` | `/api/projects/{id}/crack-records` | 裂纹记录列表 |
| `POST` | `/api/projects/{id}/crack-records` | 创建裂纹记录 |
| `PUT` | `/api/crack-records/{record_id}` | 更新裂纹记录 |
| `DELETE` | `/api/crack-records/{record_id}` | 删除裂纹记录 |
| `GET` | `/api/crack-records/{record_id}/image` | 获取裂纹照片 |
| **设置与系统** | | |
| `GET` | `/api/settings` | 获取全局设置（应力公式） |
| `PUT` | `/api/settings` | 更新全局设置 |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/client-logs` | 前端日志上报 |
| **认证（需开启权限系统）** | | |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/auth/me` | 当前用户信息 |
| `POST` | `/api/auth/register` | 注册用户 |
| `GET` | `/api/auth/users` | 用户列表 |
| `PUT` | `/api/auth/users/{user_id}/role` | 修改用户角色 |
