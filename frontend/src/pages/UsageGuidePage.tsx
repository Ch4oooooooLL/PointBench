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
    intro: '项目概览是进入项目后的总览窗口，用来快速判断当前项目做到哪一步、哪些点位值得重点关注。',
    usage:
      '在这里可以看到项目名称、测试对象、当前阶段、点位数量、测试轮次、测量记录、异常点位、最新循环次数和当前最大应力幅等信息。全点位应力幅趋势图会展示每个点位随循环次数变化的情况，单击图表可以放大查看；放大后可在右侧筛选单个点位。已经记录裂纹的点位会以红圈标注在对应点位和时间点上，点击红圈即可查看裂纹详情。页面右上角可以切换或管理项目，也可以从“录入测试数据”进入点位记录导入。',
  },
  {
    icon: ListChecks,
    title: '项目详情',
    intro: '项目详情以点位为核心，把每个测点的图片、贴片信息和循环数据放在同一处管理。',
    usage:
      '进入页面后，每一行代表一个点位，可以查看点位编号、名称、照片缩略图、部件位置、方向、桥路类型以及历次应力幅变化。单击点位可打开详情，查看整体照片、局部照片、贴片信息和各循环次数下的最大应变、最小应变、应变幅、应力幅。右上角开启“编辑模式”后，可以新增点位、修改项目基础信息，也可以进入点位详情编辑主信息、可选信息、照片和循环数据。',
  },
  {
    icon: Camera,
    title: '裂纹记录',
    intro: '裂纹记录用于集中保存和回看各点位在指定循环次数下出现的裂纹情况。',
    usage:
      '页面会汇总裂纹记录数量、涉及点位数量和点位-循环组合数量，并以图片卡片展示裂纹照片、点位、循环次数、轮次和备注。点击卡片可查看大图和详细信息。右上角开启编辑模式后，可以新增、删除或修改裂纹情况；新增时选择点位和循环次数，上传或直接粘贴裂纹图片，再填写裂纹位置、长度、观察条件等备注即可保存。保存后的裂纹会同步出现在项目概览趋势图的红圈标注中。',
  },
  {
    icon: FileUp,
    title: '导入项目',
    intro: '导入项目用于接收外部项目包，让 Android App 现场记录的数据或其他主机导出的项目进入当前系统。',
    usage:
      '支持上传 Android App 导出的 zip 数据包，也支持选择已经手动解压的项目文件夹。系统会先进行导入预览，检查 manifest、点位数量、照片数量、重复点位编号、重复通道名、缺失文件、警告和错误；确认可以导入后，再点击“确认导入”写入数据库。如果公司内网文档加密导致 zip 不可读取，可以先手动打开或解压为明文文件夹，再使用“选择解压文件夹”导入。',
  },
];

const pointRecordImports = [
  {
    icon: ClipboardPlus,
    title: '手动填写',
    text: '适合少量数据或临时补录。进入“项目概览 -> 录入测试数据”，选择“手动录入”，填写轮次名称、循环次数、测试时间和备注；再按点位输入最大应变、最小应变，必要时勾选异常并补充备注。保存后系统会自动计算应变幅和应力幅。',
  },
  {
    icon: FileSpreadsheet,
    title: 'XLSX 模板导入',
    text: '适合一次导入多个点位、多个循环次数的数据。选择“XLSX 模板导入”，先输入已测试记录次数并下载模板；模板中保留点位编号和点位名称，按实际情况填写 cycle_count、max_strain_ue、min_strain_ue 和 remark 后上传。系统会按点位编号匹配并批量生成测试轮次和测量记录。',
  },
  {
    icon: DatabaseZap,
    title: 'Dewesoft 数据导入',
    text: '适合从采集设备原始数据或导出文件中提取点位记录。选择“Dewesoft 数据”，先填写本次循环次数，可选填写轮次名称，再上传 .dxd、.dxz、.d7d、.d7z 原始文件，或 Dewesoft 导出的 .csv、.txt 文件。系统会读取总时长中间 1/10 的稳定段，按通道名匹配点位编号，并计算最大/最小应变；CSV/TXT 可直接解析，原始文件需要后端环境能加载 Dewesoft 官方 DWDataReaderLib。',
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
                <h2><Icon size={20} /> {section.title}</h2>
                <p><strong>功能介绍：</strong>{section.intro}</p>
                <p><strong>使用方法：</strong>{section.usage}</p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h2>重点功能：点位记录导入</h2>
            <p>点位记录从“项目概览”的“录入测试数据”进入，支持手动填写、XLSX 导入和 Dewesoft 数据导入三种方式。</p>
          </div>
        </div>
        <div className="guide-feature-grid">
          {pointRecordImports.map((feature) => {
            const Icon = feature.icon;
            return (
              <div key={feature.title} className="guide-feature">
                <Icon size={22} />
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
