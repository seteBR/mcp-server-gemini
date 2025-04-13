this.httpServer.listen(port, () => {
  console.log(`MCP Server listening on port ${port}`); // <--- This one
  this.log(`Health check available at http://localhost:${port}/health`); // <--- This one uses this.log, which is debug-gated
});

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
    this.log(`Starting Gemini MCP Server... Debug: ${this.debug}`); // Log uses console.error if debug is true

    if (!apiKey) {
      console.error('FATAL: GEMINI_API_KEY is missing.');
      process.exit(1);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use a stable, generally available model like gemini-pro
    // const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash-latest' }); // Example: Use 1.5 Flash
    // Or keep gemini-pro if 1.5 isn't needed or causes issues
    const model = genAI.getGenerativeModel({ model: 'gemini-pro' });


    this.protocol = new ProtocolManager();
    this.handlers = new MCPHandlers(model, this.protocol, this.debug);
    this.clients = new Map();
    this.startTime = new Date();

    // Listen for responses from handlers (especially for streaming)
    this.handlers.on('response', (response: MCPResponse) => {
      // Find the client associated with this response ID
      let targetClient: WebSocket | null = null;
      for (const [client, state] of this.clients.entries()) {
        // Check if the client has this request ID active
        // This is crucial for routing stream chunks back correctly
        if (state.activeRequests.has(response.id)) {
          targetClient = client;
          break;
        }
      }

      if (targetClient) {
        this.sendMessage(targetClient, response);
        // If it's the final stream chunk, remove the ID from active requests
        if (response.result?.type === 'stream' && response.result?.done) {
          const state = this.clients.get(targetClient);
          if (state) {
            state.activeRequests.delete(response.id);
            this.log(`Removed completed stream request ID ${response.id} for client ${state.ip}`);
          }
        }
      } else {
        this.log(`Warning: Client not found for response ID ${response.id}. Could be a completed/cancelled request or final stream chunk.`);
        // Attempting to find based on ID might fail for the *final* stream chunk if the ID was already removed.
        // A more robust mapping might be needed if this becomes an issue.
      }
    });


    this.httpServer = http.createServer(this.handleHttpRequest.bind(this));
    this.wss = new WebSocketServer({ server: this.httpServer }); // Use WebSocketServer

    this.setupWebSocketServer();

    this.httpServer.listen(port, () => {
      // Use console.error for server status messages to avoid interfering with stdout capture
      console.error(`MCP Server listening on port ${port}`);
      if (this.debug) {
        console.error(`Health check available at http://localhost:${port}/health`);
      }
    });
  }

  private log(...args: any[]) {
    // Add timestamp to logs
    const timestamp = new Date().toISOString();
    if (this.debug) {
      // Use console.error for debug logs to keep stdout clean for potential IPC
      console.error(`[MCP Debug ${timestamp}]`, ...args);
    }
  }

  // --- Removed findClientById as logic moved into the 'response' event handler ---

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
    let rawIp = req.socket.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
    let clientIp: string;
    if (Array.isArray(rawIp)) {
      clientIp = rawIp[0]; // Take the first IP if it's an array
    } else {
      clientIp = rawIp;
    }
    this.log(`New connection established from IP: ${clientIp}`);

    const state: ConnectionState = {
      connectedAt: new Date(),
      lastMessageAt: new Date(),
      initialized: false,
      activeRequests: new Set(),
      ip: clientIp
    };
    this.clients.set(ws, state);

    ws.on('message', async (data: WebSocket.RawData, isBinary: boolean) => {
      state.lastMessageAt = new Date();
      if (isBinary) {
        this.log(`Received binary data from ${state.ip}, ignoring.`);
        return;
      }

      const message = data.toString();
      let request: MCPRequest | null = null;

      try {
        request = JSON.parse(message);
        // Avoid logging potentially large params in production/non-debug
        if (this.debug) {
          this.log(`Received request from ${state.ip}:`, JSON.stringify(request));
        } else if (request) {
          this.log(`Received request from ${state.ip}: Method=${request.method}, ID=${request.id}`);
        }


        if (!request || typeof request !== 'object' || request.jsonrpc !== '2.0') {
          throw this.createError(ERROR_CODES.INVALID_REQUEST, 'Invalid JSON-RPC structure');
        }
        if (typeof request.method !== 'string') {
          throw this.createError(ERROR_CODES.INVALID_REQUEST, 'Invalid method (must be string)');
        }
        if (!('id' in request)) { // Notifications don't have ID, but requests do
          // Handle notifications if necessary, otherwise ignore/error
          if (request.method === 'exit') {
            this.log(`Received exit notification from ${state.ip}. Closing connection.`);
            ws.close();
            return; // Stop processing this message
          } else {
            this.log(`Received notification without ID from ${state.ip}: ${request.method}. Ignoring.`);
            return; // Stop processing this message
          }
        }
        if (typeof request.id !== 'string' && typeof request.id !== 'number') {
          throw this.createError(ERROR_CODES.INVALID_REQUEST, 'Invalid request ID (must be string or number)');
        }


        this.protocol.validateState(request.method);

        if (request.method === 'initialize') {
          // Ensure initialize is only called once per connection
          if (state.initialized) {
            throw this.createError(ERROR_CODES.INVALID_REQUEST, 'Server already initialized for this connection');
          }
          state.initialized = true;
          this.log(`Client ${state.ip} initialized.`);
        } else if (!state.initialized && request.method !== 'shutdown' && request.method !== 'exit') {
          // Allow shutdown/exit even if not initialized, reject others
          throw this.createError(ERROR_CODES.SERVER_NOT_INITIALIZED, 'Server not initialized');
        }


        state.activeRequests.add(request.id); // Track active request ID

        const response = await this.handlers.handleRequest(request);

        // If response is NOT null (i.e., not a stream start), send it back
        if (response) {
          this.sendMessage(ws, response);
          // Request is complete, remove ID for non-streaming requests
          state.activeRequests.delete(request.id);
          this.log(`Removed completed request ID ${request.id} for client ${state.ip}`);
        } else {
          // Stream started, ID remains in activeRequests until final chunk event
          this.log(`Stream started for request ID ${request.id} for client ${state.ip}`);
        }

      } catch (error) {
        // Handle errors thrown during validation or request handling
        this.handleError(ws, request?.id ?? null, error);
        // Ensure request ID is removed even if handling failed
        if (request?.id && state.activeRequests.has(request.id)) {
          state.activeRequests.delete(request.id);
          this.log(`Removed failed request ID ${request.id} for client ${state.ip}`);
        }
      }
      // --- Removed finally block as ID removal is now handled based on response type ---
    });

    ws.on('error', (error: Error) => {
      console.error(`WebSocket error from ${state.ip}:`, error.message);
      this.logError('connection', error, state);
      this.cleanUpClient(ws, state); // Use cleanup function
    });

    ws.on('close', (code: number, reason: Buffer) => {
      this.log(`Connection closed from ${state.ip}. Code: ${code}, Reason: ${reason.toString()}`);
      this.cleanUpClient(ws, state); // Use cleanup function
    });

    ws.on('pong', () => {
      state.lastMessageAt = new Date();
      this.log(`Received pong from ${state.ip}`);
    });
  }

  // Helper function to clean up client state and cancel requests
  private cleanUpClient(ws: WebSocket, state: ConnectionState | undefined): void {
    if (!state) {
      // Find state if not passed directly (e.g., from error handler)
      state = this.clients.get(ws);
    }
    if (state) {
      this.log(`Cleaning up client state for ${state.ip}`);
      // Cancel any pending requests for this client
      state.activeRequests.forEach((requestId: string | number) => {
        this.log(`Cancelling request ${requestId} for disconnected client ${state?.ip}`);
        this.handlers.cancelRequest(requestId);
      });
      this.clients.delete(ws); // Clean up state map
      this.log(`Client ${state.ip} removed. Total clients: ${this.clients.size}`);
    } else {
      this.log(`Attempted to clean up client, but state not found.`);
    }
  }


  private handleError(ws: WebSocket, requestId: string | number | null, error: any): void {
    const state = this.clients.get(ws);
    this.logError('request', error, state);

    let code = ERROR_CODES.INTERNAL_ERROR;
    let message = 'Internal server error';
    let data: any = undefined;

    if (error && typeof error === 'object') {
      if ('code' in error && typeof error.code === 'number') {
        code = error.code;
      }
      if ('message' in error && typeof error.message === 'string') {
        message = error.message;
      }
      if ('data' in error) {
        data = error.data; // Include data if present in the error object
      }
      // Add specific check for Gemini API errors if not already structured
      if (message.startsWith('Gemini API Error:') && code === ERROR_CODES.INTERNAL_ERROR) {
        code = ERROR_CODES.GEMINI_API_ERROR; // Use a more specific code if possible
      }

    } else if (typeof error === 'string') {
      message = error;
    } else {
      // Ensure we log the original error structure if it wasn't parsed
      console.error("Unhandled error type:", error);
    }


    // Use null for id if the request ID was invalid or parsing failed early
    const finalId = (typeof requestId === 'string' || typeof requestId === 'number') ? requestId : null;
    this.sendError(ws, finalId, code, message, data);
  }

  private handleServerError(error: Error): void {
    console.error('WebSocket Server Error:', error);
    this.logError('server', error);
  }

  private sendMessage(ws: WebSocket, message: MCPResponse | NotificationMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      const payload = JSON.stringify(message);
      if (this.debug) {
        this.log(`Sending message to ${this.clients.get(ws)?.ip}:`, payload);
      } else {
        this.log(`Sending message to ${this.clients.get(ws)?.ip}: Method=${message.method || 'response'}, ID=${(message as MCPResponse).id ?? 'N/A'}`);
      }
      ws.send(payload);
    } else {
      this.log(`Attempted to send message to closed socket for IP: ${this.clients.get(ws)?.ip}`);
    }
  }

  private sendError(ws: WebSocket, id: string | number | null, code: number, message: string, data?: any): void {
    // According to JSON-RPC 2.0 spec, id MUST be included in error responses
    // if it was present in the request. Use null if request id was invalid/missing.
    const errorResponse: MCPResponse = {
      jsonrpc: '2.0',
      id: id, // Use null if id wasn't available or valid
      error: { code, message, data } // Include data if provided
    };
    this.sendMessage(ws, errorResponse);
  }

  private monitorConnections(): void {
    const now = Date.now();
    this.log(`Monitoring ${this.clients.size} connections...`);
    this.clients.forEach((state, ws) => {
      const timeSinceLastActivity = (now - state.lastMessageAt.getTime());

      // Check readiness state before terminating or pinging
      if (ws.readyState === WebSocket.CLOSING || ws.readyState === WebSocket.CLOSED) {
        this.log(`Client ${state.ip} is already closing/closed. Removing.`);
        this.cleanUpClient(ws, state); // Ensure cleanup if missed
        return;
      }

      // Terminate stale connections (e.g., no message/pong for 5 minutes)
      if (timeSinceLastActivity > 5 * 60 * 1000) { // 5 minutes
        this.log(`Terminating stale connection from ${state.ip} (no activity for ${Math.round(timeSinceLastActivity / 1000)}s)`);
        ws.terminate(); // Force close unresponsive connection
        // No need to call cleanUpClient here, the 'close' event will handle it
      } else if (ws.readyState === WebSocket.OPEN) {
        // Send ping to keep connection alive and check responsiveness
        this.log(`Pinging client ${state.ip}`);
        ws.ping();
      }
    });
  }

  private logError(type: string, error: any, state?: ConnectionState): void {
    // Improved error logging
    let errorDetails: any = {};
    if (error instanceof Error) {
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: this.debug ? error.stack : undefined, // Only include stack in debug mode
        code: (error as any).code, // Include code if present
        data: (error as any).data // Include data if present
      };
    } else if (typeof error === 'object' && error !== null) {
      errorDetails = { ...error }; // Log the object structure
      if (!this.debug) delete errorDetails.stack; // Remove stack if not debugging
    }
    else {
      errorDetails = { message: String(error) }; // Convert non-objects to string
    }


    const errorLog = {
      timestamp: new Date().toISOString(),
      type, // 'connection', 'request', 'server'
      error: errorDetails,
      connectionInfo: state ? {
        ip: state.ip,
        connectedAt: state.connectedAt.toISOString(),
        lastMessageAt: state.lastMessageAt.toISOString(),
        initialized: state.initialized,
        activeRequestCount: state.activeRequests.size,
        activeRequestIds: this.debug ? Array.from(state.activeRequests) : undefined
      } : undefined
    };
    // Log as structured JSON to stderr for easier parsing by logging systems
    console.error("MCP_ERROR:", JSON.stringify(errorLog));
  }


  broadcast(notification: NotificationMessage): void {
    this.log('Broadcasting notification:', notification.method);
    const payload = JSON.stringify(notification);
    this.clients.forEach((state, client) => {
      if (client.readyState === WebSocket.OPEN) {
        this.log(`Broadcasting to ${state.ip}`);
        client.send(payload);
      } else {
        this.log(`Skipping broadcast to ${state.ip} (socket not open)`);
      }
    });
  }

  async shutdown(signal: string): Promise<void> {
    console.error(`Received ${signal}. Shutting down MCP server gracefully...`); // Log shutdown to stderr
    this.protocol.requestShutdown();

    // Notify clients (best effort)
    this.broadcast({
      jsonrpc: '2.0',
      method: 'server/shutdown', // Custom notification
      params: { message: 'Server is shutting down' }
    });

    // Close connections and cancel requests
    const closePromises: Promise<void>[] = [];
    this.log(`Closing ${this.clients.size} client connections...`);
    this.clients.forEach((state, client) => {
      // Cancel active requests before closing
      state.activeRequests.forEach((requestId: string | number) => {
        this.log(`Cancelling request ${requestId} during shutdown for client ${state.ip}`);
        this.handlers.cancelRequest(requestId);
      });

      closePromises.push(new Promise(resolve => {
        if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
          client.once('close', () => {
            this.log(`Client ${state.ip} connection closed.`);
            resolve();
          });
          client.close(1001, 'Server shutting down');
          // Set a timeout in case close event doesn't fire promptly
          setTimeout(() => {
            if (client.readyState !== WebSocket.CLOSED) {
              this.log(`Forcibly terminating connection for ${state.ip} after timeout.`);
              client.terminate();
            }
            resolve(); // Resolve even if terminate was needed
          }, 2000); // 2 second timeout
        } else {
          this.log(`Client ${state.ip} already closing/closed.`);
          resolve(); // Already closed or closing
        }
      }));
    });

    try {
      await Promise.all(closePromises);
      this.log('All client connections handled.');
    } catch (e) {
      this.log('Error during client connection closing:', e);
    } finally {
      this.clients.clear(); // Ensure map is cleared
    }


    // Close servers
    this.log("Closing WebSocket server...");
    await new Promise<void>(resolve => this.wss.close(err => {
      if (err) console.error("Error closing WebSocket server:", err);
      else this.log("WebSocket server closed.");
      resolve();
    }));

    this.log("Closing HTTP server...");
    await new Promise<void>(resolve => this.httpServer.close(err => {
      if (err) console.error("Error closing HTTP server:", err);
      else this.log("HTTP server closed.");
      resolve();
    }));

    console.error('MCP server shut down complete.'); // Log completion to stderr
    process.exit(0);
  }

  private createError(code: number, message: string, data?: any): MCPError {
    return { code, message, data };
  }
}
