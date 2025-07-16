# LLM Proxy for Cloudflare Workers

A simple and elegant LLM API proxy service that enables seamless format conversion between different LLM providers through a clean endpoint-based architecture.

## Features

- 🔄 **Format Conversion**: Automatic request/response conversion between providers
- 🔌 **Endpoint-based**: Clean `/from-{source}/to-{target}` URL structure  
- 🚀 **Cloudflare Workers**: Fast global deployment
- 📡 **Streaming Support**: Real-time response streaming
- 🛠️ **Tool Calling**: Full function calling support
- 🌐 **CORS Enabled**: Ready for web applications

## Supported Providers

- **anthropic**: Direct Anthropic API
- **openrouter**: OpenRouter proxy service

## API Endpoints

### Format: `POST /from-{source}/to-{target}/{subpath}`

### Examples

**Convert Anthropic to OpenRouter format:**
```bash
curl -X POST https://your-worker.workers.dev/from-anthropic/to-openrouter/messages \
  -H "Authorization: Bearer your-openrouter-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1000
  }'
```

**Direct Anthropic proxy:**
```bash
curl -X POST https://your-worker.workers.dev/from-anthropic/to-anthropic/messages \
  -H "Authorization: Bearer your-anthropic-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1000
  }'
```

**Convert OpenRouter to Anthropic format:**
```bash
curl -X POST https://your-worker.workers.dev/from-openrouter/to-anthropic/messages \
  -H "Authorization: Bearer your-anthropic-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "anthropic/claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1000
  }'
```

## Authentication

### Option 1: Authorization Header
```bash
-H "Authorization: Bearer your-api-key"
```

### Option 2: Environment Variables
Set these in your Cloudflare Workers environment:
- `OPENROUTER_API_KEY`
- `ANTHROPIC_API_KEY`

## Deployment

### Prerequisites
- Node.js 18+
- Cloudflare account
- Wrangler CLI

### Setup

1. **Clone and install:**
   ```bash
   git clone <repository>
   cd llm-proxy-cf
   npm install
   ```

2. **Configure Wrangler:**
   ```bash
   wrangler login
   ```

3. **Set up environment variables:**
   ```bash
   wrangler secret put OPENROUTER_API_KEY
   wrangler secret put ANTHROPIC_API_KEY
   ```

4. **Deploy:**
   ```bash
   npm run deploy
   ```

### Development

```bash
npm run dev
```

Access at: http://localhost:8787

## Architecture

```
Client Request
     ↓
[Source Transformer] → [Unified Format] → [Target Transformer]
     ↓                                            ↓
[Target API]                              [Response Transform]
     ↓                                            ↓
[Target Transformer] ← [Unified Format] ← [Source Transformer]
     ↓
Client Response
```

## Project Structure

```
src/
├── index.ts         # Main worker entry point
└── transformers.ts  # Format conversion logic
```

## Configuration

### wrangler.toml
```toml
name = "llm-proxy-cf"
main = "src/index.ts"
compatibility_date = "2024-05-15"

[observability]
enabled = true
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

**Simple. Fast. Reliable.** ⚡