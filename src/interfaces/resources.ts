import { MCPRequest, MCPResponse } from '../types';

export interface Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceTemplate {
  uriTemplate: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ListResourcesRequest extends MCPRequest {
  method: 'resources/list';
}

export interface ListResourcesResponse extends MCPResponse {
  result: {
    resources: Resource[];
  };
}

export interface ReadResourceRequest extends MCPRequest {
  method: 'resources/read';
  params: {
    uri: string;
  };
}

export interface ResourceContent {
  uri: string;
  mimeType?: string;
  content: string;
}

export interface ReadResourceResponse extends MCPResponse {
  result: {
    contents: ResourceContent[];
  };
}