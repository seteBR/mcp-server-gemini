import { describe, it, expect, jest } from '@jest/globals';
import { MCPHandlers } from '../src/handlers';
import { ERROR_CODES } from '../src/protocol';

describe('MCP Handlers', () => {
  const mockModel = {
    generateContent: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const handlers = new MCPHandlers(mockModel as any);

  describe('handleInitialize', () => {
    it('should return correct initialize response', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      };

      const response = await handlers.handleInitialize(request);

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          serverInfo: expect.any(Object),
          capabilities: expect.any(Object)
        }
      });
    });
  });

  describe('handleGenerate', () => {
    it('should handle missing prompt parameter', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'generate',
        params: {}
      };

      await expect(handlers.handleGenerate(request)).rejects.toThrow();
    });

    it('should handle successful generation', async () => {
      const mockResponse = {
        response: {
          text: () => 'Generated text'
        }
      };

      mockModel.generateContent.mockResolvedValue(mockResponse);

      const request = {
        jsonrpc: '2.0',
        id: 1,
        method: 'generate',
        params: {
          prompt: 'Test prompt'
        }
      };

      const response = await handlers.handleGenerate(request);

      expect(response).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: {
          type: 'completion',
          content: 'Generated text',
          metadata: expect.any(Object)
        }
      });
    });
  });
});