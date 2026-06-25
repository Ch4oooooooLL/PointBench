import {
  BarChart3,
  BookOpen,
  Camera,
  FilePlus2,
  FileUp,
  FolderCog,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Settings,
} from 'lucide-react';

const workflowSteps = [
  {
    title: '选择或准备项目',
    text: '进入系统后先在页面右上角选择当前项目。没有项目时，可以通过“导入项目”导入 zip，也可以通过“创建项目”手动创建。',
  },
  {
    title: '维护点位信息',
    text: '在“项目详情”中浏览点位列表，进入点位详情后可以查看点位元数据、照片、通道、CAE 映射和测量记录。',
  },
  {
    title: '录入测试数据',
    text: '在“项目概览”中点击“录入测试数据”，选择项目轮次并录入各点位应变数据。系统会自动计算应变幅和应力幅。',
  },
  {
    title: '记录裂纹',
    text: '在“裂纹记录”中点击“记录裂纹”，选择点位和循环次数，上传或粘贴裂纹图片并填写备注。',
  },
  {
    title: '查看趋势和风险',
    text: '回到“项目概览”查看统计指标、全点位应力幅趋势和风险点位。已记录裂纹的点位循环会在折线图上显示红圈。',
  },
];

const features = [
  {
    icon: LayoutDashboard,
    title: '项目概览',
    text: '汇总当前项目的点位数量、测试轮次、测量记录、异常记录、最新循环次数和应力幅趋势。',
  },
  {
    icon: ListChecks,
    title: '项目详情',
    text: '以点位为核心浏览项目数据，支持按点位进入详情，查看照片、通道、CAE 信息和历史测量。',
  },
  {
    icon: Camera,
    title: '裂纹记录',
    text: '按点位和循环次数保存裂纹图片、备注和记录时间，并在列表中集中浏览。',
  },
  {
    icon: FilePlus2,
    title: '创建项目',
    text: '手动创建新的实验项目，适合尚未形成导入包但需要先建立点位数据的场景。',
  },
  {
    icon: FileUp,
    title: '导入项目',
    text: '导入符合规范的项目 zip 包，系统会预览点位、照片和清单校验结果，再确认写入。',
  },
  {
    icon: LineChart,
    title: '趋势图',
    text: '展示全点位应力幅随循环次数变化的趋势，支持放大查看和突出单条点位曲线。',
  },
  {
    icon: BarChart3,
    title: '分析与异常',
    text: '基于测量记录计算应力幅排名和增长速度，辅助定位重点关注点位。',
  },
  {
    icon: FolderCog,
    title: '项目管理',
    text: '通过项目选择器旁的项目管理入口维护项目列表，切换当前工作项目。',
  },
  {
    icon: Settings,
    title: '系统设置',
    text: '左下角设置按钮用于配置风险阈值、概览折线图高度和 Debug 工具显示状态。',
  },
];

const notes = [
  '左侧导航和设置按钮固定在屏幕左侧，页面滚动时不会离开视口。',
  '裂纹红圈只会显示在已有趋势数据的循环坐标上；如果某次循环没有应力幅数据，裂纹仍会保存在裂纹记录页。',
  '图片上传支持普通文件选择，也支持在裂纹记录弹窗中聚焦上传区域后粘贴截图。',
  '导出 JSON 和 CSV 位于项目概览的操作区，用于将当前项目数据带出系统。',
];

export function UsageGuidePage() {
  return (
    <section>
      <div className="page-head">
        <div>
          <h1>使用说明</h1>
          <p>按项目、点位、测试轮次和裂纹记录组织实验数据，并在概览中完成趋势分析和风险查看。</p>
        </div>
      </div>

      <div className="guide-hero panel">
        <BookOpen size={34} />
        <div>
          <h2>推荐使用流程</h2>
          <p>先准备项目，再维护点位和测试数据，最后在概览中查看趋势、异常和裂纹标记。</p>
        </div>
      </div>

      <div className="guide-steps">
        {workflowSteps.map((step, index) => (
          <div key={step.title} className="guide-step">
            <span>{index + 1}</span>
            <div>
              <h2>{step.title}</h2>
              <p>{step.text}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="panel">
        <div className="section-head">
          <div>
            <h2>功能说明</h2>
            <p>左侧导航中的主要入口和相关功能如下。</p>
          </div>
        </div>
        <div className="guide-feature-grid">
          {features.map((feature) => {
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

      <div className="panel">
        <h2>注意事项</h2>
        <div className="guide-note-list">
          {notes.map((note) => (
            <div key={note}>{note}</div>
          ))}
        </div>
      </div>
    </section>
  );
}
