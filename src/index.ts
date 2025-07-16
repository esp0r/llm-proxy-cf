// LLM Proxy with new endpoint structure: /from-{source}/to-{target}/{subpath}
import { AnthropicTransformer, OpenRouterTransformer, BaseTransformer } from './transformers';

interface Env {
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
}

interface Provider {
  name: string;
  baseUrl: string;
  defaultModel?: string;
}

class LLMProxyService {
  private transformers = new Map<string, BaseTransformer>();
  private providers = new Map<string, Provider>();

  constructor() {
    this.initializeTransformers();
    this.initializeProviders();
  }

  private initializeTransformers() {
    const anthropic = new AnthropicTransformer();
    const openrouter = new OpenRouterTransformer();
    
    this.transformers.set('anthropic', anthropic);
    this.transformers.set('openrouter', openrouter);
  }

  private initializeProviders() {
    this.providers.set('anthropic', {
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-sonnet-4'
    });
    
    this.providers.set('openrouter', {
      name: 'openrouter', 
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
      defaultModel: 'anthropic/claude-sonnet-4'
    });
  }

  async handleRequest(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Parse new endpoint pattern: /from-{source}/to-{target}/{subpath}
      const pathMatch = url.pathname.match(/^\/from-(\w+)\/to-(\w+)(?:\/(.*))?$/);
      
      if (pathMatch) {
        const [, sourceProvider, targetProvider, subPath] = pathMatch;
        return await this.handleConversionRequest(
          request, 
          env, 
          corsHeaders, 
          sourceProvider, 
          targetProvider, 
          subPath || 'messages'
        );
      }

      // Handle /v1/chat/completions as a subpath in conversion endpoints
      // This allows URLs like /from-anthropic/to-openrouter/v1/chat/completions

      // Root endpoint - show API documentation
      return new Response(this.getApiDocumentation(), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
      });

    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleConversionRequest(
    request: Request, 
    env: Env, 
    corsHeaders: Record<string, string>,
    sourceProvider: string,
    targetProvider: string,
    subPath: string
  ): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders });
    }

    // Validate providers
    const sourceTransformer = this.transformers.get(sourceProvider);
    const targetTransformer = this.transformers.get(targetProvider);
    const targetProviderConfig = this.providers.get(targetProvider);

    if (!sourceTransformer || !targetTransformer || !targetProviderConfig) {
      return new Response(JSON.stringify({ 
        error: `Invalid provider combination: ${sourceProvider} -> ${targetProvider}` 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      const requestBody = await request.json();
      
      // Get API key
      const authHeader = request.headers.get('Authorization');
      const apiKey = authHeader?.replace('Bearer ', '') || this.getApiKey(targetProvider, env);
      
      if (!apiKey) {
        return new Response(JSON.stringify({ 
          error: `Missing API key for ${targetProvider}` 
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Handle streaming
      if (requestBody.stream) {
        return await this.handleStreamingRequest(
          requestBody,
          sourceTransformer,
          targetTransformer,
          targetProviderConfig,
          apiKey,
          subPath,
          corsHeaders
        );
      }

      // Non-streaming handling
      let transformedRequest;
      
      if (sourceProvider === targetProvider) {
        // Same provider - pass through
        transformedRequest = requestBody;
      } else {
        // Cross-provider transformation
        const unifiedRequest = await sourceTransformer.transformRequestOut(requestBody);
        transformedRequest = await targetTransformer.transformRequestIn(unifiedRequest);
      }

      // Make request to target provider
      const response = await this.makeProviderRequest(
        targetProviderConfig, 
        transformedRequest, 
        apiKey,
        subPath
      );

      if (!response.ok) {
        const errorText = await response.text();
        return new Response(errorText, {
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const responseData = await response.json();

      // Transform response if needed
      if (sourceProvider !== targetProvider) {
        const unifiedResponse = await targetTransformer.transformResponseOut(responseData);
        const finalResponse = await sourceTransformer.transformResponseIn(unifiedResponse);
        
        return new Response(JSON.stringify(finalResponse), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      } else {
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

    } catch (error) {
      console.error(`Conversion error (${sourceProvider}->${targetProvider}):`, error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Conversion failed' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }

  private async handleStreamingRequest(
    requestBody: any,
    sourceTransformer: BaseTransformer,
    targetTransformer: BaseTransformer,
    targetProvider: Provider,
    apiKey: string,
    subPath: string,
    corsHeaders: Record<string, string>
  ): Promise<Response> {
    // Transform request if needed
    let transformedRequest;
    if (sourceTransformer.name === targetTransformer.name) {
      transformedRequest = requestBody;
    } else {
      const unifiedRequest = await sourceTransformer.transformRequestOut(requestBody);
      transformedRequest = await targetTransformer.transformRequestIn(unifiedRequest);
    }

    const response = await this.makeProviderRequest(
      targetProvider,
      transformedRequest,
      apiKey,
      subPath
    );

    // For streaming, if no transformation needed, pass through
    if (sourceTransformer.name === targetTransformer.name) {
      const headers = {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      };
      return new Response(response.body, { status: response.status, headers });
    }

    // For cross-provider streaming, we need to transform the stream
    // For now, disable streaming and use non-streaming response
    if (!response.ok) {
      const errorText = await response.text();
      return new Response(errorText, {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Convert to non-streaming response for proper transformation
    const responseData = await response.json();
    const unifiedResponse = await targetTransformer.transformResponseOut(responseData);
    const finalResponse = await sourceTransformer.transformResponseIn(unifiedResponse);
    
    return new Response(JSON.stringify(finalResponse), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  private async makeProviderRequest(
    provider: Provider,
    requestData: any,
    apiKey: string,
    subPath: string
  ): Promise<Response> {
    let endpoint: string;
    
    if (provider.name === 'anthropic') {
      // Anthropic API: always use /messages endpoint
      endpoint = `${provider.baseUrl}/messages`;
    } else if (provider.name === 'openrouter') {
      // OpenRouter API: baseUrl already includes /v1/chat/completions
      endpoint = provider.baseUrl;
    } else {
      // Generic provider: append subPath
      endpoint = subPath === 'messages' ? provider.baseUrl : `${provider.baseUrl}/${subPath}`;
    }
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };

    // Add provider-specific headers
    if (provider.name === 'anthropic') {
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider.name === 'openrouter') {
      headers['HTTP-Referer'] = 'https://llm-proxy.workers.dev';
      headers['X-Title'] = 'LLM Proxy Service';
    }

    return await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestData)
    });
  }

  private getApiKey(providerName: string, env: Env): string {
    switch (providerName) {
      case 'openrouter':
        return env.OPENROUTER_API_KEY || '';
      case 'anthropic':
        return env.ANTHROPIC_API_KEY || '';
      default:
        return '';
    }
  }

  private getApiDocumentation(): string {
    return `LLM Proxy Service

Endpoint Pattern:
POST /from-{source}/to-{target}/{subpath}

Examples:
• POST /from-anthropic/to-openrouter/messages
  Convert Anthropic format to OpenRouter format
  
• POST /from-openrouter/to-anthropic/messages  
  Convert OpenRouter format to Anthropic format
  
• POST /from-anthropic/to-anthropic/messages
  Direct Anthropic API proxy

Supported Providers:
• anthropic: Direct Anthropic API  
• openrouter: OpenRouter proxy service

Authentication:
Use Authorization: Bearer <api-key> header
Or set environment variables: OPENROUTER_API_KEY, ANTHROPIC_API_KEY

Features:
• Automatic request/response format conversion
• Streaming support
• Tool calling support
• CORS enabled

Example:
curl -X POST https://your-worker.workers.dev/from-anthropic/to-openrouter/messages \\
  -H "Authorization: Bearer your-openrouter-key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "claude-sonnet-4",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 1000
  }'`;
  }
}

const proxyService = new LLMProxyService();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return proxyService.handleRequest(request, env);
  },
};