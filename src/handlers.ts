import { GoogleGenerativeAI, GenerativeModel, GenerateContentRequest, GenerateContentResult, GenerateContentStreamResult, Content, Part } from '@google/generative-ai';
import {
  GenerateRequest,
  GenerateResponse,
  MCPRequest,
  MCPResponse,
  StreamRequest,
  StreamResponse,
  CancelRequest,
  CancelResponse,
  ConfigureRequest,
  ConfigureResponse,
  InitializeRequest,
  InitializeResponse,
  MCPError
} from './types.js'; // Added .js
import { createInitializeResult, ERROR_CODES, validateRequest } from './protocol.js'; // Added .js
import EventEmitter from 'events';

export class MCPHandlers extends EventEmitter {
  private activeRequests: Map<string | number, AbortController>;
  private model: GenerativeModel; // Keep the specific type

  constructor(
    model: GenerativeModel, // Use specific type
    private protocol: any, // Keep protocol manager if used, otherwise remove
    private debug: boolean = false
  ) {
    super();
    this.model = model;
    this.activeRequests = new Map();
  }

  private log(...args: any[]) {
    if (this.debug) {
      console.log('[MCP Debug]', ...args);
    }
  }

  // --- Request Handling Logic ---

  async handleInitialize(request: InitializeRequest): Promise<InitializeResponse> {
    this.log('Initializing with params:', request.params);
    // Here you might process clientInfo or capabilities if provided
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: createInitializeResult()
    };
  }

  async handleGenerate(request: GenerateRequest): Promise<GenerateResponse> {
    this.log('Handling generate request:', request.params);

    if (!validateRequest(request, ['prompt'])) {
      throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Invalid or missing parameters: prompt is required');
    }

    const abortController = new AbortController();
    this.activeRequests.set(request.id, abortController);

    try {
      // Structure the request correctly for the Gemini API
      const generationRequest: GenerateContentRequest = {
        contents: this.buildContent(request.params.prompt),
        generationConfig: {
          temperature: request.params.temperature,
          maxOutputTokens: request.params.maxTokens,
          stopSequences: request.params.stopSequences,
        }
      };

      // Pass AbortSignal if supported by the SDK version (check docs if needed)
      // const requestOptions = { signal: abortController.signal };

      const result: GenerateContentResult = await this.model.generateContent(generationRequest /*, requestOptions */);
      const response = result.response; // No need for await here

      this.activeRequests.delete(request.id);

      if (!response) {
        throw this.createError(ERROR_CODES.INTERNAL_ERROR, 'Gemini API returned no response');
      }

      return {
        jsonrpc: '2.0',
        id: request.id,
        result: {
          type: 'completion',
          content: response.text(),
          metadata: {
            model: this.model.model, // Use actual model name
            provider: 'google',
            temperature: request.params.temperature,
            maxTokens: request.params.maxTokens,
            stopSequences: request.params.stopSequences,
            // Add other metadata like finishReason, token counts if available
            // finishReason: response.candidates?.[0]?.finishReason,
            // tokenCount: response.usageMetadata?.totalTokenCount
          }
        }
      };
    } catch (error) {
      this.log('Generation error:', error);
      this.activeRequests.delete(request.id);
      // Re-throw a structured error
      throw this.handleApiError(error);
    }
  }

  async handleStream(request: StreamRequest): Promise<void> {
    this.log('Handling stream request:', request.params);

    if (!validateRequest(request, ['prompt'])) {
      throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Invalid or missing parameters: prompt is required');
    }

    const abortController = new AbortController();
    this.activeRequests.set(request.id, abortController);

    try {
      // Structure the request correctly
      const generationRequest: GenerateContentRequest = {
        contents: this.buildContent(request.params.prompt),
        generationConfig: {
          temperature: request.params.temperature,
          maxOutputTokens: request.params.maxTokens,
          stopSequences: request.params.stopSequences,
        }
      };

      // Pass AbortSignal if supported
      // const requestOptions = { signal: abortController.signal };

      const streamResult: GenerateContentStreamResult = await this.model.generateContentStream(generationRequest /*, requestOptions */);

      // Iterate over the stream correctly
      for await (const chunk of streamResult.stream) {
        if (abortController.signal.aborted) {
          this.log(`Stream ${request.id} aborted.`);
          break; // Exit loop if cancelled
        }
        const response: StreamResponse = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            type: 'stream',
            content: chunk.text(),
            done: false,
            metadata: { timestamp: Date.now(), model: this.model.model } // Add metadata
          }
        };
        this.emit('response', response); // Emit response for the server to send
      }

      // Check if the stream was aborted before sending the final chunk
      if (!abortController.signal.aborted) {
        // Send final chunk indicating completion
        const finalResponse: StreamResponse = {
          jsonrpc: '2.0',
          id: request.id,
          result: {
            type: 'stream',
            content: '',
            done: true,
            metadata: { timestamp: Date.now(), model: this.model.model }
          }
        };
        this.emit('response', finalResponse);
      }

    } catch (error) {
      this.log('Stream error:', error);
      // Emit an error response instead of throwing directly back to server loop
      const apiError = this.handleApiError(error);
      const errorResponse: MCPResponse = {
        jsonrpc: '2.0',
        id: request.id,
        error: apiError
      };
      this.emit('response', errorResponse);
    } finally {
      this.activeRequests.delete(request.id);
    }
  }

  async handleCancel(request: CancelRequest): Promise<CancelResponse> {
    this.log('Handling cancel request:', request.params);

    if (!validateRequest(request, ['requestId'])) {
      throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Missing requestId parameter');
    }

    const requestIdToCancel = request.params.requestId;
    const controller = this.activeRequests.get(requestIdToCancel);

    if (controller) {
      this.log(`Aborting request ${requestIdToCancel}`);
      controller.abort();
      this.activeRequests.delete(requestIdToCancel);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { cancelled: true }
      };
    } else {
      this.log(`Request ${requestIdToCancel} not found or already completed.`);
      // It's often okay to report success even if the request wasn't found,
      // as the goal (stopping the request) is achieved.
      // Alternatively, throw an error:
      // throw this.createError(ERROR_CODES.INVALID_REQUEST, `Request not found or already completed: ${requestIdToCancel}`);
      return {
        jsonrpc: '2.0',
        id: request.id,
        result: { cancelled: true } // Indicate the desired state is achieved
      };
    }
  }

  async handleConfigure(request: ConfigureRequest): Promise<ConfigureResponse> {
    this.log('Handling configure request:', request.params);

    if (!validateRequest(request, ['configuration'])) {
      throw this.createError(ERROR_CODES.INVALID_PARAMS, 'Missing configuration parameter');
    }

    // Example: Update model configuration (if the SDK supports it dynamically)
    // Note: The current Gemini SDK might not support dynamic config updates this way.
    // This might require re-initializing the model or be purely informational.
    const config = request.params.configuration;
    this.log('Received configuration:', config);
    // Apply configuration changes if possible...

    return {
      jsonrpc: '2.0',
      id: request.id,
      result: { configured: true } // Acknowledge configuration received
    };
  }

  // --- Central Request Dispatcher ---

  async handleRequest(request: MCPRequest): Promise<MCPResponse | null> { // Can return null for stream start
    this.log('Handling request:', request.method, 'ID:', request.id);

    try {
      switch (request.method) {
        case 'initialize':
          return await this.handleInitialize(request as InitializeRequest);

        case 'generate':
          return await this.handleGenerate(request as GenerateRequest);

        case 'stream':
          // Start the stream process, but don't return a direct response here.
          // Responses will be emitted via 'response' event.
          await this.handleStream(request as StreamRequest);
          return null; // Indicate stream started, no immediate result needed

        case 'cancel':
          return await this.handleCancel(request as CancelRequest);

        case 'configure':
          return await this.handleConfigure(request as ConfigureRequest);

        // Add cases for other MCP methods if implemented (e.g., prompts/list)

        default:
          throw this.createError(ERROR_CODES.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
      }
    } catch (error) {
      this.log(`Error processing request ${request.id} (${request.method}):`, error);
      // Ensure caught errors are MCPError compatible
      if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
        throw error; // Re-throw structured MCPError
      } else {
        // Wrap unexpected errors
        throw this.handleApiError(error);
      }
    }
  }

  // --- Utility Methods ---

  cancelRequest(requestId: string | number): void {
    const controller = this.activeRequests.get(requestId);
    if (controller) {
      this.log(`Cancelling request ${requestId} from outside handler.`);
      controller.abort();
      this.activeRequests.delete(requestId);
    }
  }

  private createError(code: number, message: string, data?: any): MCPError {
    return { code, message, data };
  }

  private handleApiError(error: any): MCPError {
    // Basic check if it looks like a Google API error
    if (error && typeof error === 'object' && error.message) {
      // You might add more specific checks based on Google API error structure
      if (error.message.includes('API key not valid')) {
        return this.createError(ERROR_CODES.GEMINI_INVALID_TOKEN, `Gemini API Error: ${error.message}`);
      }
      if (error.message.includes('quota')) {
        return this.createError(ERROR_CODES.GEMINI_RATE_LIMIT, `Gemini API Error: ${error.message}`);
      }
      // Add more specific error mappings if needed
      return this.createError(ERROR_CODES.GEMINI_API_ERROR, `Gemini API Error: ${error.message}`);
    }
    // Fallback for unknown errors
    return this.createError(ERROR_CODES.INTERNAL_ERROR, 'An unexpected internal error occurred');
  }

  // Helper to build the Content structure for Gemini API
  private buildContent(prompt: string): Content[] {
    // Basic implementation assuming a single user prompt
    // Expand this if you need to handle multi-turn conversations or different roles
    return [{ role: "user", parts: [{ text: prompt }] }];
  }
}
