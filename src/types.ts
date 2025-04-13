// Base MCP Interfaces
export interface MCPMessage {
  jsonrpc: '2.0';
  id: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: MCPError;
}

export interface MCPRequest extends MCPMessage {
  method: string;
  params?: any; // Make params optional as not all requests have them (e.g., initialize)
}

export interface MCPResponse extends MCPMessage {
  // id is required in responses
  id: string | number;
  result?: any;
  error?: MCPError;
}

export interface MCPError {
  code: number;
  message: string;
  data?: any;
}

// Specific Request/Response Types
export interface InitializeRequest extends MCPRequest {
  method: 'initialize';
  params?: { // Params are optional for initialize
    clientInfo?: {
      name: string;
      version: string;
    };
    capabilities?: any; // Define more strictly if needed
  };
}

export interface InitializeResult {
  protocolVersion: string;
  serverInfo: ServerInfo;
  capabilities: ServerCapabilities;
}

export interface InitializeResponse extends MCPResponse {
  result: InitializeResult;
}

export interface GenerateRequest extends MCPRequest {
  method: 'generate';
  params: {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
  };
}

export interface GenerateResponse extends MCPResponse {
  result: {
    type: 'completion';
    content: string;
    metadata: {
      model: string;
      provider: string;
      temperature?: number;
      maxTokens?: number;
      stopSequences?: string[];
    };
  };
}

export interface StreamRequest extends MCPRequest {
  method: 'stream';
  params: {
    prompt: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    streamEvents?: boolean; // Example: If you want metadata events
  };
}

export interface StreamResponse extends MCPResponse {
  result: {
    type: 'stream';
    content: string;
    done: boolean;
    metadata?: {
      timestamp: number;
      model: string;
      tokens?: number;
    };
  };
}

export interface CancelRequest extends MCPRequest {
  method: 'cancel';
  params: {
    requestId: string | number;
  };
}

export interface CancelResponse extends MCPResponse {
  result: {
    cancelled: boolean;
  };
}

export interface ConfigureRequest extends MCPRequest {
  method: 'configure';
  params: {
    configuration: {
      model?: string;
      temperature?: number;
      maxTokens?: number;
      stopSequences?: string[];
      timeout?: number;
    };
  };
}

export interface ConfigureResponse extends MCPResponse {
  result: {
    configured: boolean;
  };
}

export interface ShutdownRequest extends MCPRequest {
  method: 'shutdown';
}

// Notifications (No ID)
export interface NotificationMessage {
  jsonrpc: '2.0';
  method: string;
  params?: any;
}

export interface ExitNotification extends NotificationMessage {
  method: 'exit';
}

export interface ErrorNotification extends NotificationMessage {
  method: 'notifications/error';
  params: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface ProgressParams {
  progressToken: string | number;
  progress: number; // e.g., percentage or current step
  total?: number;   // e.g., total steps
  message?: string; // Optional progress message
}

export interface ProgressNotification extends NotificationMessage {
  method: 'notifications/progress';
  params: ProgressParams;
}

// Server Information and Capabilities
export interface ServerInfo {
  name: string;
  version: string;
}

export interface ServerCapabilities {
  experimental?: Record<string, any>;
  prompts?: { listChanged?: boolean };
  resources?: { subscribe?: boolean; listChanged?: boolean };
  tools?: { listChanged?: boolean };
  logging?: Record<string, any>;
  // Add other capabilities as needed
}

// Connection State
export interface ConnectionState {
  connectedAt: Date;
  lastMessageAt: Date;
  initialized: boolean;
  activeRequests: Set<string | number>;
  ip: string;
}
