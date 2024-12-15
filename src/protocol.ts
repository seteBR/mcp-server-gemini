import { ServerCapabilities, ServerInfo, InitializeResult } from './types';

export const PROTOCOL_VERSION = '2024-11-05';

export const ERROR_CODES = {
  PARSE_ERROR: -32700,        // Invalid JSON received
  INVALID_REQUEST: -32600,    // JSON not a valid request object
  METHOD_NOT_FOUND: -32601,   // Method does not exist
  INVALID_PARAMS: -32602,     // Invalid method parameters
  INTERNAL_ERROR: -32603,     // Internal JSON-RPC error
  SERVER_ERROR_START: -32099, // Server error start
  SERVER_ERROR_END: -32000,   // Server error end
  SERVER_NOT_INITIALIZED: -32002,  // Server not initialized
  UNKNOWN_ERROR: -32001       // Unknown error
} as const;

export const SERVER_INFO: ServerInfo = {
  name: 'gemini-mcp',
  version: '1.0.0'
};

export const SERVER_CAPABILITIES: ServerCapabilities = {
  experimental: {},
  prompts: {
    listChanged: true
  },
  resources: {
    subscribe: true,
    listChanged: true
  },
  tools: {
    listChanged: true
  }
};

export function createInitializeResult(): InitializeResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    serverInfo: SERVER_INFO,
    capabilities: SERVER_CAPABILITIES
  };
}
