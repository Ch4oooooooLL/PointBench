import {
  AlertTriangle,
  Archive,
  BookOpenCheck,
  Camera,
  CheckCircle2,
  Database,
  FileArchive,
  FileSpreadsheet,
  GitBranch,
  Import,
  ListChecks,
  Smartphone,
  TrendingUp,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type TableColumn = { key: string; label: string };
type TableRow = Record<string, string>;

const systemRoles = [
  {
    icon: Smartphone,
    title: 'Android 点位记录 App',
    tag: '原始点位包生成端',
    items: [
      '创建项目基础信息，按点位录入编号、部件名称、位置描述和备注。',
      '拍摄点位整体照片和局部照片。',
      '记录应变片安装状态、桥路类型、电阻值、通道名等现场信息。',
      '导出包含 manifest.json、points.xlsx、images/ 的项目压缩包。',
      '为 PointBench 提供结构化、可导入、可追溯的初始点位数据。',
    ],
    note: 'Android App 不作为长期分析系统使用，不负责多轮疲劳数据分析，也不作为最终归档库。',
  },
  {
    icon: Database,
    title: 'PointBench Web 系统',
    tag: '项目数据管理与分析端',
    items: [
      '导入 Android App 导出的项目 zip 包，并解析 manifest.json。',
      '生成和管理项目、点位、照片、通道和 CAE 映射信息。',
      '录入或导入不同循环次数下的应变测量数据。',
      '自动计算应变幅、应变范围、应力幅等派生指标。',
      '展示趋势、标记异常点位、记录裂纹照片和备注，并导出完整项目归档包。',
    ],
    note: 'PointBench 是正式数据源。项目导入后，测量数据、裂纹记录、趋势分析和报告数据均应以 PointBench 为准。',
  },
];

const goals = [
  '保证 CAE 危险点、试验大纲测点、现场应变片、采集通道、Web 系统点位、测试数据和报告内容一一对应。',
  '减少人工命名、照片整理、通道匹配和数据录入过程中的错误。',
  '将现场记录、试验数据、裂纹照片和分析结果形成完整闭环。',
  '使项目资料能够长期归档、复测、追溯和移交。',
];

const principles = [
  {
    title: 'point_id 是唯一主线',
    text:
      'CAE 危险点编号、试验大纲测点编号、现场应变片编号、照片文件、采集通道、PointBench 点位、XLSX 模板和报告描述都必须围绕同一个 point_id 建立关系。正式项目开始后原则上不得随意修改。',
  },
  {
    title: 'point_name 只用于人工核对',
    text:
      'point_name 用于人工识别和复核，不应作为自动匹配主键。系统匹配时以 01 这类 point_id 为准，名称可以优化表述，但不能代替点位编号参与数据匹配。',
  },
  {
    title: 'manifest.json 是项目包主数据源',
    text:
      'Android App 导出的项目包中，manifest.json 是 PointBench 导入时的主数据源；points.xlsx 仅用于人工查看和复核，不应作为正式导入依据。',
  },
  {
    title: 'cycle_count 是测试轮次主键',
    text:
      '测试轮次应按 project_id + cycle_count 唯一确定。同一项目中不应存在两个相同 cycle_count 的正式轮次，run_name 只作为显示名称。',
  },
];

const packageTree = [
  '<ProjectName>_<ExportTime>_export.zip',
  'manifest.json',
  'points.xlsx',
  'images/01_overview_001.jpg',
  'images/01_detail_001.jpg',
  'images/02_overview_001.jpg',
  'raw/',
  'attachments/',
];

const namingRules = [
  {
    title: '项目编号',
    items: ['建议格式：FRAME-FATIGUE-YYYYMM，例如 FRAME-FATIGUE-202606。', '同月多个项目可追加对象或序号，例如 FRAME-FATIGUE-202606-A。', '项目编号创建后不建议修改。'],
  },
  {
    title: '点位编号',
    items: ['普通应变片点位建议使用两位数字编号：01、02、03。', '左右侧、前后侧或特殊点位应在 point_name、component、side、position_description 中体现。', '不推荐把过长中文写入 point_id。'],
  },
  {
    title: '采集通道命名',
    items: ['Dewesoft 或其他采集软件通道名应采用 <point_id>-<point_name>。', '示例：01-左纵梁前段应变测点。', '不得使用 CH1、传感器1、左纵梁前段、01左纵梁等格式。'],
  },
  {
    title: '照片命名',
    items: ['建议由 Android App 自动生成照片名。', '推荐格式：<point_id>_<photo_type>_<index>.jpg。', 'overview 表示整体位置照片，detail 表示局部贴片细节照片，crack 表示 PointBench 裂纹记录照片。'],
  },
];

const timeline = [
  'CAE 危险点确认',
  '试验大纲确定测点',
  'Android App 新建项目',
  'Android App 逐点记录信息与照片',
  '现场贴片、电阻检查、通道确认',
  'Android App 导出 zip 包',
  'PointBench 导入项目包',
  '导入预览检查',
  '确认导入',
  '项目详情 / 点位台账复核',
  '采集软件按 point_id 规范命名通道',
  '进行疲劳循环测试',
  '按循环次数采集数据',
  'PointBench 录入或导入测量数据',
  '检查 Dewesoft / XLSX 导入结果',
  '查看项目概览和点位趋势',
  '复核异常点位',
  '发现裂纹后录入裂纹记录',
  '阶段性导出完整项目包',
  '形成报告或继续下一轮试验',
];

const pointFields = rows([
  ['point_id', '唯一编号，不可重复'],
  ['point_name', '简洁描述测点'],
  ['component', '所属部件'],
  ['side', '左侧、右侧、前侧、后侧等'],
  ['position_description', '现场可定位的位置说明'],
  ['direction', '应变片方向'],
  ['bridge_type', '桥路类型'],
  ['resistance_ohm', '初始电阻或贴片后实测电阻'],
  ['cae_point_id', '对应 CAE 危险点编号'],
  ['danger_level', 'CAE 风险等级或关注等级'],
  ['remark', '特殊说明'],
], ['field', 'requirement']);

const pointCardFields = rows([
  ['point_id', '必须', '后续匹配主键'],
  ['point_name', '必须', '点位名称'],
  ['component', '建议', '所属部件'],
  ['side', '建议', '左右侧或方位'],
  ['position_description', '必须', '现场位置描述'],
  ['direction', '建议', '应变片方向'],
  ['bridge_type', '建议', '桥路类型'],
  ['resistance_ohm', '建议', '贴片后电阻值'],
  ['install_status', '必须', 'planned / installed / failed 等'],
  ['check_status', '建议', 'checked / unchecked / recheck_required'],
  ['channel_name', '建议', '与采集系统通道一致'],
  ['remark', '可选', '现场补充说明'],
], ['field', 'required', 'description']);

const phases = [
  {
    icon: BookOpenCheck,
    title: '阶段一：试验准备与测点定义',
    summary: '将 CAE 危险点转化为现场可执行测点，输出初始测点清单。',
    blocks: [
      { title: '输入资料', items: ['CAE 仿真危险点结果', '试验大纲', '车架或试验对象示意图', '点位初始清单', '应变片规格', '采集设备通道规划', '现场安装方案'] },
      { title: '测点确认字段', table: { columns: cols(['字段', '要求'], ['field', 'requirement']), rows: pointFields } },
      { title: '输出结果', items: ['形成一份初始测点清单，用于指导 Android App 建立项目。'] },
    ],
  },
  {
    icon: Smartphone,
    title: '阶段二：Android App 现场建项与点位记录',
    summary: '现场人员创建项目、建立点位卡片、拍摄照片、完成复核并导出项目包。',
    blocks: [
      { title: '创建项目', items: ['填写项目编号、项目名称、测试对象、试验类型、部门、产品或车型、当前试验阶段和项目说明。', '项目编号必须与试验大纲和后续 PointBench 项目编号一致。'] },
      { title: '点位卡片字段', table: { columns: cols(['字段', '是否必须', '说明'], ['field', 'required', 'description']), rows: pointCardFields } },
      {
        title: '照片与复核',
        items: [
          '每个正式点位至少拍摄整体照片和局部照片。',
          '整体照片用于说明点位在车架或部件上的大致位置；局部照片用于说明贴片位置、方向和线缆引出情况。',
          '照片应清晰，局部照片应能判断应变片方向；如现场允许，应包含点位编号标签。',
          '导出前应复核点位编号、点位数量、照片数量、电阻记录、安装状态、通道名和异常备注。',
        ],
      },
      {
        title: '导出项目包',
        items: [
          '导出包必须包含 manifest.json、points.xlsx、images/。',
          '建议包含 attachments/ 试验大纲、点位说明和补充图片，以及 raw/ 现场原始补充资料。',
          '不得只通过微信图片、单独 Excel 或零散照片进行后续整理，正式流程必须以完整 zip 包为准。',
        ],
      },
    ],
  },
  {
    icon: Import,
    title: '阶段三：PointBench 导入项目',
    summary: '选择 Android App 导出的 zip 包，先预览校验，再确认导入并复核台账。',
    blocks: [
      { title: '导入入口', items: ['进入“导入项目”，选择 Android App 导出的 zip 包。', '若公司内网文档加密导致 zip 无法读取，可先手动解压为明文文件夹，再使用“选择解压文件夹”导入。'] },
      {
        title: '导入预览',
        table: {
          columns: cols(['检查项', '处理原则'], ['check', 'rule']),
          rows: rows([
            ['manifest 是否存在', '缺失则禁止导入'],
            ['schema_version 是否正确', '不匹配则禁止导入'],
            ['project_id 是否已存在', '已存在则禁止重复导入'],
            ['point_id 是否重复', '重复则禁止导入'],
            ['photo_id 是否重复', '重复则禁止导入'],
            ['照片文件是否缺失', '缺失则禁止导入'],
            ['通道名是否重复', '允许预警，但必须人工确认'],
            ['文件路径是否安全', '不安全则禁止导入'],
          ], ['check', 'rule']),
        },
      },
      {
        title: '确认导入与复核',
        items: [
          '只有预览结果无错误时，才允许点击“确认导入”。',
          '导入成功后生成项目记录、点位记录、照片、通道信息、CAE 映射信息、原始 manifest 备份、附件和原始资料目录。',
          '导入后进入“项目详情 / 点位台账”，复核点位数量、照片、部件、方向、桥路、电阻、通道缺失、待复核点位、照片绑定和 CAE 映射。',
          '少量字段问题可在 PointBench 中修正；点位编号大面积错误、照片绑定错误或项目包结构错误时，应回到源数据重新整理后重新导入。',
        ],
      },
    ],
  },
  {
    icon: GitBranch,
    title: '阶段四：台架试验与数据采集',
    summary: '每轮测试前确认项目、通道、异常线缆和计划循环次数，采集后归档原始文件。',
    blocks: [
      { title: '试验前确认', items: ['项目已正确导入 PointBench。', '点位编号与采集软件通道名前缀一致，通道名符合 <point_id>-<point_name>。', '采集设备通道无重复命名。', '坏线、未接线、异常线缆已在点位备注或现场记录中说明。', '当前计划循环次数明确。'] },
      { title: '采集文件保存', items: ['每次采集完成后保存原始采集文件，并按循环次数命名。', '推荐格式：<ProjectID>_Cycle-<cycle_count>_<YYYYMMDD>.dxd 或 .csv。', '示例：FRAME-FATIGUE-202606_Cycle-100000_20260630.csv。', '原始文件不得只保存在采集电脑临时目录，应同步归档到项目资料目录。'] },
    ],
  },
  {
    icon: FileSpreadsheet,
    title: '阶段五：PointBench 录入测试数据',
    summary: '按场景选择手动录入、XLSX 模板导入或 Dewesoft 数据导入，避免同一循环次数下来源混乱。',
    blocks: [
      { title: '手动录入', items: ['适合点位数量少、临时补录、单个点位复核或少量异常数据修正。', '填写轮次名称、循环次数、测试时间和备注，按点位输入最大应变和最小应变。', '保存后检查应变幅和应力幅是否合理，不适合作为大量点位、多轮次数据的主要录入方式。'] },
      { title: 'XLSX 模板导入', items: ['适合批量导入多个点位或多个循环次数，或数据已在 Excel 中整理完成。', '表头应为 run_name, cycle_count, test_time, point_id, point_name, max_strain_ue, min_strain_ue, remark。', 'point_id 必须存在于当前项目，point_name 只用于人工核对，不参与自动匹配。', '不允许 XLSX 自动新增点位、删除点位或删除已有循环次数。', '同一项目 cycle_count 应唯一，同一 cycle_count + point_id 组合只能有一条有效测量记录，上传前必须检查单位为 με。'] },
      {
        title: 'Dewesoft 数据导入',
        items: ['适合 Dewesoft 原始文件、CSV 或 TXT，并希望自动提取稳定段最大 / 最小应变的场景。', '填写循环次数，上传文件；系统读取通道，按通道名前缀匹配 point_id，并取中间稳定段计算最大应变、最小应变和平均应变。', '导入后进入 Dewesoft 导入记录页面复核。正式流程中不建议依赖自动新增点位，出现后应立即复核通道命名和点位清单。'],
        table: {
          columns: cols(['检查项', '处理原则'], ['check', 'rule']),
          rows: rows([
            ['matched_channel_count', '应接近本次有效测点数量'],
            ['unmatched_channel_count', '不应长期存在，必须解释原因'],
            ['自动新增点位', '视为异常情况，必须补充点位信息或回滚处理'],
            ['稳定段范围', '必须确认与实际试验加载稳定段一致'],
            ['最大 / 最小应变', '应检查是否存在明显离群值'],
          ], ['check', 'rule']),
        },
      },
    ],
  },
  {
    icon: ListChecks,
    title: '阶段六：测试轮次管理',
    summary: '每次有效测量数据必须归属于一个测试轮次，cycle_count 是趋势、裂纹和报告引用的关键字段。',
    blocks: [
      { title: '轮次创建规则', table: { columns: cols(['字段', '要求'], ['field', 'requirement']), rows: rows([['run_name', '可读名称，例如 20w次循环复测'], ['cycle_count', '循环次数，项目内唯一，例如 200000'], ['test_time', '测试时间，例如 2026-06-30 15:30'], ['remark', '数据来源、测试状态、异常说明']], ['field', 'requirement']) } },
      { title: '修改与删除规则', items: ['允许修改 run_name、test_time、remark。', '谨慎修改 cycle_count，修改前必须确认趋势图、裂纹记录和报告引用同步更新。', '删除测试轮次属于数据修正操作，不属于日常操作。', '导入错文件、循环次数填写错误且无法通过修改解决、重复导入或明确判定该轮数据无效时，才允许删除。', '删除前确认删除的是整个测试轮次、测量记录会一并消失、裂纹或报告引用已同步处理，并记录删除原因。'] },
    ],
  },
  {
    icon: TrendingUp,
    title: '阶段七：趋势分析与异常复核',
    summary: '项目概览看整体状态，点位详情做单点复核；系统自动异常只作为提示，不作为最终结论。',
    blocks: [
      { title: '项目概览', items: ['查看点位数量、测试轮次数量、测量记录数量、异常点位数量、最新循环次数、全点位应力幅趋势和裂纹标记。', '同时关注数据完整率、最新轮次缺失点位、待复核点位、通道缺失、照片缺失、左右对称差异、异常增长点位，以及裂纹记录与应力趋势是否一致。'] },
      { title: '点位详情', items: ['重点点位应查看点位照片、位置说明、通道信息、CAE 映射、历次最大 / 最小应变、应变幅变化、应力幅变化、异常标记和裂纹记录。'] },
      { title: '异常判断', items: ['某点应变幅明显增长、连续多轮上升、左右对称点差异明显、某一轮多个点位同时异常、突然增大后又恢复、应变值与现场观察不一致、异常点与裂纹位置不一致、通道可能接错或稳定段不合理时，应人工复核。', '复核后应在备注中写明判断结果，例如通道连接正常且可能与裂纹扩展有关，或疑似通道接触不良且本轮数据不作为趋势依据。'] },
    ],
  },
  {
    icon: Camera,
    title: '阶段八：裂纹记录',
    summary: '发现裂纹、涂层开裂、焊缝异常、局部变形或其他可见损伤时，立即记录。',
    blocks: [
      { title: '记录内容', table: { columns: cols(['字段', '要求'], ['field', 'requirement']), rows: rows([['point_id', '关联点位'], ['cycle_count', '发现裂纹时的循环次数'], ['run_name', '对应测试轮次'], ['image', '裂纹照片'], ['remark', '裂纹位置、长度、方向、观察条件'], ['created_at', '系统记录时间']], ['field', 'requirement']) } },
      { title: '照片与趋势联动', items: ['裂纹照片建议包含整体位置照片、局部裂纹照片、带标尺照片，必要时用红圈或备注说明裂纹位置。', '不得只保存无点位编号、无循环次数、无位置说明的裂纹图片。', '保存后返回项目概览，确认趋势图中对应点位和循环次数出现裂纹标记。', '若裂纹位置与异常应变点不一致，应说明测点距离、裂纹发生侧、受载路径、点位覆盖或采集数据等可能原因。'] },
    ],
  },
  {
    icon: Archive,
    title: '阶段九：项目导出与归档',
    summary: '关键节点必须导出完整项目包，PointBench 完整导出包应作为最终数据归档主文件。',
    blocks: [
      { title: '导出时机', items: ['初始点位导入完成后', '每个重要循环阶段完成后', '发现裂纹或重要异常后', '阶段性报告提交前', '项目结束后', '需要移交给其他人员或其他电脑时'] },
      { title: '导出内容', items: ['完整项目包应包含 manifest.json、pointprocess_backup.json、点位照片、裂纹照片、测试轮次数据、测量记录、Dewesoft 导入记录、原始文件或附件、人工可读的 Excel 工作簿。', 'manifest.json 用于兼容 Android / Web 点位数据结构；pointprocess_backup.json 用于完整恢复 PointBench 项目；Excel 工作簿用于人工查看和报告整理。'] },
      { title: '归档命名', items: ['推荐命名：<ProjectID>_PointBench_FullExport_<YYYYMMDD>.zip。', '示例：FRAME-FATIGUE-202606_PointBench_FullExport_20260630.zip。', '归档时应同时保存 Android App 初始导出包、PointBench 阶段性完整导出包、试验大纲、原始 Dewesoft 数据、报告文件和关键现场照片。'] },
    ],
  },
];

const checklists = [
  ['Android App 导出前检查', ['project_id 与试验大纲一致', 'point_id 无空值', 'point_id 无重复', '点位数量与大纲一致', '每个点位有整体照片', '每个点位有局部照片', '已贴片点位记录电阻', '已接线点位记录通道名', '通道名符合 <point_id>-<point_name>', '异常点位有备注', '成功导出 zip 包']],
  ['PointBench 导入后检查', ['导入预览无错误', '项目编号正确', '点位数量正确', '照片数量正确', '无照片缺失点位', '无重复通道名或已确认原因', '点位照片绑定正确', '点位状态正确', 'CAE 映射正确', '项目可正常导出备份']],
  ['每轮测试数据导入后检查', ['cycle_count 正确', 'run_name 正确', '数据来源明确', '点位匹配数量正确', '无异常未匹配通道', '最大 / 最小应变单位正确', '应变幅计算合理', '最新轮次无明显缺失点位', '异常点位已复核', '原始采集文件已归档']],
  ['裂纹记录检查', ['裂纹记录关联正确点位', '裂纹记录关联正确循环次数', '裂纹照片清晰', '备注说明裂纹位置和方向', '趋势图中出现裂纹标记', '报告引用与系统记录一致']],
] as const;

const exceptionRules = [
  ['点位编号错误', ['Android App 导出前发现点位编号错误，应在 App 中修正后重新导出。', '已导入 PointBench 且尚未导入测量数据时，可谨慎修正少量错误。', '已导入测量数据后不建议直接修改 point_id；必须修改时应同步检查测量记录、通道名、裂纹记录和报告引用。']],
  ['点位照片错误', ['少量错误可在 PointBench 点位详情中修正。', '大量错误应返回 Android App 或原始项目包重新整理。', '不允许为了通过导入而随意删除照片记录。']],
  ['Dewesoft 未匹配通道', ['依次排查通道名前缀是否缺失、是否与 point_id 一致、是否存在全角字符或空格。', '继续检查点位是否未导入 PointBench、是否存在临时新增测点、是否采集了非应变通道。', '未匹配通道不得直接忽略，必须在导入记录或项目备注中说明。']],
  ['数据异常', ['出现应变突变、连续增长或明显离群时，不应立即判定为疲劳损伤。', '应先排查通道接错、应变片脱胶、线缆接触不良、桥路设置、单位、载荷稳定性、台架偏载、对称点变化和现场可见损伤。', '复核后再给出结论。']],
] as const;

const efficiencyGroups = [
  ['现场阶段', ['使用 Android App 按点位卡片逐项录入，避免后期从零整理照片。', '使用整体图 + 局部图双照片模式，减少后期无法定位的问题。', '点位编号现场贴纸与 App 编号一致。', '现场发现异常立即写入备注。', '导出前完成点位完整性检查。']],
  ['数据导入阶段', ['项目初始信息只从 Android zip 包导入一次。', '后续循环数据优先使用 XLSX 模板或 Dewesoft 导入。', '少量补录才使用手动录入。', '不使用 Debug CSV 作为正式数据入口。', '每次导入后立即检查匹配数量和异常点位。']],
  ['分析阶段', ['项目概览用于看整体状态。', '点位台账用于查缺失和待复核点。', '点位详情用于单点深查。', '裂纹记录用于损伤闭环。', '完整导出包用于阶段归档和报告依据。']],
] as const;

const deliverables = [
  'Android App 初始点位 zip 包',
  'PointBench 完整项目导出 zip 包',
  '试验大纲',
  '点位清单 Excel',
  '点位照片',
  '裂纹照片',
  '原始采集数据',
  '每轮循环测试数据',
  '趋势分析结果',
  '异常点位复核记录',
  '阶段性或最终试验报告',
];

export function WorkflowPage() {
  return (
    <section className="workflow-page">
      <div className="page-head workflow-page-head">
        <div>
          <h1>使用流程</h1>
          <p>Android 点位记录 App 与 PointBench 系统联合工作流程规范</p>
        </div>
      </div>

      <div className="workflow-hero">
        <div>
          <span className="workflow-kicker">
            <Workflow size={18} />
            联合作业规范
          </span>
          <h2>从危险点确认到完整归档，所有数据围绕点位编号闭环。</h2>
          <p>
            本流程用于规范车架疲劳台架试验等应变测试项目中，Android 点位记录 App 与 PointBench Web
            系统的协同使用，确保现场记录、测试数据、裂纹照片和分析结果可追溯、可复测、可移交。
          </p>
        </div>
        <div className="workflow-goals">
          {goals.map((goal) => (
            <div key={goal}>
              <CheckCircle2 size={17} />
              <span>{goal}</span>
            </div>
          ))}
        </div>
      </div>

      <WorkflowSection title="系统分工" intro="Android App 负责现场原始点位包，PointBench 负责正式数据管理、分析和归档。">
        <div className="workflow-summary-grid">
          {systemRoles.map((role) => {
            const Icon = role.icon;
            return (
              <article className="workflow-card" key={role.title}>
                <div className="workflow-card-head">
                  <Icon size={22} />
                  <div>
                    <h3>{role.title}</h3>
                    <span>{role.tag}</span>
                  </div>
                </div>
                <BulletList items={role.items} />
                <p className="workflow-note">{role.note}</p>
              </article>
            );
          })}
        </div>
      </WorkflowSection>

      <WorkflowSection title="核心数据原则" intro="所有自动匹配、趋势判断、裂纹记录和报告引用都应基于稳定的数据主键。">
        <div className="workflow-principle-grid">
          {principles.map((principle) => (
            <article className="workflow-card principle-card" key={principle.title}>
              <h3>{principle.title}</h3>
              <p>{principle.text}</p>
            </article>
          ))}
        </div>
      </WorkflowSection>

      <WorkflowSection title="编号与命名规范" intro="规范命名能减少通道匹配失败、照片绑定错误和报告引用混乱。">
        <div className="workflow-summary-grid">
          {namingRules.map((rule) => (
            <article className="workflow-card compact" key={rule.title}>
              <h3>{rule.title}</h3>
              <BulletList items={rule.items} />
            </article>
          ))}
        </div>
        <div className="workflow-code-card">
          <h3>标准项目包结构</h3>
          <div className="workflow-file-tree">
            {packageTree.map((item, index) => (
              <span key={item} style={{ paddingLeft: index > 2 ? 18 : 0 }}>
                {item}
              </span>
            ))}
          </div>
        </div>
      </WorkflowSection>

      <WorkflowSection title="标准流程时间线" intro="建议按以下顺序执行，形成从测点定义到报告归档的闭环。">
        <div className="workflow-timeline">
          {timeline.map((step, index) => (
            <div className="workflow-timeline-item" key={step}>
              <span>{index + 1}</span>
              <p>{step}</p>
            </div>
          ))}
        </div>
      </WorkflowSection>

      <WorkflowSection title="分阶段说明" intro="每个阶段都明确输入、操作要点、检查规则和输出结果。">
        <div className="workflow-phase-list">
          {phases.map((phase, index) => {
            const Icon = phase.icon as LucideIcon;
            return (
              <article className="workflow-phase-card" key={phase.title}>
                <div className="workflow-phase-title">
                  <span>{index + 1}</span>
                  <Icon size={21} />
                  <div>
                    <h3>{phase.title}</h3>
                    <p>{phase.summary}</p>
                  </div>
                </div>
                <div className="workflow-phase-sections">
                  {phase.blocks.map((block) => (
                    <div className="workflow-phase-section" key={block.title}>
                      <h4>{block.title}</h4>
                      {'items' in block && block.items && <BulletList items={block.items} />}
                      {'table' in block && block.table && <WorkflowTable columns={block.table.columns} rows={block.table.rows} />}
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </WorkflowSection>

      <WorkflowSection title="数据质量检查清单" intro="关键节点应按清单逐项确认，避免把现场问题带入后续分析。">
        <div className="workflow-checklist-grid">
          {checklists.map(([title, items]) => (
            <article className="workflow-checklist" key={title}>
              <h3>{title}</h3>
              <div className="workflow-checklist-rows">
                {items.map((item) => (
                  <div key={item}>
                    <span aria-hidden="true" />
                    <p>{item}</p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </WorkflowSection>

      <WorkflowSection title="异常处理规则" intro="异常必须先复核原因，再给出结论；关键字段已关联数据后应谨慎修改。">
        <div className="workflow-alert-grid">
          {exceptionRules.map(([title, items]) => (
            <article className="workflow-alert" key={title}>
              <AlertTriangle size={20} />
              <div>
                <h3>{title}</h3>
                <BulletList items={items} />
              </div>
            </article>
          ))}
        </div>
      </WorkflowSection>

      <WorkflowSection title="效率提升要求" intro="减少重复整理，保证导入后立即可复核、可分析、可归档。">
        <div className="workflow-summary-grid">
          {efficiencyGroups.map(([title, items]) => (
            <article className="workflow-card compact" key={title}>
              <h3>{title}</h3>
              <BulletList items={items} />
            </article>
          ))}
        </div>
      </WorkflowSection>

      <WorkflowSection title="最终交付物" intro="项目结束时至少形成以下资料，其中 PointBench 完整项目导出 zip 包应作为最终数据归档主文件。">
        <div className="workflow-deliverables">
          {deliverables.map((item) => (
            <div key={item}>
              <FileArchive size={18} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </WorkflowSection>
    </section>
  );
}

function WorkflowSection({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <section className="workflow-section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          <p>{intro}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: readonly string[] }) {
  return (
    <ul className="workflow-list">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function WorkflowTable({ columns, rows }: { columns: TableColumn[]; rows: TableRow[] }) {
  return (
    <div className="workflow-table-wrap">
      <table className="workflow-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}-${columns.map((column) => row[column.key]).join('-')}`}>
              {columns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function cols(labels: string[], keys: string[]): TableColumn[] {
  return labels.map((label, index) => ({ label, key: keys[index] }));
}

function rows(values: string[][], keys: string[]): TableRow[] {
  return values.map((value) =>
    keys.reduce<TableRow>((row, key, index) => {
      row[key] = value[index] ?? '';
      return row;
    }, {}),
  );
}
