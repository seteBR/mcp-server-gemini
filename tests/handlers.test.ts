import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { MCPHandlers } from '../src/handlers.js'; // Added .js
import { ERROR_CODES } from '../src/protocol.js'; // Added .js
import { GenerateRequest, InitializeRequest, GenerateContentResult } from '../src/types.js'; // Added .js

// Mock the GenerativeModel methods
const mockGenerateContent = jest.fn();
const mockGenerateContentStream = jest.fn();

const mockModel = {
  generateContent: mockGenerateContent,
  generateContentStream: mockGenerateContentStream,
  model: 'gemini-pro' // Mock model name
};

// Mock ProtocolManager or pass a simple object/mock
const mockProtocolManager = {
  validateState: jest.fn(),
  // Add other methods if handlers depend on them
};

describe('MCP Handlers', () => {
  let handlers: MCPHandlers;

  beforeEach(() => {
    jest.clearAllMocks();
    // Instantiate handlers before each test
    handlers = new MCPHandlers(mockModel as any, mockProtocolManager, true); // Enable debug for tests
  });

  describe('handleInitialize', () => {
    it('should return correct initialize response', async () => {
      const request: InitializeRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      };

      const response = await handlers.handleInitialize(request);

      expect(response).toHaveProperty('jsonrpc', '2.0');
      expect(response).toHaveProperty('id', 1);
      expect(response).toHaveProperty('result');
      expect(response.result).toHaveProperty('protocolVersion', '2024-11-05');
      expect(response.result).toHaveProperty('serverInfo');
      expect(response.result?.serverInfo).toHaveProperty('name', 'gemini-mcp');
      expect(response.result).toHaveProperty('capabilities');
    });
  });

  describe('handleGenerate', () => {
    it('should throw error if prompt is missing', async () => {
      const request = {
        jsonrpc: '2.0',
        id: 2,
        method: 'generate',
        params: {} // Missing prompt
      } as GenerateRequest; // Cast to bypass initial TS check, let handler validate

      // Use async/await with try/catch or .rejects
      await expect(handlers.handleGenerate(request)).rejects.toMatchObject({
        code: ERROR_CODES.INVALID_PARAMS,
        message: expect.stringContaining('prompt is required')
      });
    });

    it('should call model.generateContent with correct structure', async () => {
      const mockApiResponse = {
        response: {
          text: () => 'Generated text',
          candidates: [{ finishReason: 'STOP' }],
          usageMetadata: { totalTokenCount: 50 }
        }
      } as GenerateContentResult;

      mockGenerateContent.mockResolvedValue(mockApiResponse);

      const request: GenerateRequest = {
        jsonrpc: '2.0',
        id: 3,
        method: 'generate',
        params: {
          prompt: 'Test prompt',
          temperature: 0.8,
          maxTokens: 100
        }
      };

      await handlers.handleGenerate(request);

      expect(mockGenerateContent).toHaveBeenCalledTimes(1);
      expect(mockGenerateContent).toHaveBeenCalledWith(expect.objectContaining({
        contents: [{ role: "user", parts: [{ text: "Test prompt" }] }],
        generationConfig: {
          temperature: 0.8,
          maxOutputTokens: 100,
          stopSequences: undefined // Ensure undefined params are handled
        }
      }));
    });


    it('should return successful generation response', async () => {
      const mockApiResponse = {
        response: {
          text: () => 'Successful generation',
          // Add mock candidates/usageMetadata if needed by the handler
        }
      } as GenerateContentResult;

      mockGenerateContent.mockResolvedValue(mockApiResponse);

      const request: GenerateRequest = {
        jsonrpc: '2.0',
        id: 4,
        method: 'generate',
        params: { prompt: 'Another test' }
      };

      const response = await handlers.handleGenerate(request);

      expect(response).toEqual({
        jsonrpc: '2.0',
        id: 4,
        result: {
          type: 'completion',
          content: 'Successful generation',
          metadata: expect.objectContaining({
            model: 'gemini-pro',
            provider: 'google',
            // Check other metadata fields if they are added
          })
        }
      });
    });

    it('should handle API errors during generation', async () => {
      const apiError = new Error('Quota exceeded');
      mockGenerateContent.mockRejectedValue(apiError);

      const request: GenerateRequest = {
        jsonrpc: '2.0',
        id: 5,
        method: 'generate',
        params: { prompt: 'Test that fails' }
      };

      await expect(handlers.handleGenerate(request)).rejects.toMatchObject({
        code: ERROR_CODES.GEMINI_API_ERROR, // Or more specific like GEMINI_RATE_LIMIT
        message: expect.stringContaining('Quota exceeded')
      });
    });
  });

  // Add tests for handleStream, handleCancel, handleConfigure similarly
  // - Mock stream responses/errors for handleStream
  // - Test cancellation logic for handleCancel
  // - Test configuration acknowledgement for handleConfigure
});
