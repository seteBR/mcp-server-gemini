import { MCPRequest, MCPResponse } from '../types';

export interface PromptArgument {
  name: string;
  description?: string;
  required?: boolean;
}

export interface Prompt {
  name: string;
  description?: string;
  arguments?: PromptArgument[];
}

export interface ListPromptsRequest extends MCPRequest {
  method: 'prompts/list';
}

export interface ListPromptsResponse extends MCPResponse {
  result: {
    prompts: Prompt[];
  };
}

export interface GetPromptRequest extends MCPRequest {
  method: 'prompts/get';
  params: {
    name: string;
    arguments?: Record<string, string>;
  };
}

export interface PromptContent {
  type: 'text' | 'image' | 'resource';
  content: string;
  metadata?: Record<string, any>;
}

export interface GetPromptResponse extends MCPResponse {
  result: {
    description?: string;
    content: PromptContent[];
  };
}