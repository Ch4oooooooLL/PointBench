\# TEST\_POINT\_MANIFEST\_SPEC.md



\# 测试点位记录数据包 JSON 通信规范



\## 1. 文档目的



本文档定义 Android 点位记录 App 与 Web 点位管理系统之间的数据通信格式。



Android App 负责现场点位记录、照片采集、Excel 导出和压缩包导出。Web 系统负责导入压缩包、解析点位信息、展示照片、录入后续测试数据，并进行基础应变 / 应力分析。



双方通过压缩包中的 `manifest.json` 进行结构化数据传递。



\---



\## 2. 数据包总体结构



App 导出的压缩包必须采用如下结构：



```text

<ProjectName>\_<ExportTime>\_export.zip

├─ manifest.json

├─ points.xlsx

├─ images/

│  ├─ 01\_overview\_001.jpg

│  ├─ 01\_detail\_001.jpg

│  ├─ 02\_overview\_001.jpg

│  └─ ...

├─ raw/

│  └─ ...

└─ attachments/

&#x20;  └─ ...

```



说明：



| 路径              | 是否必须 | 说明             |

| --------------- | ---: | -------------- |

| `manifest.json` |   必须 | Web 系统导入的主数据源  |

| `points.xlsx`   |   建议 | 人工查看用的点位表      |

| `images/`       |   必须 | 点位照片目录         |

| `raw/`          |   可选 | 采集软件导出的原始数据    |

| `attachments/`  |   可选 | 试验大纲、补充说明、其他附件 |



Web 系统导入时必须以 `manifest.json` 为主数据源，不应依赖 Excel 作为主数据源。



\---



\## 3. 基本约定



\### 3.1 编码



`manifest.json` 必须使用 UTF-8 编码。



\### 3.2 时间格式



所有时间字段统一使用 ISO 8601 格式，例如：



```text

2026-06-24T14:30:00+08:00

```



\### 3.3 文件路径



所有文件路径必须使用压缩包内部相对路径，例如：



```text

images/01\_overview\_001.jpg

```



禁止使用：



```text

C:\\Users\\...

/storage/emulated/0/...

../images/xxx.jpg

```



路径分隔符统一使用 `/`。



\### 3.4 主键与唯一性



以下字段必须在对应范围内唯一：



| 字段                           | 唯一范围     |

| ---------------------------- | -------- |

| `export\_info.export\_id`      | 每次导出唯一   |

| `project.project\_id`         | 每个项目唯一   |

| `points\[].point\_id`          | 同一项目内唯一  |

| `points\[].photos\[].photo\_id` | 同一项目内唯一  |

| `files\[].file\_id`            | 同一数据包内唯一 |



\### 3.5 点位编号



`point\_id` 是后续所有数据关联的核心字段。



后续照片、采集通道、测试数据、趋势分析、CAE 对应关系都应围绕 `point\_id` 建立关系。



App 导出前必须检查：



1\. `point\_id` 不得为空；

2\. 同一项目内 `point\_id` 不得重复；

3\. 不建议在导出阶段自动生成随机 `point\_id`。



\---



\## 4. manifest.json 顶层结构



```json

{

&#x20; "schema\_version": "1.0.0",

&#x20; "export\_info": {},

&#x20; "project": {},

&#x20; "points": \[],

&#x20; "files": \[],

&#x20; "custom\_fields": {}

}

```



字段说明：



| 字段               | 类型     | 必须 | 说明        |

| ---------------- | ------ | -: | --------- |

| `schema\_version` | string |  是 | 通信规范版本    |

| `export\_info`    | object |  是 | 本次导出信息    |

| `project`        | object |  是 | 项目信息      |

| `points`         | array  |  是 | 点位列表      |

| `files`          | array  |  否 | 附件与衍生文件列表 |

| `custom\_fields`  | object |  否 | 扩展字段      |



当前版本固定为：



```json

"schema\_version": "1.0.0"

```



\---



\## 5. export\_info 规范



示例：



```json

{

&#x20; "export\_id": "EXP-20260624-001",

&#x20; "export\_time": "2026-06-24T14:30:00+08:00",

&#x20; "app\_name": "TestPointRecorder",

&#x20; "app\_version": "1.0.0",

&#x20; "device\_name": "Android Device",

&#x20; "operator": "Lee Chao",

&#x20; "remark": "车架疲劳试验点位记录导出"

}

```



字段说明：



| 字段            | 类型     | 必须 | 说明        |

| ------------- | ------ | -: | --------- |

| `export\_id`   | string |  是 | 本次导出的唯一编号 |

| `export\_time` | string |  是 | 导出时间      |

| `app\_name`    | string |  是 | App 名称    |

| `app\_version` | string |  是 | App 版本    |

| `device\_name` | string |  否 | 导出设备名称    |

| `operator`    | string |  否 | 记录或导出人员   |

| `remark`      | string |  否 | 导出备注      |



\---



\## 6. project 规范



示例：



```json

{

&#x20; "project\_id": "FRAME-FATIGUE-202606",

&#x20; "project\_name": "车架疲劳台架试验",

&#x20; "test\_object": "车架",

&#x20; "test\_type": "疲劳试验",

&#x20; "department": "实验部门",

&#x20; "vehicle\_or\_product": "非公路工程车辆车架",

&#x20; "test\_stage": "台架搭建与点位记录",

&#x20; "description": "前后轮固定，中间轮加载的车架疲劳台架试验",

&#x20; "created\_time": "2026-06-24T10:00:00+08:00",

&#x20; "updated\_time": "2026-06-24T14:30:00+08:00"

}

```



字段说明：



| 字段                   | 类型     | 必须 | 说明           |

| -------------------- | ------ | -: | ------------ |

| `project\_id`         | string |  是 | 项目唯一 ID      |

| `project\_name`       | string |  是 | 项目名称         |

| `test\_object`        | string |  否 | 测试对象         |

| `test\_type`          | string |  否 | 试验类型         |

| `department`         | string |  否 | 部门           |

| `vehicle\_or\_product` | string |  否 | 产品、车型或试验对象说明 |

| `test\_stage`         | string |  否 | 当前试验阶段       |

| `description`        | string |  否 | 项目说明         |

| `created\_time`       | string |  否 | 项目创建时间       |

| `updated\_time`       | string |  否 | 项目更新时间       |



\---



\## 7. points 规范



`points` 是最核心的数据结构。每个点位对应一条记录。



示例：



```json

{

&#x20; "point\_id": "01",

&#x20; "point\_name": "左侧纵梁前段应变测点",

&#x20; "point\_type": "strain\_gauge",

&#x20; "component": "车架纵梁",

&#x20; "side": "left",

&#x20; "position\_description": "靠近前固定点附近，纵梁外侧表面",

&#x20; "direction": "longitudinal",

&#x20; "bridge\_type": "1/4\_bridge",

&#x20; "resistance\_ohm": 120.3,

&#x20; "install\_status": "installed",

&#x20; "check\_status": "checked",

&#x20; "channel": {

&#x20;   "device": "Dewesoft",

&#x20;   "channel\_name": "01",

&#x20;   "unit": "ue",

&#x20;   "sample\_rate\_hz": null,

&#x20;   "remark": ""

&#x20; },

&#x20; "cae\_mapping": {

&#x20;   "cae\_point\_id": "CAE\_01",

&#x20;   "cae\_component": "Frame\_Longitudinal\_Beam",

&#x20;   "cae\_result\_type": "strain",

&#x20;   "danger\_level": "high",

&#x20;   "remark": ""

&#x20; },

&#x20; "photos": \[

&#x20;   {

&#x20;     "photo\_id": "PHOTO-01-001",

&#x20;     "type": "overview",

&#x20;     "path": "images/01\_overview\_001.jpg",

&#x20;     "filename": "01\_overview\_001.jpg",

&#x20;     "taken\_time": "2026-06-24T10:10:00+08:00",

&#x20;     "sha256": "",

&#x20;     "remark": "总览图"

&#x20;   }

&#x20; ],

&#x20; "tags": \["疲劳", "危险点", "CAE对应点"],

&#x20; "remark": "贴片后电阻正常，接线后零漂正常",

&#x20; "created\_time": "2026-06-24T10:00:00+08:00",

&#x20; "updated\_time": "2026-06-24T14:20:00+08:00",

&#x20; "custom\_fields": {}

}

```



字段说明：



| 字段                     | 类型            | 必须 | 说明               |

| ---------------------- | ------------- | -: | ---------------- |

| `point\_id`             | string        |  是 | 点位唯一编号，例如 `01` |

| `point\_name`           | string        |  是 | 点位名称             |

| `point\_type`           | string        |  是 | 点位类型             |

| `component`            | string        |  否 | 所属部件             |

| `side`                 | string        |  否 | 方位               |

| `position\_description` | string        |  否 | 位置描述             |

| `direction`            | string        |  否 | 应变片方向            |

| `bridge\_type`          | string        |  否 | 桥路类型             |

| `resistance\_ohm`       | number / null |  否 | 实测电阻             |

| `install\_status`       | string        |  是 | 安装状态             |

| `check\_status`         | string        |  否 | 检查状态             |

| `channel`              | object        |  否 | 采集通道信息           |

| `cae\_mapping`          | object        |  否 | CAE 映射信息         |

| `photos`               | array         |  是 | 照片列表             |

| `tags`                 | array         |  否 | 标签               |

| `remark`               | string        |  否 | 备注               |

| `created\_time`         | string        |  否 | 创建时间             |

| `updated\_time`         | string        |  否 | 更新时间             |

| `custom\_fields`        | object        |  否 | 扩展字段             |



\---



\## 8. channel 规范



示例：



```json

{

&#x20; "device": "Dewesoft",

&#x20; "channel\_name": "01",

&#x20; "unit": "ue",

&#x20; "sample\_rate\_hz": null,

&#x20; "remark": ""

}

```



字段说明：



| 字段               | 类型            | 必须 | 说明            |

| ---------------- | ------------- | -: | ------------- |

| `device`         | string        |  否 | 采集设备          |

| `channel\_name`   | string        |  否 | 采集通道名称        |

| `unit`           | string        |  否 | 单位，默认建议为 `ue` |

| `sample\_rate\_hz` | number / null |  否 | 采样率           |

| `remark`         | string        |  否 | 备注            |



如果 App 当前没有通道字段，则建议：



```json

"channel\_name": "<point\_id>"

```



\---



\## 9. cae\_mapping 规范



示例：



```json

{

&#x20; "cae\_point\_id": "CAE\_01",

&#x20; "cae\_component": "Frame\_Longitudinal\_Beam",

&#x20; "cae\_result\_type": "strain",

&#x20; "danger\_level": "high",

&#x20; "remark": ""

}

```



字段说明：



| 字段                | 类型     | 必须 | 说明           |

| ----------------- | ------ | -: | ------------ |

| `cae\_point\_id`    | string |  否 | CAE 对应点编号    |

| `cae\_component`   | string |  否 | CAE 模型中的部件名称 |

| `cae\_result\_type` | string |  否 | 对应结果类型       |

| `danger\_level`    | string |  否 | 危险等级         |

| `remark`          | string |  否 | 备注           |



\---



\## 10. photos 规范



示例：



```json

{

&#x20; "photo\_id": "PHOTO-01-001",

&#x20; "type": "overview",

&#x20; "path": "images/01\_overview\_001.jpg",

&#x20; "filename": "01\_overview\_001.jpg",

&#x20; "taken\_time": "2026-06-24T10:10:00+08:00",

&#x20; "sha256": "",

&#x20; "remark": "总览图"

}

```



字段说明：



| 字段           | 类型     | 必须 | 说明         |

| ------------ | ------ | -: | ---------- |

| `photo\_id`   | string |  是 | 照片唯一 ID    |

| `type`       | string |  是 | 照片类型       |

| `path`       | string |  是 | zip 内部相对路径 |

| `filename`   | string |  是 | 文件名        |

| `taken\_time` | string |  否 | 拍摄时间       |

| `sha256`     | string |  否 | 文件 SHA-256 |

| `remark`     | string |  否 | 照片备注       |



要求：



1\. `path` 必须能在 zip 内找到；

2\. `path` 必须是相对路径；

3\. `path` 不得包含 `../`；

4\. `filename` 应与 `path` 的文件名部分一致；

5\. 图片建议统一放在 `images/` 目录下。



\---



\## 11. files 规范



`files` 用于记录压缩包中的非点位照片类文件，例如 Excel、试验大纲、附件等。



示例：



```json

{

&#x20; "file\_id": "001",

&#x20; "type": "excel\_export",

&#x20; "path": "points.xlsx",

&#x20; "filename": "points.xlsx",

&#x20; "sha256": "",

&#x20; "remark": "点位人工查看表"

}

```



字段说明：



| 字段         | 类型     | 必须 | 说明         |

| ---------- | ------ | -: | ---------- |

| `file\_id`  | string |  是 | 文件 ID      |

| `type`     | string |  是 | 文件类型       |

| `path`     | string |  是 | zip 内部相对路径 |

| `filename` | string |  是 | 文件名        |

| `sha256`   | string |  否 | 文件 SHA-256 |

| `remark`   | string |  否 | 备注         |



\---



\## 12. 枚举值规范



\### 12.1 point\_type



```text

strain\_gauge

displacement\_sensor

force\_sensor

temperature\_sensor

other

```



\### 12.2 side



```text

left

right

front

rear

middle

upper

lower

unknown

```



\### 12.3 direction



```text

longitudinal

transverse

vertical

principal

rosette\_0

rosette\_45

rosette\_90

unknown

```



\### 12.4 bridge\_type



```text

1/4\_bridge

1/2\_bridge

full\_bridge

unknown

```



\### 12.5 install\_status



```text

planned

installed

removed

damaged

abandoned

```



\### 12.6 check\_status



```text

unchecked

checked

abnormal

rechecked

```



\### 12.7 photo.type



```text

overview

detail

wiring

location

other

```



\### 12.8 danger\_level



```text

low

medium

high

critical

unknown

```



\---



\## 13. App 导出校验要求



App 在生成 zip 前必须完成以下校验：



| 校验项                  | 处理要求         |

| -------------------- | ------------ |

| `manifest.json` 能否生成 | 不能生成则禁止导出    |

| `point\_id` 为空        | 禁止导出，并提示用户修正 |

| `point\_id` 重复        | 禁止导出，并提示用户修正 |

| 图片文件缺失               | 禁止导出或明确提示用户  |

| 图片路径为空               | 禁止导出或明确提示用户  |

| 项目名称为空               | 提示用户补充       |

| 桥路、方向、备注为空           | 可允许导出        |

| `sha256` 计算失败        | 可留空，但不应阻塞导出  |



\---



\## 14. Web 导入校验要求



Web 系统导入 zip 时必须完成以下校验：



| 校验项                         | 处理要求              |

| --------------------------- | ----------------- |

| zip 是否可读取                   | 不可读取则拒绝导入         |

| `manifest.json` 是否存在        | 不存在则拒绝导入          |

| JSON 是否合法                   | 不合法则拒绝导入          |

| `schema\_version` 是否支持       | 不支持则拒绝导入          |

| `project.project\_id` 是否为空   | 为空则拒绝导入           |

| `project.project\_name` 是否为空 | 为空则拒绝导入           |

| `points` 是否为空               | 为空则拒绝导入           |

| `point\_id` 是否重复             | 重复则拒绝导入           |

| `photos\[].path` 是否存在于 zip   | 缺失则提示，必要时拒绝导入     |

| zip 路径是否包含 `../`            | 拒绝导入              |

| zip 路径是否为绝对路径               | 拒绝导入              |

| 是否重复导入                      | 提示用户覆盖、合并或作为新版本导入 |



Web 系统建议先生成导入预览，不要上传后直接写入正式数据库。



\---



\## 15. 导入预览返回信息建议



Web 后端导入预览接口建议返回：



```json

{

&#x20; "temporary\_import\_id": "TMP-20260624-001",

&#x20; "export\_id": "EXP-20260624-001",

&#x20; "project\_id": "FRAME-FATIGUE-202606",

&#x20; "project\_name": "车架疲劳台架试验",

&#x20; "point\_count": 20,

&#x20; "photo\_count": 40,

&#x20; "missing\_files": \[],

&#x20; "duplicate\_point\_ids": \[],

&#x20; "duplicate\_channel\_names": \[],

&#x20; "warnings": \[],

&#x20; "errors": \[],

&#x20; "can\_import": true

}

```



\---



\## 16. 完整示例



```json

{

&#x20; "schema\_version": "1.0.0",

&#x20; "export\_info": {

&#x20;   "export\_id": "EXP-20260624-001",

&#x20;   "export\_time": "2026-06-24T14:30:00+08:00",

&#x20;   "app\_name": "TestPointRecorder",

&#x20;   "app\_version": "1.0.0",

&#x20;   "device\_name": "Android Device",

&#x20;   "operator": "Lee Chao",

&#x20;   "remark": "车架疲劳试验点位记录导出"

&#x20; },

&#x20; "project": {

&#x20;   "project\_id": "FRAME-FATIGUE-202606",

&#x20;   "project\_name": "车架疲劳台架试验",

&#x20;   "test\_object": "车架",

&#x20;   "test\_type": "疲劳试验",

&#x20;   "department": "实验部门",

&#x20;   "vehicle\_or\_product": "非公路工程车辆车架",

&#x20;   "test\_stage": "台架搭建与点位记录",

&#x20;   "description": "前后轮固定，中间轮加载的车架疲劳台架试验",

&#x20;   "created\_time": "2026-06-24T10:00:00+08:00",

&#x20;   "updated\_time": "2026-06-24T14:30:00+08:00"

&#x20; },

&#x20; "points": \[

&#x20;   {

&#x20;     "point\_id": "01",

&#x20;     "point\_name": "左侧纵梁前段应变测点",

&#x20;     "point\_type": "strain\_gauge",

&#x20;     "component": "车架纵梁",

&#x20;     "side": "left",

&#x20;     "position\_description": "靠近前固定点附近，纵梁外侧表面",

&#x20;     "direction": "longitudinal",

&#x20;     "bridge\_type": "1/4\_bridge",

&#x20;     "resistance\_ohm": 120.3,

&#x20;     "install\_status": "installed",

&#x20;     "check\_status": "checked",

&#x20;     "channel": {

&#x20;       "device": "Dewesoft",

&#x20;       "channel\_name": "01",

&#x20;       "unit": "ue",

&#x20;       "sample\_rate\_hz": null,

&#x20;       "remark": ""

&#x20;     },

&#x20;     "cae\_mapping": {

&#x20;       "cae\_point\_id": "CAE\_01",

&#x20;       "cae\_component": "Frame\_Longitudinal\_Beam",

&#x20;       "cae\_result\_type": "strain",

&#x20;       "danger\_level": "high",

&#x20;       "remark": ""

&#x20;     },

&#x20;     "photos": \[

&#x20;       {

&#x20;         "photo\_id": "PHOTO-01-001",

&#x20;         "type": "overview",

&#x20;         "path": "images/01\_overview\_001.jpg",

&#x20;         "filename": "01\_overview\_001.jpg",

&#x20;         "taken\_time": "2026-06-24T10:10:00+08:00",

&#x20;         "sha256": "",

&#x20;         "remark": "总览图"

&#x20;       },

&#x20;       {

&#x20;         "photo\_id": "PHOTO-01-002",

&#x20;         "type": "detail",

&#x20;         "path": "images/01\_detail\_001.jpg",

&#x20;         "filename": "01\_detail\_001.jpg",

&#x20;         "taken\_time": "2026-06-24T10:12:00+08:00",

&#x20;         "sha256": "",

&#x20;         "remark": "细节图"

&#x20;       }

&#x20;     ],

&#x20;     "tags": \["疲劳", "危险点", "CAE对应点"],

&#x20;     "remark": "贴片后电阻正常，接线后零漂正常",

&#x20;     "created\_time": "2026-06-24T10:00:00+08:00",

&#x20;     "updated\_time": "2026-06-24T14:20:00+08:00",

&#x20;     "custom\_fields": {}

&#x20;   }

&#x20; ],

&#x20; "files": \[

&#x20;   {

&#x20;     "file\_id": "001",

&#x20;     "type": "excel\_export",

&#x20;     "path": "points.xlsx",

&#x20;     "filename": "points.xlsx",

&#x20;     "sha256": "",

&#x20;     "remark": "点位人工查看表"

&#x20;   }

&#x20; ],

&#x20; "custom\_fields": {}

}

```



\---



\## 17. JSON Schema 基础校验



Web 后端可使用以下 JSON Schema 作为基础结构校验。业务层仍需额外检查 `point\_id` 唯一性、文件路径是否存在、zip 路径安全性等。



```json

{

&#x20; "$schema": "https://json-schema.org/draft/2020-12/schema",

&#x20; "$id": "https://local.test-point-recorder/manifest.schema.json",

&#x20; "title": "Test Point Recorder Manifest",

&#x20; "type": "object",

&#x20; "required": \[

&#x20;   "schema\_version",

&#x20;   "export\_info",

&#x20;   "project",

&#x20;   "points"

&#x20; ],

&#x20; "properties": {

&#x20;   "schema\_version": {

&#x20;     "type": "string",

&#x20;     "const": "1.0.0"

&#x20;   },

&#x20;   "export\_info": {

&#x20;     "type": "object",

&#x20;     "required": \[

&#x20;       "export\_id",

&#x20;       "export\_time",

&#x20;       "app\_name",

&#x20;       "app\_version"

&#x20;     ],

&#x20;     "properties": {

&#x20;       "export\_id": {

&#x20;         "type": "string",

&#x20;         "minLength": 1

&#x20;       },

&#x20;       "export\_time": {

&#x20;         "type": "string",

&#x20;         "format": "date-time"

&#x20;       },

&#x20;       "app\_name": {

&#x20;         "type": "string",

&#x20;         "minLength": 1

&#x20;       },

&#x20;       "app\_version": {

&#x20;         "type": "string",

&#x20;         "minLength": 1

&#x20;       },

&#x20;       "device\_name": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "operator": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "remark": {

&#x20;         "type": "string"

&#x20;       }

&#x20;     },

&#x20;     "additionalProperties": true

&#x20;   },

&#x20;   "project": {

&#x20;     "type": "object",

&#x20;     "required": \[

&#x20;       "project\_id",

&#x20;       "project\_name"

&#x20;     ],

&#x20;     "properties": {

&#x20;       "project\_id": {

&#x20;         "type": "string",

&#x20;         "minLength": 1

&#x20;       },

&#x20;       "project\_name": {

&#x20;         "type": "string",

&#x20;         "minLength": 1

&#x20;       },

&#x20;       "test\_object": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "test\_type": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "department": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "vehicle\_or\_product": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "test\_stage": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "description": {

&#x20;         "type": "string"

&#x20;       },

&#x20;       "created\_time": {

&#x20;         "type": "string",

&#x20;         "format": "date-time"

&#x20;       },

&#x20;       "updated\_time": {

&#x20;         "type": "string",

&#x20;         "format": "date-time"

&#x20;       }

&#x20;     },

&#x20;     "additionalProperties": true

&#x20;   },

&#x20;   "points": {

&#x20;     "type": "array",

&#x20;     "minItems": 1,

&#x20;     "items": {

&#x20;       "type": "object",

&#x20;       "required": \[

&#x20;         "point\_id",

&#x20;         "point\_name",

&#x20;         "point\_type",

&#x20;         "install\_status",

&#x20;         "photos"

&#x20;       ],

&#x20;       "properties": {

&#x20;         "point\_id": {

&#x20;           "type": "string",

&#x20;           "minLength": 1

&#x20;         },

&#x20;         "point\_name": {

&#x20;           "type": "string",

&#x20;           "minLength": 1

&#x20;         },

&#x20;         "point\_type": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "strain\_gauge",

&#x20;             "displacement\_sensor",

&#x20;             "force\_sensor",

&#x20;             "temperature\_sensor",

&#x20;             "other"

&#x20;           ]

&#x20;         },

&#x20;         "component": {

&#x20;           "type": "string"

&#x20;         },

&#x20;         "side": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "left",

&#x20;             "right",

&#x20;             "front",

&#x20;             "rear",

&#x20;             "middle",

&#x20;             "upper",

&#x20;             "lower",

&#x20;             "unknown"

&#x20;           ]

&#x20;         },

&#x20;         "position\_description": {

&#x20;           "type": "string"

&#x20;         },

&#x20;         "direction": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "longitudinal",

&#x20;             "transverse",

&#x20;             "vertical",

&#x20;             "principal",

&#x20;             "rosette\_0",

&#x20;             "rosette\_45",

&#x20;             "rosette\_90",

&#x20;             "unknown"

&#x20;           ]

&#x20;         },

&#x20;         "bridge\_type": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "1/4\_bridge",

&#x20;             "1/2\_bridge",

&#x20;             "full\_bridge",

&#x20;             "unknown"

&#x20;           ]

&#x20;         },

&#x20;         "resistance\_ohm": {

&#x20;           "type": \[

&#x20;             "number",

&#x20;             "null"

&#x20;           ]

&#x20;         },

&#x20;         "install\_status": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "planned",

&#x20;             "installed",

&#x20;             "removed",

&#x20;             "damaged",

&#x20;             "abandoned"

&#x20;           ]

&#x20;         },

&#x20;         "check\_status": {

&#x20;           "type": "string",

&#x20;           "enum": \[

&#x20;             "unchecked",

&#x20;             "checked",

&#x20;             "abnormal",

&#x20;             "rechecked"

&#x20;           ]

&#x20;         },

&#x20;         "channel": {

&#x20;           "type": "object",

&#x20;           "properties": {

&#x20;             "device": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "channel\_name": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "unit": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "sample\_rate\_hz": {

&#x20;               "type": \[

&#x20;                 "number",

&#x20;                 "null"

&#x20;               ]

&#x20;             },

&#x20;             "remark": {

&#x20;               "type": "string"

&#x20;             }

&#x20;           },

&#x20;           "additionalProperties": true

&#x20;         },

&#x20;         "cae\_mapping": {

&#x20;           "type": "object",

&#x20;           "properties": {

&#x20;             "cae\_point\_id": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "cae\_component": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "cae\_result\_type": {

&#x20;               "type": "string"

&#x20;             },

&#x20;             "danger\_level": {

&#x20;               "type": "string",

&#x20;               "enum": \[

&#x20;                 "low",

&#x20;                 "medium",

&#x20;                 "high",

&#x20;                 "critical",

&#x20;                 "unknown"

&#x20;               ]

&#x20;             },

&#x20;             "remark": {

&#x20;               "type": "string"

&#x20;             }

&#x20;           },

&#x20;           "additionalProperties": true

&#x20;         },

&#x20;         "photos": {

&#x20;           "type": "array",

&#x20;           "items": {

&#x20;             "type": "object",

&#x20;             "required": \[

&#x20;               "photo\_id",

&#x20;               "type",

&#x20;               "path",

&#x20;               "filename"

&#x20;             ],

&#x20;             "properties": {

&#x20;               "photo\_id": {

&#x20;                 "type": "string",

&#x20;                 "minLength": 1

&#x20;               },

&#x20;               "type": {

&#x20;                 "type": "string",

&#x20;                 "enum": \[

&#x20;                   "overview",

&#x20;                   "detail",

&#x20;                   "wiring",

&#x20;                   "location",

&#x20;                   "other"

&#x20;                 ]

&#x20;               },

&#x20;               "path": {

&#x20;                 "type": "string",

&#x20;                 "minLength": 1

&#x20;               },

&#x20;               "filename": {

&#x20;                 "type": "string",

&#x20;                 "minLength": 1

&#x20;               },

&#x20;               "taken\_time": {

&#x20;                 "type": "string",

&#x20;                 "format": "date-time"

&#x20;               },

&#x20;               "sha256": {

&#x20;                 "type": "string"

&#x20;               },

&#x20;               "remark": {

&#x20;                 "type": "string"

&#x20;               }

&#x20;             },

&#x20;             "additionalProperties": true

&#x20;           }

&#x20;         },

&#x20;         "tags": {

&#x20;           "type": "array",

&#x20;           "items": {

&#x20;             "type": "string"

&#x20;           }

&#x20;         },

&#x20;         "remark": {

&#x20;           "type": "string"

&#x20;         },

&#x20;         "created\_time": {

&#x20;           "type": "string",

&#x20;           "format": "date-time"

&#x20;         },

&#x20;         "updated\_time": {

&#x20;           "type": "string",

&#x20;           "format": "date-time"

&#x20;         },

&#x20;         "custom\_fields": {

&#x20;           "type": "object"

&#x20;         }

&#x20;       },

&#x20;       "additionalProperties": true

&#x20;     }

&#x20;   },

&#x20;   "files": {

&#x20;     "type": "array",

&#x20;     "items": {

&#x20;       "type": "object",

&#x20;       "required": \[

&#x20;         "file\_id",

&#x20;         "type",

&#x20;         "path",

&#x20;         "filename"

&#x20;       ],

&#x20;       "properties": {

&#x20;         "file\_id": {

&#x20;           "type": "string",

&#x20;           "minLength": 1

&#x20;         },

&#x20;         "type": {

&#x20;           "type": "string"

&#x20;         },

&#x20;         "path": {

&#x20;           "type": "string",

&#x20;           "minLength": 1

&#x20;         },

&#x20;         "filename": {

&#x20;           "type": "string",

&#x20;           "minLength": 1

&#x20;         },

&#x20;         "sha256": {

&#x20;           "type": "string"

&#x20;         },

&#x20;         "remark": {

&#x20;           "type": "string"

&#x20;         }

&#x20;       },

&#x20;       "additionalProperties": true

&#x20;     }

&#x20;   },

&#x20;   "custom\_fields": {

&#x20;     "type": "object"

&#x20;   }

&#x20; },

&#x20; "additionalProperties": true

}

```



\---



\## 18. 后续测试数据说明



`manifest.json` 只负责描述项目、点位、照片、通道、CAE 映射等基础信息。



后续试验过程中的应变数据、循环次数、应力换算、趋势分析结果不建议直接写入 App 导出的第一版 `manifest.json` 中。



Web 系统应在导入项目后，使用自己的数据库表记录测试轮次与测试数据。



推荐后续测试数据结构包括：



```text

test\_runs

measurement\_records

analysis\_results

```



其中测试数据建议至少包含：



| 字段                     | 说明   |

| ---------------------- | ---- |

| `cycle\_count`          | 循环次数 |

| `max\_strain\_ue`        | 最大应变 |

| `min\_strain\_ue`        | 最小应变 |

| `mean\_strain\_ue`       | 平均应变 |

| `amplitude\_strain\_ue`  | 应变幅  |

| `range\_strain\_ue`      | 应变范围 |

| `stress\_max\_mpa`       | 最大应力 |

| `stress\_min\_mpa`       | 最小应力 |

| `stress\_amplitude\_mpa` | 应力幅  |

| `is\_abnormal`          | 是否异常 |

| `abnormal\_reason`      | 异常原因 |



应变到应力的默认换算：



```text

stress\_mpa = 0.206 \* strain\_ue

```



该公式基于钢材弹性模量：



```text

E = 206000 MPa

```



后续系统应预留材料弹性模量配置能力。



