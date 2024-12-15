import { describe, it, expect, jest } from '@jest/globals';
import { MCPServer } from '../src/server';
import { WebSocket } from 'ws';

describe('MCP Server', () => {
  const TEST_API_KEY = 'test-key';
  const TEST_PORT = 3006;

  it('should initialize correctly', () => {
    const server = new MCPServer(TEST_API_KEY, TEST_PORT);
    expect(server).toBeDefined();
  });

  it('should handle initialize request', async () => {
    const server = new MCPServer(TEST_API_KEY, TEST_PORT);
    const client = new WebSocket(`ws://localhost:${TEST_PORT}`);

    const response = await new Promise((resolve) => {
      client.on('open', () => {
        client.send(JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize'
        }));
      });

      client.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    expect(response).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: {
          name: 'gemini-mcp',
          version: expect.any(String)
        },
        capabilities: expect.any(Object)
      }
    });
  });
});