export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      if (url.pathname.startsWith('/v1/claude-to-openrouter')) {
        return await handleClaudeToOpenRouter(request, env, corsHeaders);
      } else if (url.pathname.startsWith('/v1/claude-proxy')) {
        return await handleClaudeProxy(request, corsHeaders);
      } else {
        return new Response('LLM Proxy Service\n\nEndpoints:\n- POST /v1/claude-to-openrouter/messages (使用 Claude API 格式和 Authorization header)\n- POST /v1/claude-proxy/messages (直接代理 Claude API)', {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'text/plain' }
        });
      }
    } catch (error) {
      console.error('Error:', error);
      return new Response(JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Internal server error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

interface Env {
  OPENROUTER_API_KEY?: string;
}

function convertOpenAIToClaude(openaiResponse: any, originalRequest: any): any {
  const choices = openaiResponse.choices || [];
  if (!choices.length) {
    throw new Error('No choices in OpenAI response');
  }

  const choice = choices[0];
  const message = choice.message || {};
  
  const contentBlocks = [];
  
  if (message.content) {
    contentBlocks.push({
      type: 'text',
      text: message.content
    });
  }
  
  const toolCalls = message.tool_calls || [];
  for (const toolCall of toolCalls) {
    if (toolCall.type === 'function') {
      let input = {};
      try {
        input = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        input = { raw_arguments: toolCall.function.arguments || '' };
      }
      
      contentBlocks.push({
        type: 'tool_use',
        id: toolCall.id || `tool_${Math.random().toString(36).slice(2)}`,
        name: toolCall.function.name || '',
        input: input
      });
    }
  }
  
  if (!contentBlocks.length) {
    contentBlocks.push({ type: 'text', text: '' });
  }
  
  const finishReason = choice.finish_reason || 'stop';
  const stopReason = {
    'stop': 'end_turn',
    'length': 'max_tokens', 
    'tool_calls': 'tool_use',
    'function_call': 'tool_use'
  }[finishReason] || 'end_turn';
  
  return {
    id: openaiResponse.id || `msg_${Math.random().toString(36).slice(2)}`,
    type: 'message',
    role: 'assistant',
    model: originalRequest.model,
    content: contentBlocks,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: openaiResponse.usage?.prompt_tokens || 0,
      output_tokens: openaiResponse.usage?.completion_tokens || 0
    }
  };
}

async function handleClaudeToOpenRouter(request: Request, env: Env, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: '需要有效的 Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 从 Authorization header 中提取 OpenRouter API Key
  // 格式: "Bearer sk-or-v1-your-openrouter-key"
  const openRouterKey = authHeader.replace('Bearer ', '');

  const claudeRequest = await request.json() as any;
  
  // 转换Claude模型名到OpenRouter格式
  function mapModelName(model: string): string {
    if (!model.startsWith('claude-')) {
      return model;
    }
    
    // 提取模型前缀，去掉版本号和别名后缀
    if (model.startsWith('claude-opus-4')) {
      return 'anthropic/claude-opus-4';
    } else if (model.startsWith('claude-sonnet-4')) {
      return 'anthropic/claude-sonnet-4';
    } else if (model.startsWith('claude-3-7-sonnet')) {
      return 'anthropic/claude-3.7-sonnet';
    } else if (model.startsWith('claude-3-5-sonnet')) {
      return 'anthropic/claude-3.5-sonnet';
    } else if (model.startsWith('claude-3-5-haiku')) {
      return 'anthropic/claude-3.5-haiku';
    } else if (model.startsWith('claude-3-opus')) {
      return 'anthropic/claude-3-opus';
    } else if (model.startsWith('claude-3-sonnet')) {
      return 'anthropic/claude-3-sonnet';
    } else if (model.startsWith('claude-3-haiku')) {
      return 'anthropic/claude-3-haiku';
    }
    
    // 默认情况：直接加前缀
    return `anthropic/${model}`;
  }
  
  const openRouterRequest = {
    model: mapModelName(claudeRequest.model),
    messages: claudeRequest.messages,
    max_tokens: claudeRequest.max_tokens || 4096,
    temperature: claudeRequest.temperature || 0.7,
    top_p: claudeRequest.top_p,
    stream: claudeRequest.stream || false,
  };

  Object.keys(openRouterRequest).forEach(key => {
    if (openRouterRequest[key as keyof typeof openRouterRequest] === undefined) {
      delete openRouterRequest[key as keyof typeof openRouterRequest];
    }
  });

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': request.headers.get('referer') || 'https://your-domain.com',
      'X-Title': 'LLM Proxy Service'
    },
    body: JSON.stringify(openRouterRequest)
  });

  if (!response.ok) {
    const errorText = await response.text();
    return new Response(errorText, {
      status: response.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const openaiResponse = await response.json();
  const claudeResponse = convertOpenAIToClaude(openaiResponse, claudeRequest);
  
  return new Response(JSON.stringify(claudeResponse), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    }
  });
}

async function handleClaudeProxy(request: Request, corsHeaders: Record<string, string>): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: '需要 Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const claudeRequest = await request.text();
  
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    },
    body: claudeRequest
  });

  const responseData = await response.text();
  
  return new Response(responseData, {
    status: response.status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    }
  });
}