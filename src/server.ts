import WebSocket from 'ws';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MCPHandlers } from './handlers';
import { ProtocolManager } from './protocol';
import { ERROR_CODES } from './protocol';
import { MCPRequest, NotificationMessage } from './types';

export class MCPServer {
  private wss: WebSocket.Server;
  private protocol: ProtocolManager;
  private handlers: MCPHandlers;
  private clients: Set<WebSocket>;

  constructor(apiKey: string, port: number = 3005) {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

    this.protocol = new ProtocolManager();
    this.handlers = new MCPHandlers(model, this.protocol);
    this.clients = new Set();

    this.wss = new WebSocket.Server({ port });
    this.setupWebSocketServer();
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));

    // Cleanup on process exit
    process.on('SIGINT', () => this.shutdown());
    process.on('SIGTERM', () => this.shutdown());
  }

  private handleConnection(ws: WebSocket): void {
    this.clients.add(ws);

    ws.on('message', async (data: WebSocket.RawData) => {
      try {
        const message = data.toString();
        const request: MCPRequest = JSON.parse(message);

        // Validate protocol state
        try {
          this.protocol.validateState(request.method);
        } catch (error) {
          this.sendError(ws, request.id, ERROR_CODES.SERVER_NOT_INITIALIZED, error.message);
          return;
        }

        const response = await this.handlers.handleRequest(request);
        ws.send(JSON.stringify(response));

      } catch (error) {
        this.handleError(ws, error);
      }
    });

    ws.on('error', (error: Error) => {
      console.error('WebSocket error:', error);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
    });
  }

  private handleError(ws: WebSocket, error: any): void {
    if (error instanceof SyntaxError) {
      this.sendError(ws, null, ERROR_CODES.PARSE_ERROR, 'Invalid JSON');
    } else if (error.code && ERROR_CODES[error.code]) {
      this.sendError(ws, null, error.code, error.message);
    } else {
      this.sendError(ws, null, ERROR_CODES.INTERNAL_ERROR, 'Internal server error');
    }
  }

  private sendError(ws: WebSocket, id: string | number | null, code: number, message: string): void {
    ws.send(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code, message }
    }));
  }

  broadcast(notification: NotificationMessage): void {
    const message = JSON.stringify(notification);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }

  async shutdown(): Promise<void> {
    this.protocol.requestShutdown();

    // Notify all clients
    this.broadcast({
      jsonrpc: '2.0',
      method: 'notifications/error',
      params: {
        code: ERROR_CODES.SERVER_NOT_INITIALIZED,
        message: 'Server shutting down'
      }
    });

    // Close all connections
    this.clients.forEach(client => client.close());
    
    // Close server
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    
    process.exit(0);
  }
}
