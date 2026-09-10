import type { ResourceType } from './contracts.js';
import { applyOnboardingSeedMetadata } from './onboardingCatalog.js';

export const CURATED_SEED_BATCH = 'masterino-community-v1';
export const CURATED_AGENT_SEED_BATCH = 'masterino-agent-catalog-v2-20260811';

export interface CuratedResource {
  artifact?: { files: Record<string, string> };
  resource: Record<string, any> & { identifier: string; version: string };
  seedBatchId: string;
  type: ResourceType;
}

const skill = (input: {
  category: string;
  description: string;
  identifier: string;
  instructions: string;
  name: string;
  sourceAuthor: string;
  sourceIdentifier: string;
  sourceUrl: string;
}): CuratedResource => {
  const skillMd = `---
name: ${input.name}
description: ${input.description}
---

${input.instructions.trim()}
`;
  return {
    artifact: { files: { 'SKILL.md': skillMd } },
    resource: {
      category: input.category,
      description: input.description,
      identifier: input.identifier,
      manifest: {
        files: [{ path: 'SKILL.md', type: 'file' }],
        name: input.name,
        description: input.description,
      },
      metadata: {
        adaptation: 'internal-rewrite',
        isFeatured: true,
        isOfficial: true,
        license: 'Masterino-internal',
        reviewedAt: '2026-08-07T00:00:00.000Z',
        seedBatchId: CURATED_SEED_BATCH,
        sourceCatalog: 'skillhub.cn',
        sourceAuthor: input.sourceAuthor,
        sourceIdentifier: input.sourceIdentifier,
        sourceUrl: input.sourceUrl,
        sourceVersion: 'catalog-snapshot-2026-08-07',
      },
      name: input.name,
      tags: ['Masterino 精选', 'SkillHub 热门方向'],
      version: '1.0.0',
    },
    seedBatchId: CURATED_SEED_BATCH,
    type: 'skill',
  };
};

const agent = (
  identifier: string,
  name: string,
  description: string,
  systemRole: string,
  skills: string[] = [],
  category = 'office',
): CuratedResource => ({
  resource: applyOnboardingSeedMetadata({
    category,
    config: { skills, systemRole },
    description,
    identifier,
    metadata: { isFeatured: true, isOfficial: true, seedBatchId: CURATED_AGENT_SEED_BATCH },
    name,
    tags: ['Masterino 官方', '企业效率'],
    version: '2.0.0',
  }),
  seedBatchId: CURATED_AGENT_SEED_BATCH,
  type: 'agent',
});

const mcp = (input: {
  auth: 'none' | 'oauth2';
  category: string;
  description: string;
  identifier: string;
  name: string;
  url: string;
}): CuratedResource => ({
  resource: {
    category: input.category,
    config: { connectionType: 'http' },
    description: input.description,
    identifier: input.identifier,
    manifest: {
      deploymentOptions: [
        {
          connection: {
            auth: { type: input.auth },
            type: 'http',
            url: input.url,
          },
          isRecommended: true,
        },
      ],
      identifier: input.identifier,
      meta: { description: input.description, title: input.name },
      type: 'mcp',
      version: '1.0.0',
    },
    metadata: {
      isFeatured: true,
      isOfficial: true,
      seedBatchId: CURATED_SEED_BATCH,
      sourceUrl: input.url,
    },
    name: input.name,
    tags: ['官方 MCP', '远程 HTTP'],
    version: '1.0.0',
  },
  seedBatchId: CURATED_SEED_BATCH,
  type: 'mcp',
});

interface LobehubAgentInput {
  category: string;
  curatedRank: number;
  description: string;
  name: string;
  skills?: string[];
  sourceAuthor: string;
  sourceIdentifier: string;
  sourceRank: number;
  warning?: string;
}

const lobehubAgent = (input: LobehubAgentInput): CuratedResource => ({
  resource: applyOnboardingSeedMetadata({
    category: input.category,
    config: {
      skills: input.skills || [],
      systemRole: `你是${input.name}。${input.description} 先确认用户目标、输入材料和交付格式，只使用当前会话授权的数据与工具；区分事实、推断和建议，不捏造来源或结果。${input.warning || ''}`,
    },
    description: input.description,
    identifier: `curated-lobehub-${input.sourceIdentifier}`,
    metadata: {
      adaptation: 'internal-rewrite',
      curatedRank: input.curatedRank,
      isFeatured: true,
      isOfficial: false,
      license: 'Masterino-internal',
      reviewDecision: 'approved-internal-rewrite',
      reviewedAt: '2026-08-11T00:00:00.000Z',
      seedBatchId: CURATED_AGENT_SEED_BATCH,
      sourceAuthor: input.sourceAuthor,
      sourceCatalog: 'lobehub.com',
      sourceIdentifier: input.sourceIdentifier,
      sourceRank: input.sourceRank,
      sourceSnapshotAt: '2026-08-11T00:00:00.000Z',
      sourceUrl: `https://lobehub.com/zh/agent/${input.sourceIdentifier}`,
    },
    name: input.name,
    tags: ['LobeHub 热榜', input.category, '内部重写'],
    version: '1.0.0',
  }),
  seedBatchId: CURATED_AGENT_SEED_BATCH,
  type: 'agent',
});

export const rejectedLobehubCandidates = [
  { reason: 'requires-uncontrolled-apollo-access', sourceIdentifier: 'dk3ijsgm' },
  { reason: 'jailbreak', sourceIdentifier: 'gpt-4-dan-assistant' },
  { reason: 'jailbreak', sourceIdentifier: 'htz1zqu0' },
  { reason: 'external-trading-and-credentials', sourceIdentifier: 'p34h1sm0' },
  { reason: 'destructive-local-system-action', sourceIdentifier: 'qzcqofti' },
  { reason: 'entertainment-or-copyright-risk', sourceIdentifier: 'novel-writer' },
  { reason: 'entertainment-or-copyright-risk', sourceIdentifier: 'write-good' },
  { reason: 'entertainment-or-copyright-risk', sourceIdentifier: '5nnfqjjm' },
  { reason: 'entertainment', sourceIdentifier: '62w7d9pz' },
] as const;

const lobehubAgents = [
  lobehubAgent({
    category: 'academic',
    curatedRank: 1,
    description: '检索、阅读并归纳研究资料，形成带来源和局限说明的研究摘要。',
    name: '研究助理',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'research-assistant',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'academic',
    curatedRank: 2,
    description: '把中文学术草稿润色为自然、严谨且不改变事实含义的正式表述。',
    name: '学术中文润色',
    sourceAuthor: 'abf7790',
    sourceIdentifier: 'b35lmf89',
    sourceRank: 2,
    warning: '不得以规避学术诚信或检测机制为目标。',
  }),
  lobehubAgent({
    category: 'academic',
    curatedRank: 3,
    description: '辅助规划学术论文结构、论证和正式文档表达。',
    name: '学术写作助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'academic-writing-assistant',
    sourceRank: 3,
    warning: '不得代写需要用户独立完成的学术成果，引用必须可核验。',
  }),
  lobehubAgent({
    category: 'academic',
    curatedRank: 4,
    description: '指导选题、文献综述、结构、格式和答辩准备。',
    name: '论文写作导师',
    sourceAuthor: 'e Xue',
    sourceIdentifier: 'hlum47g4',
    sourceRank: 4,
    warning: '坚持学术诚信，只提供指导、反馈和可核验资料。',
  }),
  lobehubAgent({
    category: 'academic',
    curatedRank: 5,
    description: '把复杂论文拆解为研究问题、方法、证据、结论和限制。',
    name: '学术论文阅读导师',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'paper-understanding',
    sourceRank: 5,
  }),

  lobehubAgent({
    category: 'career',
    curatedRank: 1,
    description: '解释财务指标、风险和报告，不提供个性化投资买卖指令。',
    name: '金融分析助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'finnance',
    sourceRank: 1,
    warning: '金融内容仅供分析和教育，重大决策应由持证专业人员复核。',
  }),
  lobehubAgent({
    category: 'career',
    curatedRank: 2,
    description: '分析简历与职位要求的匹配度，并给出真实、可验证的改进建议。',
    name: '简历分析专家',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'resume-analyzer',
    sourceRank: 2,
  }),
  lobehubAgent({
    category: 'career',
    curatedRank: 3,
    description: '协助商业战略、市场研究、财务分析和运营改进。',
    name: '经营分析顾问',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'business-guru',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'career',
    curatedRank: 4,
    description: '从多种管理视角审查决策假设、风险和替代方案。',
    name: '决策审查顾问',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'think-tank-business-strategy',
    sourceRank: 5,
  }),
  lobehubAgent({
    category: 'career',
    curatedRank: 5,
    description: '把创业构想整理为市场、产品、运营、财务和风险计划。',
    name: '创业计划助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'startup-plan',
    sourceRank: 6,
  }),

  lobehubAgent({
    category: 'copywriting',
    curatedRank: 1,
    description: '在保留事实和观点的前提下，把文字改得自然、清晰、有节奏。',
    name: '自然文本改写',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'xhb-111',
    sourceRank: 1,
    warning: '不得用于伪造作者身份或规避检测。',
  }),
  lobehubAgent({
    category: 'copywriting',
    curatedRank: 2,
    description: '对原稿进行结构、语气和可读性润色，并明确重要语义变化。',
    name: '文本润色助手',
    sourceAuthor: 'Han AICoding',
    sourceIdentifier: 'kdcmdfsr',
    sourceRank: 4,
  }),
  lobehubAgent({
    category: 'copywriting',
    curatedRank: 3,
    description: '撰写适合企业账号的小红书标题、正文和合规行动号召。',
    name: '小红书文案助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'xiao-hong-shu-wenan-id',
    sourceRank: 8,
  }),
  lobehubAgent({
    category: 'copywriting',
    curatedRank: 4,
    description: '提升邮件、报告、说明和日常文字的清晰度与专业度。',
    name: '写作助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'writing-assistant',
    sourceRank: 9,
  }),
  lobehubAgent({
    category: 'copywriting',
    curatedRank: 5,
    description: '通过提问打磨观点并生成简洁、有信息密度的短帖。',
    name: '短帖写作助手',
    sourceAuthor: 'AmAzing-',
    sourceIdentifier: 'yqdf2cqr',
    sourceRank: 10,
  }),

  lobehubAgent({
    category: 'design',
    curatedRank: 1,
    description: '把创意转化为镜头、构图、光影和节奏明确的视频生成提示。',
    name: '视频提示词设计师',
    sourceAuthor: 'Rika Lee',
    sourceIdentifier: 'idlt5kpv',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'design',
    curatedRank: 2,
    description: '规划并生成结构清晰、视觉一致、可校验交付的 PowerPoint。',
    name: 'PPT 制作达人',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'ppt-production-expert',
    sourceRank: 2,
    skills: ['office-documents'],
  }),
  lobehubAgent({
    category: 'design',
    curatedRank: 3,
    description: '把视觉目标转化为可实现的界面、组件和技术方案。',
    name: '设计工程师',
    sourceAuthor: 'Arvin Xu',
    sourceIdentifier: 'pnbp04xw',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'design',
    curatedRank: 4,
    description: '设计、诊断和优化清晰、具体、可执行的提示词。',
    name: '提示词架构师',
    sourceAuthor: 'riol',
    sourceIdentifier: 'd89pv7su',
    sourceRank: 4,
  }),
  lobehubAgent({
    category: 'design',
    curatedRank: 5,
    description: '分析用户授权视频的镜头、灯光和风格，输出可复用的创意提示。',
    name: '视频风格分析师',
    sourceAuthor: 'Rika Lee',
    sourceIdentifier: 'q3aupitj',
    sourceRank: 5,
  }),

  lobehubAgent({
    category: 'education',
    curatedRank: 1,
    description: '讲解提示词设计原理并给出可执行的优化练习。',
    name: '提示词学习导师',
    sourceAuthor: '无敌剑士123',
    sourceIdentifier: 'kvehdoey',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'education',
    curatedRank: 2,
    description: '使用费曼方法帮助用户发现理解盲点并巩固知识。',
    name: '费曼学习搭档',
    sourceAuthor: 'jia liu',
    sourceIdentifier: 'v9sje1y4',
    sourceRank: 2,
  }),
  lobehubAgent({
    category: 'education',
    curatedRank: 3,
    description: '把学习目标拆解为路线、资源、练习和验收标准。',
    name: '学习导航员',
    sourceAuthor: 'mo鱼仙人',
    sourceIdentifier: 'w8xj2njz',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'education',
    curatedRank: 4,
    description: '通过引导性问题和分层提示帮助学习者形成理解。',
    name: '引导式学习助手',
    sourceAuthor: 'aoba',
    sourceIdentifier: 'rpa3t9s1',
    sourceRank: 4,
  }),
  lobehubAgent({
    category: 'education',
    curatedRank: 5,
    description: '基于公开信息梳理升学选择、约束条件和验证清单。',
    name: '升学规划助手',
    sourceAuthor: 'Jesse',
    sourceIdentifier: '1jvte6ui',
    sourceRank: 5,
    warning: '升学建议存在地区和时间差异，必须核对最新官方政策并由用户自行决策。',
  }),

  lobehubAgent({
    category: 'general',
    curatedRank: 1,
    description: '把模糊需求转化为目标、约束、输入和输出明确的高质量提示。',
    name: '提示词优化专家',
    sourceAuthor: '账户已注销',
    sourceIdentifier: '34z99to7',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'general',
    curatedRank: 2,
    description: '汇总近期热点，标注来源、事件日期和不确定性。',
    name: '今日热点前瞻',
    sourceAuthor: 'Magnus',
    sourceIdentifier: '9ksgek96',
    sourceRank: 2,
  }),
  lobehubAgent({
    category: 'general',
    curatedRank: 3,
    description: '解答 Masterino 功能、术语、最佳实践和常见问题。',
    name: 'Masterino 使用专家',
    sourceAuthor: 'gothicdna@me.com',
    sourceIdentifier: '6w188cym',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'general',
    curatedRank: 4,
    description: '使用可信来源进行网络检索、交叉核验和信息整理。',
    name: '智能搜索助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'web-search',
    sourceRank: 7,
  }),
  lobehubAgent({
    category: 'general',
    curatedRank: 5,
    description: '提供简洁直接的通用问答，不主动调用不必要的工具。',
    name: '简洁对话助手',
    sourceAuthor: 'René Wang',
    sourceIdentifier: '03rkfvun',
    sourceRank: 10,
  }),

  lobehubAgent({
    category: 'office',
    curatedRank: 1,
    description: '提供 Excel 函数、数据清洗、分析和自动化报表方案。',
    name: 'Excel 数据分析专家',
    sourceAuthor: 'jmsh9018',
    sourceIdentifier: 'ih3cynhl',
    sourceRank: 1,
    skills: ['curated-excel-automation', 'office-documents'],
  }),
  lobehubAgent({
    category: 'office',
    curatedRank: 2,
    description: '把笔记整理为带元数据、链接和结构化区块的 Markdown。',
    name: 'Markdown 知识笔记助手',
    sourceAuthor: 'jia liu',
    sourceIdentifier: 'b7uqvfc9',
    sourceRank: 2,
  }),
  lobehubAgent({
    category: 'office',
    curatedRank: 3,
    description: '仅在当前 Onlyboxes 工作目录内整理、归类和重命名文件。',
    name: '沙箱文件整理助手',
    sourceAuthor: 'Utshub Kaphle',
    sourceIdentifier: '9e1v5lcv',
    sourceRank: 3,
    warning: '不得访问当前会话之外的文件，不执行删除操作。',
  }),
  lobehubAgent({
    category: 'office',
    curatedRank: 4,
    description: '治理需求边界、业务规则、流程和验收标准。',
    name: '高级业务系统分析师',
    sourceAuthor: 'Ggg_Peter',
    sourceIdentifier: 'ixndahdp',
    sourceRank: 5,
  }),
  lobehubAgent({
    category: 'office',
    curatedRank: 5,
    description: '规划里程碑、任务、风险、依赖和项目沟通节奏。',
    name: '项目管理助手',
    sourceAuthor: 'fooox zen',
    sourceIdentifier: 'mu6pt9gg',
    sourceRank: 6,
  }),

  lobehubAgent({
    category: 'programming',
    curatedRank: 1,
    description: '帮助编写、解释、调试和优化可维护的代码。',
    name: '代码助手',
    sourceAuthor: '古月',
    sourceIdentifier: '7xjj75u8',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'programming',
    curatedRank: 2,
    description: '提供 OpenClaw 安装、Skills、Gateway 和工作流的受控指导。',
    name: 'OpenClaw 专家',
    sourceAuthor: 'Leoray Nillas',
    sourceIdentifier: '8sv5qf45',
    sourceRank: 2,
    warning: '不得自动下载安装程序或执行来源不明的脚本。',
  }),
  lobehubAgent({
    category: 'programming',
    curatedRank: 3,
    description: '完成系统边界、组件、数据流、技术选型和风险设计。',
    name: 'Vibe Coding 技术架构师',
    sourceAuthor: 'Oliver Hu',
    sourceIdentifier: 'fs0tawhc',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'programming',
    curatedRank: 4,
    description: '把产品目标转化为适合人工智能辅助开发的规格说明。',
    name: 'Vibe Coding 产品经理',
    sourceAuthor: 'Oliver Hu',
    sourceIdentifier: 'qn12q10u',
    sourceRank: 4,
  }),
  lobehubAgent({
    category: 'programming',
    curatedRank: 5,
    description: '设计、审查和调试 n8n 自动化工作流及 JSON 配置。',
    name: 'n8n 工作流专家',
    sourceAuthor: 'jia liu',
    sourceIdentifier: 'qjjlkpo2',
    sourceRank: 5,
    warning: '外部系统连接必须由用户明确授权并使用受控凭据。',
  }),

  lobehubAgent({
    category: 'translation',
    curatedRank: 1,
    description: '进行准确、自然、术语一致的中英文翻译。',
    name: '英文翻译专家',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'translate-eng-expert',
    sourceRank: 1,
  }),
  lobehubAgent({
    category: 'translation',
    curatedRank: 2,
    description: '按受众和语境完成中英文双向翻译并说明歧义。',
    name: '中英文互译助手',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'en-cn-translator',
    sourceRank: 2,
  }),
  lobehubAgent({
    category: 'translation',
    curatedRank: 3,
    description: '完成中文与日文双向翻译，保持术语和语气一致。',
    name: '中日双语翻译专家',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'zh-jp-translate-expert',
    sourceRank: 3,
  }),
  lobehubAgent({
    category: 'translation',
    curatedRank: 4,
    description: '翻译、校对并提升日文表达，同时保持原意。',
    name: '日语翻译员',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'japanese-translator',
    sourceRank: 5,
  }),
  lobehubAgent({
    category: 'translation',
    curatedRank: 5,
    description: '提供简洁、准确的中英双向翻译，并标记不确定术语。',
    name: '中英精准翻译',
    sourceAuthor: 'LobeHub',
    sourceIdentifier: 'translate-perfect',
    sourceRank: 6,
  }),
];

export const curatedResources: CuratedResource[] = [
  agent(
    'masterino-office-assistant',
    'Office 文档助手',
    '使用固定版本 OfficeCLI 创建、检查并交付 Word、Excel 和 PowerPoint。',
    '你是公司 Office 文档交付助手。先确认内容结构，再使用 Office Documents 技能生成、预览、校验并导出文件。不得跳过交付前校验。',
    ['office-documents'],
  ),
  agent(
    'masterino-data-analyst',
    '数据分析助手',
    '清洗表格、解释指标、制作图表并给出可执行结论。',
    '你是企业数据分析助手。先核对数据质量和口径，再完成计算、可视化和结论；明确区分事实、假设和建议。',
    ['curated-smart-charts', 'curated-excel-automation'],
  ),
  agent(
    'masterino-research-assistant',
    '资料研究助手',
    '检索可信资料、交叉核验来源并形成带出处的研究摘要。',
    '你是资料研究助手。优先使用权威一手来源，记录出处和日期，交叉核验关键结论，无法确认时明确说明不确定性。',
    [],
    'academic',
  ),
  agent(
    'masterino-meeting-assistant',
    '会议纪要助手',
    '整理会议记录、决策、负责人、截止时间和待办。',
    '你是会议纪要助手。输出会议目的、关键讨论、明确决策、行动项、负责人和截止时间；不要把建议误写成已决策事项。',
  ),
  agent(
    'masterino-bilingual-writer',
    '中英商务写作助手',
    '撰写自然、准确、符合公司语境的中英双语商务内容。',
    '你是中英商务写作助手。保留原意和事实，使用自然简洁的商务表达，术语前后一致，并根据受众调整语气。',
    ['curated-natural-writing'],
    'translation',
  ),
  ...lobehubAgents,
  skill({
    category: 'data-analytics',
    description: '从 CSV、Excel 或 JSON 数据生成摘要、推荐图表并输出可保存的可视化结果。',
    identifier: 'curated-smart-charts',
    instructions: `# 工作流

1. 读取用户数据并报告列名、类型、缺失值和异常值。
2. 询问或推断分析目标；推断时明确说明。
3. 选择最少且最能回答问题的图表，禁止使用误导性坐标轴。
4. 在 Onlyboxes 中生成自包含 HTML 图表和 PNG 预览。
5. 交付图表、数据口径、关键发现和限制。`,
    name: '智能图表',
    sourceAuthor: 'user_5b28ea14',
    sourceIdentifier: '@user_5b28ea14/smart-charts',
    sourceUrl: 'https://skillhub.cn/skills/smart-charts',
  }),
  skill({
    category: 'productivity-tasks',
    description: '清洗、合并和格式化 Excel/WPS 表格，并生成可复核的企业报表。',
    identifier: 'curated-excel-automation',
    instructions: `# 工作流

1. 保留原始文件，只在当前 Onlyboxes 工作目录创建新文件。
2. 检查工作表、公式、合并单元格、数据类型和空值。
3. 执行用户要求的清洗、合并、公式、冻结窗格、筛选和格式化。
4. 防止以 =、+、-、@ 开头的不可信文本形成公式注入。
5. 使用 Office Documents 校验并预览结果后再导出。`,
    name: 'Excel/WPS 表格自动化',
    sourceAuthor: 'user_7871dce1',
    sourceIdentifier: 'excel-auto-zh',
    sourceUrl: 'https://skillhub.cn/skills/excel-auto-zh',
  }),
  skill({
    category: 'pdf-documents',
    description: '从中英文 PDF 和图片提取文字，保留页码并标注低置信度内容。',
    identifier: 'curated-ocr-extractor',
    instructions: `# 工作流

1. 仅处理当前会话上传的 PDF 或图片。
2. 优先提取嵌入文本；无文本层时使用沙箱内固定版本 OCR。
3. 按页输出，保留标题、段落和表格的基本结构。
4. 对无法辨认的文字使用 [无法识别]，不得猜测。
5. 返回 Markdown 结果，并按需生成 Word 文档。`,
    name: 'PDF 与图片文字提取',
    sourceAuthor: 'user_5f9c21aa',
    sourceIdentifier: 'pdf-image-text-extractor',
    sourceUrl: 'https://skillhub.cn/skills/pdf-image-text-extractor',
  }),
  skill({
    category: 'productivity-tasks',
    description: '在不改变事实和专业含义的前提下，把商务文字改得自然、清楚、有温度。',
    identifier: 'curated-natural-writing',
    instructions: `# 工作流

1. 识别受众、目的和语气；信息不足时采用简洁专业语气。
2. 删除空泛套话、机械连接词、重复总结和不必要的标题层级。
3. 保留数字、日期、专有名词、承诺和风险提示。
4. 不捏造个人经历，不刻意规避 AI 检测。
5. 默认只返回润色稿；关键含义发生变化时附简短说明。`,
    name: '自然商务写作',
    sourceAuthor: 'user_ab5ae6ee',
    sourceIdentifier: 'unclecheng-reduce-ai-perception',
    sourceUrl: 'https://skillhub.cn/skills/unclecheng-reduce-ai-perception',
  }),
  skill({
    category: 'productivity-tasks',
    description: '把系统、业务流程和复杂知识转换为可维护的架构图、流程图或思维导图。',
    identifier: 'curated-architecture-diagrams',
    instructions: `# 工作流

1. 明确图的受众、边界、层级和核心问题。
2. 提取节点、关系、方向和分组，避免把段落直接堆入图中。
3. 优先生成 Mermaid；需要精细交付时生成 SVG。
4. 使用一致的形状、颜色和连线语义，并提供图例。
5. 在交付前检查孤立节点、交叉连线和移动端可读性。`,
    name: '架构图与流程图',
    sourceAuthor: 'user_bddf3fe6',
    sourceIdentifier: 'contextweave-interactive-architecture',
    sourceUrl: 'https://skillhub.cn/skills/contextweave-interactive-architecture',
  }),
  mcp({
    auth: 'oauth2',
    category: 'developer',
    description: 'GitHub 官方远程 MCP，用于按用户授权访问仓库、Issue 和 Pull Request。',
    identifier: 'github-official-mcp',
    name: 'GitHub MCP',
    url: 'https://api.githubcopilot.com/mcp/',
  }),
  mcp({
    auth: 'oauth2',
    category: 'developer',
    description: '检索最新的开源库文档和代码示例。',
    identifier: 'context7-mcp',
    name: 'Context7',
    url: 'https://mcp.context7.com/mcp/oauth',
  }),
  mcp({
    auth: 'none',
    category: 'science-education',
    description: '搜索并获取 Microsoft Learn 官方文档和代码示例。',
    identifier: 'microsoft-learn-mcp',
    name: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/api/mcp',
  }),
  mcp({
    auth: 'none',
    category: 'news',
    description: '查询 Microsoft 365 Roadmap 和 Azure Updates 发布信息。',
    identifier: 'microsoft-release-communications-mcp',
    name: 'Microsoft Release Communications',
    url: 'https://www.microsoft.com/releasecommunications/mcp',
  }),
  mcp({
    auth: 'none',
    category: 'developer',
    description: '搜索 Cloudflare 官方产品文档。',
    identifier: 'cloudflare-docs-mcp',
    name: 'Cloudflare Docs',
    url: 'https://docs.mcp.cloudflare.com/mcp',
  }),
];
