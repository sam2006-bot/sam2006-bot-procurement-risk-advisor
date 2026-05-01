# Procurement Risk Advisor

自动化采购审批风险建议工具。支持上传历史参考 Excel 和待审批 Excel，完成同类采购匹配、重复采购风险、金额趋势、代理机构/人员提醒，并可调用 OpenRouter 生成 AI 意见。

## Local

```bash
npm install
npm start
```

Open `http://127.0.0.1:4173`.

本地运行时，如果项目根目录存在 `无源全流程报表-安徽V2.xlsx`，系统会自动作为历史参考表使用。该文件不会提交到 Git。

## Render

Render 部署不内置公司 Excel 数据。公网运行时，在页面同时上传：

- 历史参考 Excel
- 待审批 Excel

Render 配置：

- Build Command: `npm ci`
- Start Command: `npm start`
- Health Check Path: `/api/health`

仓库已包含 `render.yaml`。在 Render 创建 Web Service 或 Blueprint 时连接本仓库即可。

建议设置环境变量：

- `OPENROUTER_API_KEY`: OpenRouter API Key
- `OPENROUTER_MODEL`: 默认 `openai/gpt-4.1-mini`

如果不配置 `OPENROUTER_API_KEY`，系统仍会输出程序自动匹配结果，但不会生成 AI 审批意见。
