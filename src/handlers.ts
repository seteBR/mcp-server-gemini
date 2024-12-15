import { GenerativeModel } from '@google/generative-ai';
import { GenerateRequest, GenerateResponse, MCPRequest, MCPResponse } from './types';
import { createInitializeResult, ERROR_CODES } from './protocol';

export class MCPHandlers {
  constructor(private model: GenerativeModel, private debug: boolean = false) {}

  private log(...args: any[]) {
    if (this.debug) {
      console.log('[MCP Debug]', ...args);
    }
  }

  async handleInitialize(request: MCPRequest): Promise<MCPResponse> {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: createInitializeResult()
    };
  }

  async handleGenerate(request: GenerateRequest): Promise<GenerateResponse> {
    if (!request.params?.prompt) {
      throw new Error('Missing prompt parameter');
    }

    try {
      const result = await this.model.generateContent(request.params.prompt);
      const response = await result.response;

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          type: 'completion',
          content: response.text(),
          metadata: {
            model: 'gemini-pro',
            provider: 'google',
            temperature: request.params.temperature,
            maxTokens: request.params.maxTokens
          }
        }
      };
    } catch (error) {
      this.log('Generation error:', error);
      throw error;
    }
  }

  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    this.log('Handling request:', request.method);

    try {
      switch (request.method) {
        case 'initialize':
          return await this.handleInitialize(request);

        case 'generate':
          return await this.handleGenerate(request as GenerateRequest);

        default:
          throw new Error(`Method not found: ${request.method}`);
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Method not found')) {
          throw this.createError(ERROR_CODES.METHOD_NOT_FOUND, error.message);
        }
        if (error.message.includes('Missing prompt')) {
          throw this.createError(ERROR_CODES.INVALID_PARAMS, error.message);
        }
      }
      throw this.createError(ERROR_CODES.INTERNAL_ERROR, 'Internal server error');
    }
  }

  private createError(code: number, message: string) {
    return {
      code,
      message
    };
  }
}
