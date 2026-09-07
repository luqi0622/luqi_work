/**
 * 个人档案数据 —— 关于页的「时间线 / 足迹」与「技能树」
 *
 * ⚠️ 以下为示例内容，请替换为你的真实经历：
 *    TIMELINE 按时间从早到晚排列（页面会自动倒序展示，最新的在最上面）
 *    kind 决定里程碑图标：edu 学业 / research 科研 / project 项目 / pub 成果 / tech 技术
 */

export interface Milestone {
  /** 展示用时间，如 '2023.09' 或 '2023' */
  date: string;
  title: string;
  desc?: string;
  kind: 'edu' | 'research' | 'project' | 'pub' | 'tech';
  tags?: string[];
}

export const TIMELINE: Milestone[] = [
  {
    date: '2021.09',
    title: '进入硅基光电子方向，开启研究生阶段',
    desc: '从器件物理入手，系统学习波导、微环与耦合结构的建模方法。',
    kind: 'edu',
    tags: ['硅基光电子', '器件物理'],
  },
  {
    date: '2022.03',
    title: '搭建 Lumerical 自动化仿真工作流',
    desc: '把重复性的建模、扫描、取数流程脚本化，仿真准备时间从小时级压缩到分钟级。',
    kind: 'tech',
    tags: ['Lumerical', 'Python', '参数扫描'],
  },
  {
    date: '2022.11',
    title: '光子神经网络结构寻优课题',
    desc: '围绕片上衍射/干涉单元的相位配置做自动化寻优，探索精度与面积的权衡。',
    kind: 'research',
    tags: ['光子神经网络', '光互连', '优化算法'],
  },
  {
    date: '2023.06',
    title: '第一篇学术论文投稿与发表',
    desc: '完成器件设计—仿真—数据分析的完整闭环。（请替换为真实标题/期刊）',
    kind: 'pub',
    tags: ['论文', 'Optics'],
  },
  {
    date: '2024.04',
    title: '把 AI / LLM 引入日常科研工作流',
    desc: '用大模型辅助文献梳理、代码生成与报告撰写，沉淀出一套可复用的 Prompt 工作流。',
    kind: 'tech',
    tags: ['AI / LLM', 'Agent 工作流', '效率工具'],
  },
  {
    date: '2025.02',
    title: '个人网站 luqi.work 上线',
    desc: '用 Astro + Tailwind 搭建，把研究笔记、项目与 2014 年以来的说说统一收拢到这里。',
    kind: 'project',
    tags: ['Astro', 'Tailwind CSS', 'Vercel'],
  },
];

/** 里程碑类型 → 图标与配色（配色统一收束在科技蓝色族内） */
export const MILESTONE_META: Record<
  Milestone['kind'],
  { label: string; icon: string; dot: string; chip: string }
> = {
  edu: {
    label: '学业',
    icon: 'lucide:graduation-cap',
    dot: 'bg-brand-600',
    chip: 'border-brand-200 bg-brand-50 text-brand-700 dark:border-brand-400/30 dark:bg-brand-400/10 dark:text-brand-300',
  },
  research: {
    label: '科研',
    icon: 'lucide:microscope',
    dot: 'bg-brand-500',
    chip: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300',
  },
  project: {
    label: '项目',
    icon: 'lucide:hammer',
    dot: 'bg-brand-700',
    chip: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/30 dark:bg-indigo-400/10 dark:text-indigo-300',
  },
  pub: {
    label: '成果',
    icon: 'lucide:award',
    dot: 'bg-amber-500',
    chip: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300',
  },
  tech: {
    label: '技术',
    icon: 'lucide:cpu',
    dot: 'bg-brand-400',
    chip: 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-300',
  },
};

export interface SkillGroup {
  icon: string;
  title: string;
  desc?: string;
  /** 技能标签，简洁直观即可 */
  tags: string[];
}

export const SKILL_TREE: SkillGroup[] = [
  {
    icon: 'lucide:cpu',
    title: '光子计算 / 硅基光电子',
    desc: '器件建模与仿真，跑得动、可复现、能批量。',
    tags: ['Lumerical FDTD', 'Lumerical MODE', 'HFSS', '波导与微环设计', '参数扫描 / 寻优'],
  },
  {
    icon: 'lucide:terminal',
    title: '自动化工具开发',
    desc: '凡是做过两遍的事情，就写成脚本。',
    tags: ['Python', 'Lumerical API', '批处理与取数', 'Tkinter 小工具', '数据可视化'],
  },
  {
    icon: 'lucide:sparkles',
    title: 'AI / LLM 工作流',
    desc: '把大模型嵌进科研与工程日常，而不是只当聊天窗口。',
    tags: ['LLM 应用', 'Prompt 工程', 'Agent / 自动化', '文献梳理', '代码生成辅助'],
  },
  {
    icon: 'lucide:globe',
    title: 'Web 与工程化',
    desc: '从想法到能分享出去的成品。',
    tags: ['Astro', 'React / Vite', 'Tailwind CSS', 'Vercel 部署', 'Git 工作流'],
  },
];
