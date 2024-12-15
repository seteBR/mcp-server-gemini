import { MCPRequest, MCPResponse } from '../types';

export interface CompletionRequest extends MCPRequest {
  method: 'completion/complete';
  params: {
    ref: ResourceReference | PromptReference;
    argument: CompletionArgument;
  };
}

export interface CompletionArgument {
  name: string;
  value: string;
}

export interface ResourceReference {
  type: 'ref/resource';
  uri: string;
}

export interface PromptReference {
  type: 'ref/prompt';
  name: string;
}

export interface Completion {
  values: string[];
  total?: number;
  hasMore?: boolean;
}

export interface CompletionResult extends MCPResponse {
  result: {
    completion: Completion;
  };
}