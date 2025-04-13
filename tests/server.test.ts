// Note: Testing WebSocket servers directly can be complex.
// Consider using a library like 'ws' in client mode or 'mock-socket'.
// This is a simplified test focusing on instantiation and basic response.

import { describe, it, expect, jest, afterEach, beforeEach } from '@jest/globals';
import { MCPServer } from '../src/server.js'; // Added .js
import { WebSocket } from 'ws';
import http from 'http';

// Mock dependencies
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn().mockReturnValue({
      generateContent: jest.fn().mockResolvedValue({
        response: { text: () => 'Mock Gemini Response' }
      }),
      generateContentStream: jest.fn() // Add mocks for other methods used
    })
  }))
}));
jest.mock('../src/handlers.js', () => ({ // Mock handlers import
  MCPHandlers: jest.fn().mockImplementation(() => ({
    handleRequest: jest.fn((req) => {
      if (req.method === 'initialize') {
        return Promise.resolve({
          jsonrpc: '2.0', id: req.id, result: { protocolVersion: '2024-11-05', serverInfo: { name: 'mock-gemini-mcp', version: '1.0.0' }, capabilities: {} }
        });
      }
      if (req.method === 'generate') {
        return Promise.resolve({
          jsonrpc: '2.0', id: req.id, result: { type: 'completion', content: 'Mock handled response', metadata: {} }
        });
      }
      // Return error for unhandled methods in mock
      return Promise.reject({ code: -32601, message: 'Method not found in mock' });
    }),
    on: jest.fn(), // Mock event emitter 'on'
    // Add mocks for other methods if server calls them directly
  }))
}));


describe('MCP Server', () => {
  const TEST_API_KEY = 'test-key';
  const TEST_PORT = 3007; // Use a different port for each test suite run if needed
  let serverInstance: MCPServer | null = null;
  let httpServer: http.Server | null = null;

  // Helper function to start the server and get the http server instance
  const startServer = (port: number): Promise<http.Server> => {
    return new Promise((resolve) => {
      // MCPServer constructor now starts listening automatically
      serverInstance = new MCPServer(TEST_API_KEY, port);
      // Access the internal http server - THIS IS FRAGILE, depends on implementation detail
      httpServer = (serverInstance as any).httpServer;
      httpServer?.on('listening', () => resolve(httpServer!));
    });
  };

  // Helper function to stop the server
  const stopServer = async () => {
    if (serverInstance) {
      await (serverInstance as any).shutdown('test cleanup'); // Call internal shutdown
      serverInstance = null;
      httpServer = null; // httpServer is closed by shutdown
    }
    // Add a small delay to ensure ports are released
    await new Promise(resolve => setTimeout(resolve, 100));
  };

  beforeEach(async () => {
    // Ensure no server instance is running before each test
    await stopServer();
    // Mock console methods to prevent test output clutter
    jest.spyOn(console, 'log').mockImplementation(() => { });
    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
  });

  afterEach(async () => {
    await stopServer();
    jest.restoreAllMocks(); // Restore console mocks
  });

  it('should instantiate correctly', () => {
    const server = new MCPServer(TEST_API_KEY, TEST_PORT + 1); // Use different port
    expect(server).toBeDefined();
    // Need to manually shut down the instance created here if it starts listening
    return (server as any).shutdown('test cleanup');
  });

  it('should respond to /health check', async () => {
    httpServer = await startServer(TEST_PORT);
    const address = httpServer.address();
    const port = typeof address === 'string' ? TEST_PORT : address?.port ?? TEST_PORT;

    const response = await fetch(`http://localhost:${port}/health`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('status', 'healthy');
    expect(body).toHaveProperty('activeConnections', 0);
    expect(body).toHaveProperty('uptime');
  });


  it('should accept WebSocket connections', async () => {
    httpServer = await startServer(TEST_PORT);
    const address = httpServer.address();
    const port = typeof address === 'string' ? TEST_PORT : address?.port ?? TEST_PORT;

    const client = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve, reject) => {
      client.on('open', resolve);
      client.on('error', reject);
      setTimeout(() => reject(new Error('Connection timeout')), 2000); // Timeout
    });
    expect(client.readyState).toBe(WebSocket.OPEN);
    client.close();
  });

  it('should handle initialize request via WebSocket', async () => {
    httpServer = await startServer(TEST_PORT);
    const address = httpServer.address();
    const port = typeof address === 'string' ? TEST_PORT : address?.port ?? TEST_PORT;

    const client = new WebSocket(`ws://localhost:${port}`);

    const responsePromise = new Promise((resolve) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        // Filter for the initialize response
        if (message.id === 1 && message.method !== 'server/connected') { // Ignore potential custom connected message
          resolve(message);
          client.close(); // Close after getting the response
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      client.on('open', () => {
        client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
        resolve();
      });
      client.on('error', reject);
    });


    const response = await responsePromise;

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'mock-gemini-mcp', version: '1.0.0' }, // From mock
        capabilities: {}
      }
    });
  });

  it('should handle generate request via WebSocket', async () => {
    httpServer = await startServer(TEST_PORT);
    const address = httpServer.address();
    const port = typeof address === 'string' ? TEST_PORT : address?.port ?? TEST_PORT;

    const client = new WebSocket(`ws://localhost:${port}`);

    const responsePromise = new Promise((resolve) => {
      client.on('message', (data) => {
        const message = JSON.parse(data.toString());
        if (message.id === 2) { // ID for generate request
          resolve(message);
          client.close();
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      client.on('open', () => {
        // Send initialize first if needed by protocol manager mock
        // client.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }));
        // Then send generate
        client.send(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'generate', params: { prompt: 'hello' } }));
        resolve();
      });
      client.on('error', reject);
    });

    const response = await responsePromise;

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      result: {
        type: 'completion',
        content: 'Mock handled response', // From mock handler
        metadata: {}
      }
    });
  });

  // Add more tests: invalid JSON, unknown method, error handling, shutdown etc.

});
