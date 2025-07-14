# LLM API Proxy Service
Cloudflare Workers服务，提供LLM API代理和格式自动转换。


## 端点说明

### 1. Claude转OpenRouter (`/v1/claude-to-openrouter/messages`)
- 接收标准Claude API格式请求
- 自动转换模型名称（如：`claude-3-sonnet` → `anthropic/claude-3-sonnet`）
- 使用OpenRouter API Key（通过Authorization header传递）

### 2. Claude直接代理 (`/v1/claude-proxy/messages`)
- 直接转发请求到Claude API
- 使用Claude API Key（通过Authorization header传递）

## 快速部署

### 1. 安装Wrangler CLI
```bash
npm install -g wrangler
```

### 2. 登录Cloudflare
```bash
wrangler login
```

### 3. 一键部署
```bash
wrangler deploy
```

## 使用示例

### Claude转OpenRouter
使用OpenRouter API Key，但发送Claude格式请求：

```bash
curl -X POST https://llm-proxy.YOUR_NAME.workers.dev/v1/claude-to-openrouter/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-or-v1-your-openrouter-key" \
  -d '{
    "model": "claude-sonnet-4",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Claude直接代理
使用Claude API Key：

```bash
curl -X POST https://llm-proxy.YOUR_NAME.workers.dev/v1/claude-proxy/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-ant-your-claude-key" \
  -d '{
    "model": "claude-sonnet-4", 
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```
