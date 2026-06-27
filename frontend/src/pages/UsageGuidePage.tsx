import {
  Camera,
  ClipboardPlus,
  DatabaseZap,
  FileSpreadsheet,
  FileUp,
  LayoutDashboard,
  ListChecks,
} from 'lucide-react';

const guideSections = [
  {
    icon: LayoutDashboard,
    title: '项目概览',
    intro:
      '项目概览是进入项目后的总览窗口，用来快速判断当前项目做到哪一步、哪些点位值得重点关注。',
    features: [
      '项目基本信息卡片：展示名称、测试对象、当前阶段、点位数量、测试轮次、测量记录、异常点位、最新循环次数和当前最大应力幅等汇总指标。',
      '全点位应力幅趋势图：展示每个点位随循环次数变化的应力幅曲线；单击图表可放大查看，放大后可在右侧筛选单个点位。',
      '裂纹红圈标注：已记录裂纹的点位会以红圈标记在对应点位和时间点上，点击红圈即可查看裂纹详情。',
      '快速入口：右上角可切换或管理项目，也可通过「录入测试数据」进入点位记录导入。',
    ],
    steps: [
      { label: '进入项目', detail: '从项目列表点击任一项目，默认显示项目概览页面。' },
      { label: '查看汇总', detail: '顶部信息卡片展示项目整体进度，快速了解当前阶段和关键指标。' },
      { label: '分析趋势', detail: '浏览全点位应力幅趋势图，单击图表放大；放大后可在右侧筛选单个点位进行对比。' },
      { label: '追踪裂纹', detail: '点击趋势图上的红圈标记，查看对应点位在特定循环次数下的裂纹详情。' },
      { label: '录入数据', detail: '通过右上角「录入测试数据」按钮，选择手动填写、XLSX 模板导入或 Dewesoft 数据导入。' },
    ],
  },
  {
    icon: ListChecks,
    title: '项目详情',
    intro:
      '项目详情以点位为核心，把每个测点的图片、贴片信息和循环数据放在同一处管理。',
    features: [
      '点位列表：每行展示点位编号、名称、照片缩略图、部件位置、方向、桥路类型以及历次应力幅变化。',
      '点位详情面板：点击任一点位可查看整体照片、局部照片、贴片信息，以及各循环次数下的最大应变、最小应变、应变幅和应力幅。',
      '编辑模式：右上角开启后可新增点位、修改项目基础信息；进入点位详情还可编辑主信息、可选信息、照片和循环数据。',
    ],
    steps: [
      { label: '浏览列表', detail: '进入项目详情，每一行代表一个点位，快速扫览各点位的关键参数。' },
      { label: '查看详情', detail: '单击任一点位，打开详情面板查看照片、贴片信息和各循环次数下的应变/应力数据。' },
      { label: '编辑管理', detail: '需要修改时，开启右上角「编辑模式」；可新增点位、修改项目信息，或进入点位详情编辑具体内容。' },
    ],
  },
  {
    icon: Camera,
    title: '裂纹记录',
    intro:
      '裂纹记录用于集中保存和回看各点位在指定循环次数下出现的裂纹情况。',
    features: [
      '汇总统计：顶部展示裂纹记录总数、涉及点位数量和点位-循环组合数量。',
      '图片卡片：以卡片形式展示裂纹照片、点位编号、循环次数、轮次和备注信息。',
      '详情查看：点击卡片可查看裂纹大图和完整信息。',
      '趋势同步：保存后的裂纹会自动同步到项目概览趋势图的红圈标注中。',
    ],
    steps: [
      { label: '浏览记录', detail: '进入裂纹记录页面，查看汇总统计和图片卡片，快速了解裂纹整体情况。' },
      { label: '查看详情', detail: '点击任意裂纹卡片，查看大图和完整的点位、循环次数、轮次及备注信息。' },
      { label: '新增裂纹', detail: '开启右上角「编辑模式」，点击新增；选择点位和循环次数，上传或直接粘贴裂纹图片。' },
      { label: '填写备注', detail: '填写裂纹位置、长度、观察条件等备注信息后保存。' },
      { label: '验证同步', detail: '返回项目概览，确认趋势图上对应位置已出现红圈标注。' },
    ],
  },
  {
    icon: FileUp,
    title: '导入项目',
    intro:
      '导入项目用于接收外部项目包，让 Android App 现场记录的数据或其他主机导出的项目进入当前系统。',
    features: [
      '双入口支持：可上传 Android App 导出的 zip 数据包，也可选择已手动解压的项目文件夹。',
      '导入预览：系统自动检查 manifest 结构、点位数量、照片数量、重复点位编号、重复通道名、缺失文件等，并汇总警告和错误。',
      '确认导入：预览通过后点击「确认导入」一次性写入数据库；预览阶段不会修改正式项目表。',
      '加密兼容：公司内网文档加密导致 zip 不可读取时，可先手动解压为明文文件夹，再使用「选择解压文件夹」导入。',
    ],
    steps: [
      { label: '选择来源', detail: '在项目列表页点击「导入项目」，选择上传 zip 数据包或选择已解压文件夹。' },
      { label: '等待预览', detail: '系统自动解析并展示导入预览，包括 manifest 校验结果、文件清单和潜在问题。' },
      { label: '检查问题', detail: '仔细查看预览结果中的警告（可忽略）和错误（必须处理），确认数据完整无误。' },
      { label: '确认导入', detail: '点击「确认导入」将项目数据写入数据库，完成后即可在项目列表中查看。' },
    ],
  },
];

const pointRecordImports = [
  {
    icon: ClipboardPlus,
    title: '手动填写',
    scenario: '适合少量数据或临时补录。',
    steps: [
      '从项目概览页点击「录入测试数据」，选择「手动录入」。',
      '填写轮次名称、循环次数、测试时间和备注。',
      '按点位逐行输入最大应变、最小应变；必要时勾选异常并补充备注。',
      '保存后系统自动计算应变幅（(max-min)/2）和应力幅（0.206×应变幅）。',
    ],
    notes: '数据量较大时建议使用下方的 XLSX 模板导入或 Dewesoft 导入，效率更高。',
  },
  {
    icon: FileSpreadsheet,
    title: 'XLSX 模板导入',
    scenario: '适合一次导入多个点位、多个循环次数的批量数据。',
    steps: [
      '从项目概览页点击「录入测试数据」，选择「XLSX 模板导入」。',
      '输入已测试记录次数，点击下载模板（模板已预填点位编号和名称）。',
      '按模板列填写各点位在各循环次数下的 cycle_count、max_strain_ue、min_strain_ue 和 remark。',
      '上传填写完成的 XLSX 文件，系统按点位编号自动匹配并批量生成测试轮次和测量记录。',
    ],
    notes: '模板中的点位编号和点位名称请勿修改，否则会导致匹配失败。',
  },
  {
    icon: DatabaseZap,
    title: 'Dewesoft 数据导入',
    scenario: '适合从 Dewesoft 采集设备原始数据或导出文件中自动提取点位记录。',
    steps: [
      '从项目概览页点击「录入测试数据」，选择「Dewesoft 数据」。',
      '填写本次循环次数（可选填轮次名称）。',
      '上传原始文件（.dxd / .dxz / .d7d / .d7z）或 Dewesoft 导出的 CSV / TXT 文件。',
      '系统自动取总时长中间 1/10 作为稳定数据段，分析该段内的最大/最小应变。',
      '通道名按开头两位数字匹配系统点位编号（如 01-左纵梁前段 → 点位 01），自动写入测量记录。',
      'CSV/TXT 可直接解析；原始文件（.dxd 等）需要后端环境能加载 Dewesoft 官方 DWDataReaderLib 动态库。',
    ],
    notes: '未匹配到系统点位但符合「两位数字-名称」格式的通道会自动新增点位，并在前端弹窗提醒补充点位信息。其余未匹配通道也会保存，可在「Dewesoft 导入记录」页面查看。',
  },
];

export function UsageGuidePage() {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>使用说明</h1>
        </div>
      </div>

      <div className="guide-steps">
        {guideSections.map((section, index) => {
          const Icon = section.icon;
          return (
            <div key={section.title} className="guide-step">
              <span>{index + 1}</span>
              <div>
                <h2>
                  <Icon size={20} /> {section.title}
                </h2>
                <p className="guide-intro">{section.intro}</p>

                <div className="guide-sub">
                  <h4>核心功能</h4>
                  <ul className="guide-feature-list">
                    {section.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>

                <div className="guide-sub">
                  <h4>操作步骤</h4>
                  <ol className="guide-step-list">
                    {section.steps.map((s) => (
                      <li key={s.label}>
                        <span className="step-label">{s.label}</span>
                        <span className="step-detail">{s.detail}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h2>重点功能：点位记录导入</h2>
            <p>
              点位记录从「项目概览」的「录入测试数据」进入，支持手动填写、XLSX 模板导入和 Dewesoft
              数据导入三种方式。
            </p>
          </div>
        </div>
        <div className="guide-feature-grid">
          {pointRecordImports.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="guide-feature">
                <Icon size={22} />
                <h3>{feature.title}</h3>
                <p className="guide-feature-scenario">
                  <strong>适用场景：</strong>
                  {feature.scenario}
                </p>
                <div className="guide-feature-body">
                  <h5>操作步骤</h5>
                  <ol className="guide-step-list">
                    {feature.steps.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ol>
                  {feature.notes && (
                    <p className="guide-feature-notes">
                      <strong>说明：</strong>
                      {feature.notes}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
