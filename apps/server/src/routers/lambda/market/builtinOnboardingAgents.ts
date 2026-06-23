type FallbackAgent = {
  avatar?: string;
  description?: string;
  identifier: string;
  name: string;
};

const BUILTIN_ONBOARDING_AGENTS: Record<string, FallbackAgent[]> = {
  'content-creation': [
    {
      avatar: '🖋️',
      description: '一个擅长润色文案的高级助手',
      identifier: 'masterlion-top-copywriting-master',
      name: '文案优化助手',
    },
    {
      avatar: '🗣️',
      description: '专业会议汇报助手，提炼会议要点成汇报句子',
      identifier: 'masterlion-meeting',
      name: '会议助手',
    },
    {
      avatar: '🌐',
      description: '中英文翻译专家，追求翻译信达雅',
      identifier: 'masterlion-en-cn-translator',
      name: '中英文互译助手',
    },
  ],
  'design-creative': [
    {
      avatar: '🎨',
      description: 'world-class UI/UX designer with extensive experience',
      identifier: 'masterlion-ui-ux-designer',
      name: 'UI/UX Designer',
    },
    {
      avatar: '✍️',
      description: '帮你书写更好的 UX 文案',
      identifier: 'masterlion-better-ux-writer',
      name: 'UX Writer',
    },
  ],
  'engineering': [
    {
      avatar: '🤖',
      description: '精通多种编程语言，优化代码结构，修复错误并提供优雅的解决方案。',
      identifier: 'masterlion-code-review-and-fix',
      name: '代码优化助手',
    },
    {
      avatar: '👨‍💻',
      description: '擅长后端开发任务',
      identifier: 'masterlion-backend-assistant',
      name: '后端开发助手',
    },
    {
      avatar: '👨‍💻',
      description: '擅长架构设计，技术细节熟练，擅长搜索引擎查找解决方案',
      identifier: 'masterlion-frontend-architect',
      name: '前端研发架构师',
    },
  ],
  'finance-legal': [
    {
      avatar: '📜',
      description: '优化合同条款，专业简洁表达',
      identifier: 'masterlion-business-contract',
      name: '合同条款精炼师',
    },
    {
      avatar: '💼',
      description: 'Comprehensive accounting support and expertise for individuals and businesses',
      identifier: 'masterlion-accounting',
      name: 'Accounting Expert',
    },
  ],
  'learning-research': [
    {
      avatar: '⚗️',
      description: '擅长高质量文献检索与分析的学术研究助手',
      identifier: 'masterlion-academic-paper-overview',
      name: '学术论文综述专家',
    },
    {
      avatar: '📚',
      description: '擅长将复杂学术论文通俗易懂讲解',
      identifier: 'masterlion-paper-understanding',
      name: '学术论文阅读导师',
    },
    {
      avatar: '🏛️',
      description: '擅长润色计算机科学学位论文',
      identifier: 'masterlion-cs-research-paper',
      name: '论文润色助手',
    },
  ],
  'marketing': [
    {
      avatar: '📝',
      description: '擅长产品功能分析与用户价值观广告文案创作',
      identifier: 'masterlion-advertising-copywriting-master',
      name: '广告文案创作大师',
    },
    {
      avatar: '🔍',
      description: '精通SEO术语和优化策略，提供全面SEO解决方案和实用建议。',
      identifier: 'masterlion-seo-helper',
      name: 'SEO优化专家',
    },
    {
      avatar: '📕',
      description: '擅长模仿小红书爆款文章风格进行写作',
      identifier: 'masterlion-xiaohongshu-style-writer',
      name: '小红书风格文案写手',
    },
  ],
  'operations': [
    {
      avatar: '📓',
      description: '周报生成助手',
      identifier: 'masterlion-write-report-assistant-development',
      name: '周报助手',
    },
    {
      avatar: '📊',
      description: '擅长社会经济问题分析与信息整合',
      identifier: 'masterlion-finance-news-analyser',
      name: '社会经济分析师',
    },
  ],
  'people-hr': [
    {
      avatar: '👨‍💼',
      description: '擅长设计面试问题并评估候选人',
      identifier: 'masterlion-interviewer-assistant',
      name: '面试官助手',
    },
    {
      avatar: '📈',
      description: '专业的职业发展规划和创业咨询，通过深入了解用户情况提供切实可行的建议',
      identifier: 'masterlion-career-development',
      name: '职业发展导师',
    },
  ],
  'product-management': [
    {
      avatar: '🤷',
      description: '基于KANO模型分析用户需求优先级',
      identifier: 'masterlion-user-request-research-manager',
      name: '用户需求研究经理',
    },
    {
      avatar: '📋',
      description: 'Specialized in transforming feature ideas into comprehensive Jira stories',
      identifier: 'masterlion-jira-product-manager',
      name: 'Jira Story Facilitator',
    },
  ],
  'sales-customer': [
    {
      avatar: '💼',
      description: '商务邮件撰写专家，擅长中英文商务邮件，跨文化沟通',
      identifier: 'masterlion-business-email',
      name: '商务邮件撰写专家',
    },
  ],
};

export default BUILTIN_ONBOARDING_AGENTS;
