import WebSocket, { WebSocketServer } from 'ws'; // Import WebSocketServer
import { GoogleGenerativeAI } from '@google/generative-ai';
import { MCPHandlers } from './handlers.js'; // Added .js
import { ProtocolManager, ERROR_CODES } from './protocol.js'; // Added .js
import { MCPRequest, MCPResponse, NotificationMessage, ConnectionState, MCPError } from './types.js'; // Added MCPError and .js
import http from 'http';

export class MCPServer {
  private wss: WebSocketServer; // Use WebSocketServer type
  private protocol: ProtocolManager;
  private handlers: MCPHandlers;
  private clients: Map<WebSocket, ConnectionState>;
  private httpServer: http.Server;
  private startTime: Date;
  private debug: boolean;

  constructor(apiKey: string, port: number = 3005) {
    this.debug = process.env.DEBUG === 'true';
    this.log(`Starting Gemini MCP Server... Debug: ${this.debug}`);

    if (!apiKey) {
      console.error('FATAL: GEMINI_API_KEY is missing.');
      process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Consider making the model configurable via env var or config file
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' }); // Use a stable model like gemini-pro

    this.protocol = new ProtocolManager();
    this.handlers = new MCPHandlers(model, this.protocol, this.debug);
    this.clients = new Map();
    this.startTime = new Date();

    // Listen for responses from handlers (especially for streaming)
    this.handlers.on('response', (response: MCPResponse) => {
      const client = this.findClientById(response.id);
      if (client) {
        this.sendMessage(client, response);
      } else {
        this.log(`Warning: Client not found for response ID ${response.id}`);
      }
    });

    this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer }); // Use WebSocketServer

    this.setupWebSocketServer();

    this.httpServer.listen(port, () => {
      console.log(`MCP Server listening on port ${port}`);
      this.log(`Health check available at http://localhost:${port}/health`);
    });
  }

  private log(...args: any[]) {
    // Add timestamp to logs
    const timestamp = new Date().toISOString();
    if (this.debug) {
      console.log(`[MCP Debug ${timestamp}]`, ...args);
    }
  }

  private findClientById(responseId: string | number): WebSocket | null {
    for (const [client, state] of this.clients.entries()) {
      if (state.activeRequests.has(responseId)) {
        return client;
      }
    }
    // Special case for stream final chunk (original request ID might be removed)
    // This needs a more robust way to map stream responses back to clients if needed
    // For now, assume the last client that initiated the stream ID is the target
    // This is NOT reliable if multiple clients stream simultaneously with the same ID logic.
    // A better approach would be to store the WebSocket instance with the AbortController.
    return null; // Needs improvement for robust stream handling
  }


  private handleHttpRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.url === '/health' && req.method === 'GET') {
      const uptime = (new Date().getTime() - this.startTime.getTime()) / 1000;
      const status = {
        status: 'healthy',
        uptime: uptime.toFixed(2),
        activeConnections: this.clients.size,
        version: process.env.npm_package_version || '1.0.0' // Read from package.json if available
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }

  private setupWebSocketServer(): void {
    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', this.handleServerError.bind(this));
    setInterval(this.monitorConnections.bind(this), 60000); // Check every 60 seconds
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // --- Fix for Error 1: Handle potential string array from x-forwarded-for ---
    let rawIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    let clientIp: string;
    if (Array.isArray(rawIp)) {
      clientIp = rawIp[0]; // Take the first IP if it's an array
    } else {
      clientIp = rawIp;
    }
    // --- End Fix ---
    this.log(`New connection established from IP: ${clientIp}`);

    const state: ConnectionState = {
      connectedAt: new Date(),
      lastMessageAt: new Date(),
      initialized: false,
      activeRequests: new Set(),
      ip: clientIp // Now guaranteed to be a string
    };
    this.clients.set(ws, state);

    ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
      state.lastMessageAt = new Date(); // Update timestamp on any message
      if (isBinary) {
        this.log(`Received binary data from ${state.ip}, ignoring.`);
        // Optionally send an error if binary is unexpected
        // this.sendError(ws, null, ERROR_CODES.INVALID_REQUEST, "Binary messages not supported");
        return;
      }

      const message = data.toString();
      let request: MCPRequest | null = null; // Initialize request as null

      try {
        request = JSON.parse(message);
        this.log(`Received request from ${state.ip}:`, JSON.stringify(request)); // Log parsed request

        // Basic validation
        if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0' || !request.method || !request.id) {
          throw this.createError(ERROR_CODES.INVALID_REQUEST, 'Invalid MCP request structure');
        }

        this.protocol.validateState(request.method); // Check if initialized, etc.

        if (request.method === 'initialize') {
          state.initialized = true; // Mark client as initialized
        }

        state.activeRequests.add(request.id); // Track active request ID

        // Handle request using the handler class
        const response = await this.handlers.handleRequest(request);

        // If response is null, it means it's a stream handled by events
        if (response) {
          this.sendMessage(ws, response);
        }

      } catch (error) {
        // Handle errors thrown during validation or request handling
        this.handleError(ws, request?.id ?? null, error); // Pass ID if available
      } finally {
        // Remove request ID only if it was successfully added
        if (request?.id) {
          state.activeRequests.delete(request.id);
        }
      }
    });

    ws.on('error', (error: Error) => {
      console.error(`WebSocket error from ${state.ip}:`, error.message);
      this.logError('connection', error, state);
      this.clients.delete(ws); // Clean up on error
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.log(`Connection closed from ${state.ip}. Code: ${code}, Reason: ${reason.toString()}`);
      // Cancel any pending requests for this client
      state.activeRequests.forEach((requestId: string | number) => { // Added type
        this.handlers.cancelRequest(requestId);
      });
      this.clients.delete(ws); // Clean up state
    });

    ws.on('pong', () => {
      state.lastMessageAt = new Date(); // Consider pong as activity
      this.log(`Received pong from ${state.ip}`);
    });

    // Optionally send a connection established notification (non-standard MCP)
    // this.sendMessage(ws, { jsonrpc: '2.0', method: 'server/connected', params: { serverId: 'gemini-mcp-...' } });
  }

  private handleError(ws: WebSocket, requestId: string | number | null, error: any): void {
    const state = this.clients.get(ws);
    this.logError('request', error, state);

    let code = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';

    if (error && typeof error === 'object') {
      if ('code' in error && typeof error.code === 'number') {
        code = error.code;
      }
      if ('message' in error && typeof error.message === 'string') {
        message = error.message;
      }
    } else if (typeof error === 'string') {
      message = error; // Use string directly if error is just a string
    }

    // Ensure we have a valid ID (use 0 or null if parsing failed early)
    const finalId = requestId ?? null;
    this.sendError(ws, finalId, code, message);
  }

  private handleServerError(error: Error): void {
    console.error('WebSocket Server Error:', error);
    this.logError('server', error);
    // Consider attempting to restart or log critical failure
  }

  private sendMessage(ws: WebSocket, message: MCPResponse | NotificationMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      this.log(`Sending message to ${this.clients.get(ws)?.ip}:`, payload);
      ws.send(payload);
    } else {
      this.log(`Attempted to send message to closed socket for IP: ${this.clients.get(ws)?.ip}`);
    }
  }

  private sendError(ws: WebSocket, id: string | number | null, code: number, message: string): void {
    const errorResponse: MCPResponse = {
      jsonrpc: '2.0',
      id: id ?? 0, // Use 0 if ID is null (e.g., parse error before ID is known)
      error: { code, message }
    };
    this.sendMessage(ws, errorResponse);
  }

  private monitorConnections(): void {
    const now = Date.now();
    this.log(`Monitoring ${this.clients.size} connections...`);
    this.clients.forEach((state, ws) => {
      // Check for stale connections (no message or pong in 5 minutes)
      const timeSinceLastActivity = (now - state.lastMessageAt.getTime());
      if (timeSinceLastActivity > 5 * 60 * 1000) { // 5 minutes
        this.log(`Closing stale connection from ${state.ip} (no activity for ${Math.round(timeSinceLastActivity / 1000)}s)`);
        ws.terminate(); // Force close unresponsive connection
        this.clients.delete(ws); // Clean up immediately
      } else if (ws.readyState === WebSocket.OPEN) {
        // Send ping to keep connection alive and check responsiveness
        this.log(`Pinging client ${state.ip}`);
        ws.ping();
      }
    });
  }

  private logError(type: string, error: Error, state?: ConnectionState): void {
    const errorLog = {
      timestamp: new Date().toISOString(),
      type, // 'connection', 'request', 'server'
      error: {
        name: error.name,
        message: error.message,
        stack: this.debug ? error.stack : undefined // Only include stack in debug mode
      },
      connectionInfo: state ? {
        ip: state.ip,
        connectedAt: state.connectedAt.toISOString(),
        lastMessageAt: state.lastMessageAt.toISOString(),
        initialized: state.initialized,
        activeRequestCount: state.activeRequests.size
      } : undefined
    };
    // Log as structured JSON for easier parsing
    console.error("MCP_ERROR:", JSON.stringify(errorLog));
  }

  broadcast(notification: NotificationMessage): void {
    this.log('Broadcasting notification:', notification.method);
    this.clients.forEach((state, client) => {
      this.sendMessage(client, notification);
    });
  }

  async shutdown(signal: string): Promise<void> {
    console.log(`Received ${signal}. Shutting down MCP server gracefully...`);
    this.protocol.requestShutdown();

    // Notify clients
    this.broadcast({
      jsonrpc: '2.0',
      method: 'server/shutdown', // Custom notification
      params: { message: 'Server is shutting down' }
    });

    // Close connections and cancel requests
    const closePromises: Promise<void>[] = [];
    this.clients.forEach((state, client) => {
      state.activeRequests.forEach((requestId: string | number) => { // Added type
        this.handlers.cancelRequest(requestId);
      });
      closePromises.push(new Promise(resolve => {
        client.on('close', resolve);
        client.close(1001, 'Server shutting down');
        // Set a timeout in case close event doesn't fire
        setTimeout(() => {
          client.terminate();
          resolve();
        }, 2000); // 2 second timeout
      }));
    });

    try {
      await Promise.all(closePromises);
      this.log('All client connections closed.');
    } catch (e) {
      this.log('Error during client connection closing:', e);
    }


    // Close servers
    await new Promise<void>(resolve => this.wss.close(err => {
      if (err) console.error("Error closing WebSocket server:", err);
      else this.log("WebSocket server closed.");
      resolve();
    }));
    await new Promise<void>(resolve => this.httpServer.close(err => {
      if (err) console.error("Error closing HTTP server:", err);
      else this.log("HTTP server closed.");
      resolve();
    }));

    console.log('MCP server shut down complete.');
    process.exit(0);
  }

  // Helper to create structured MCPError objects
  // --- Fix for Error 2: Added MCPError return type annotation ---
  private createError(code: number, message: string, data?: any): MCPError {
    return { code, message, data };
  }
  // --- End Fix ---
}
