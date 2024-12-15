#!/usr/bin/env node
import { GoogleGenerativeAI } from '@google/generative-ai';
import WebSocket, { WebSocketServer } from 'ws';

interface MCPRequest {
  id?: string | number;
  method: string;
  params?: {
    prompt?: string;
    [key: string]: any;
  };
  jsonrpc: '2.0';
}

interface MCPResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  // Initialize websocket server
  const wss = new WebSocketServer({ port: 3005 });

  wss.on('connection', function connection(ws: WebSocket) {
    console.log('Client connected');

    ws.on('message', async function incoming(messageData: WebSocket.RawData) {
      const message = messageData.toString();
      let response: MCPResponse;
      
      try {
        const request: MCPRequest = JSON.parse(message);
        console.log('Received request:', request.method);
        
        if (request.method === 'initialize') {
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                experimental: {},
                prompts: { listChanged: true }
              },
              serverInfo: {
                name: 'gemini-mcp',
                version: '1.0.0'
              }
            }
          };
        }
        else if (request.method === 'generate') {
          const prompt = request.params?.prompt;
          if (!prompt) {
            throw new Error('No prompt provided');
          }

          const result = await model.generateContent(prompt);
          const generatedResponse = await result.response;
          
          response = {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              type: 'completion',
              content: generatedResponse.text(),
              metadata: {
                model: 'gemini-pro',
                provider: 'google'
              }
            }
          };
        }
        else {
          // Handle unsupported methods
          response = {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: 'Method not found'
            }
          };
        }

        ws.send(JSON.stringify(response));
      } catch (error) {
        // If JSON parsing failed, we won't have a request object
        let errorResponse: MCPResponse = {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : 'Unknown error'
          }
        };
        
        try {
          // Try to get the id from the original message if possible
          const parsedMessage = JSON.parse(message);
          errorResponse.id = parsedMessage.id;
        } catch {
          // If we can't parse the message, send response without an id
        }
        
        ws.send(JSON.stringify(errorResponse));
      }
    });
  });

  console.log('Gemini MCP Server running on port 3005');
}

main().catch(console.error);