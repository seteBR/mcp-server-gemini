#!/usr/bin/env node
import { GoogleGenerativeAI } from '@google/generative-ai';
import WebSocket, { WebSocketServer } from 'ws';

interface MCPRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: any;
}

interface MCPResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

type MCPError = {
  code: number;
  message: string;
};

class MCPServer {
  private wss: WebSocketServer;
  private model: any;
  private debug: boolean;

  constructor(apiKey: string, port: number = 3005) {
    this.debug = process.env.DEBUG === 'true';
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(apiKey);
    this.model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro-exp-03-25' });

    // Initialize WebSocket server
    this.wss = new WebSocketServer({ port });
    this.log(`MCP Server starting on port ${port}`);

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log('[MCP Debug]', ...args);
    }
  }

  private async handleConnection(ws: WebSocket) {
    this.log('New client connected');

    ws.on('message', async (data: WebSocket.RawData) => {
      try {
        const message = data.toString();
        this.log('Received message:', message);

        let parsedRequest: MCPRequest;
        try {
          parsedRequest = JSON.parse(message);
        } catch (parseError) {
          this.sendError(ws, null, -32700, 'Parse error');
          return;
        }

        const response = await this.handleRequest(parsedRequest);
        this.log('Sending response:', response);
        ws.send(JSON.stringify(response));
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        this.log('Error handling message:', errorMessage);
        this.sendError(ws, null, -32603, 'Internal error');
      }
    });

    ws.on('error', (error: Error) => {
      this.log('WebSocket error:', error.message);
    });

    ws.on('close', () => {
      this.log('Client disconnected');
    });
  }

  private async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    this.log('Handling request:', request.method);

    switch (request.method) {
      case 'initialize':
        return this.handleInitialize(request);
      
      case 'generate':
        return this.handleGenerate(request);
      
      default:
        return this.createErrorResponse(request.id, -32601, 'Method not found');
    }
  }

  private handleInitialize(request: MCPRequest): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'gemini-mcp',
          version: '1.0.0'
        },
        capabilities: {
          experimental: {},
          prompts: { listChanged: true },
          resources: { subscribe: true }
        }
      }
    };
  }

  private async handleGenerate(request: MCPRequest): Promise<MCPResponse> {
    if (!request.params?.prompt) {
      return this.createErrorResponse(request.id, -32602, 'Missing prompt parameter');
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
            provider: 'google'
          }
        }
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.log('Gemini API error:', errorMessage);
      return this.createErrorResponse(
        request.id,
        -32603,
        `Gemini API error: ${errorMessage}`
      );
    }
  }

  private handleServerError(error: Error) {
    this.log('Server error:', error.message);
  }

  private createErrorResponse(id: number | string | null, code: number, message: string): MCPResponse {
    return {
      jsonrpc: '2.0',
      id: id || 0,
      error: {
        code,
        message
      }
    };
  }

  private sendError(ws: WebSocket, id: number | string | null, code: number, message: string) {
    const errorResponse = this.createErrorResponse(id, code, message);
    ws.send(JSON.stringify(errorResponse));
  }
}

// Start server
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY environment variable is required');
  process.exit(1);
}

const port = parseInt(process.env.PORT || '3005', 10);
new MCPServer(apiKey, port);
