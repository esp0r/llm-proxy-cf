// Simplified transformers for the new endpoint structure

export interface TransformRequest {
  model: string;
  messages: any[];
  max_tokens?: number;
  temperature?: number;
  stream?: boolean;
  tools?: any[];
  [key: string]: any;
}

export interface TransformResponse {
  id: string;
  model?: string;
  content: any;
  usage?: any;
  [key: string]: any;
}

export abstract class BaseTransformer {
  abstract name: string;
  
  // Transform request from source format to unified format
  abstract transformRequestOut(request: any): Promise<TransformRequest>;
  
  // Transform unified format to provider format
  abstract transformRequestIn(request: TransformRequest): Promise<any>;
  
  // Transform provider response to unified format
  abstract transformResponseOut(response: any): Promise<TransformResponse>;
  
  // Transform unified format back to source format
  abstract transformResponseIn(response: TransformResponse): Promise<any>;
}

export class AnthropicTransformer extends BaseTransformer {
  name = 'anthropic';

  async transformRequestOut(request: any): Promise<TransformRequest> {
    // Anthropic to unified
    return {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      stream: request.stream,
      tools: request.tools
    };
  }

  async transformRequestIn(request: TransformRequest): Promise<any> {
    // Unified to Anthropic (pass through)
    return request;
  }

  async transformResponseOut(response: any): Promise<TransformResponse> {
    // Anthropic response to unified
    if (typeof response === 'string') {
      response = JSON.parse(response);
    }
    
    return {
      id: response.id,
      model: response.model,
      content: response.content,
      usage: response.usage
    };
  }

  async transformResponseIn(response: TransformResponse): Promise<any> {
    // Unified to Anthropic format
    return {
      id: response.id || `msg_${Math.random().toString(36).slice(2)}`,
      type: 'message',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: response.content || ''
        }
      ],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0
      }
    };
  }
}

export class OpenRouterTransformer extends BaseTransformer {
  name = 'openrouter';

  async transformRequestOut(request: any): Promise<TransformRequest> {
    // OpenRouter to unified (OpenAI format)
    return {
      model: request.model,
      messages: request.messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      stream: request.stream,
      tools: request.tools
    };
  }

  async transformRequestIn(request: TransformRequest): Promise<any> {
    // Unified to OpenRouter
    return {
      model: this.mapModelName(request.model),
      messages: this.transformMessagesToOpenAI(request.messages),
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature || 0.7,
      top_p: request.top_p,
      stream: request.stream || false,
      tools: this.transformToolsToOpenAI(request.tools),
    };
  }

  async transformResponseOut(response: any): Promise<TransformResponse> {
    // OpenRouter response to unified
    const data = typeof response === 'string' ? JSON.parse(response) : response;
    
    return {
      id: data.id,
      model: data.model,
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage
    };
  }

  async transformResponseIn(response: TransformResponse): Promise<any> {
    // Unified to OpenRouter - convert to Claude format
    return this.convertToClaude(response);
  }

  private mapModelName(model: string): string {
    if (!model.startsWith('claude-')) {
      return model;
    }
    
    if (model.startsWith('claude-opus-4')) {
      return 'anthropic/claude-opus-4';
    } else {
      return 'anthropic/claude-sonnet-4';
    }
  }

  private transformMessagesToOpenAI(messages: any[]): any[] {
    return messages.map(message => {
      if (!Array.isArray(message.content)) {
        return message;
      }
      
      let content = '';
      let tool_call_id = '';
      let isToolResult = false;
      
      for (const block of message.content) {
        if (block.type === 'text') {
          content += block.text;
        } else if (block.type === 'tool_result') {
          isToolResult = true;
          tool_call_id = block.tool_use_id;
          content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
        }
      }
      
      if (isToolResult) {
        return {
          role: 'tool',
          tool_call_id: tool_call_id,
          content: content
        };
      }
      
      return {
        ...message,
        content: content || message.content
      };
    });
  }

  private transformToolsToOpenAI(tools: any[] | undefined): any[] | undefined {
    if (!tools) return undefined;
    
    return tools.map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema
      }
    }));
  }

  private convertToClaude(openaiResponse: any): any {
    const contentBlocks = [];
    
    if (openaiResponse.content) {
      contentBlocks.push({
        type: 'text',
        text: openaiResponse.content
      });
    }
    
    if (!contentBlocks.length) {
      contentBlocks.push({ type: 'text', text: '' });
    }
    
    return {
      id: openaiResponse.id || `msg_${Math.random().toString(36).slice(2)}`,
      type: 'message',
      role: 'assistant',
      model: openaiResponse.model,
      content: contentBlocks,
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: openaiResponse.usage?.prompt_tokens || 0,
        output_tokens: openaiResponse.usage?.completion_tokens || 0
      }
    };
  }
}