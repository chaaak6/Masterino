-- Shared category definitions only; each environment keeps its own resources.
INSERT INTO market_categories(resource_type,slug,sort_order,localizations) VALUES
('skill','data-analytics',10,'{"zh-CN":{"name":"数据分析","description":"指标、数据质量、分析复核与 SQL"},"en-US":{"name":"Data & Analytics","description":"Metrics, data quality, validation and SQL"}}'),
('skill','pdf-documents',20,'{"zh-CN":{"name":"文档与办公","description":"文档、方案、制度和演示材料"},"en-US":{"name":"Documents & Office","description":"Documents, procedures and presentations"}}'),
('skill','productivity-tasks',30,'{"zh-CN":{"name":"协作与需求","description":"会议、需求和任务协作"},"en-US":{"name":"Collaboration & Requirements","description":"Meetings, requirements and tasks"}}'),
('skill','communication',40,'{"zh-CN":{"name":"内部沟通","description":"通知、简报和沟通材料"},"en-US":{"name":"Internal Communications","description":"Notices, briefings and communications"}}'),
('skill','design',50,'{"zh-CN":{"name":"图解与设计","description":"流程图、图解与设计材料"},"en-US":{"name":"Diagrams & Design","description":"Diagrams, flowcharts and design"}}')
ON CONFLICT(resource_type,slug) DO NOTHING;
