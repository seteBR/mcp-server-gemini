import { GoogleGenerativeAI } from '@google/generative-ai';
import WebSocket, { WebSocketServer } from 'ws';

interface MCPRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is required');
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

  const wss = new WebSocketServer({ port: 3005 });

  wss.on('connection', (ws) => {
    console.log('Client connected');

    ws.on('message', async (data) => {
      try {
        const request: MCPRequest = JSON.parse(data.toString());
        console.log('Received request:', request);

        if (request.method === 'initialize') {
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: {
                prompts: { listChanged: true }
              },
              serverInfo: {
                name: 'gemini-mcp',
                version: '1.0.0'
              }
            }
          }));
          return;
        }

        if (request.method === '/context/generate') {
          const prompt = request.params?.prompt || "How are you doing?";
          const result = await model.generateContent(prompt);
          const response = await result.response;
          
          ws.send(JSON.stringify({
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
          }));
          return;
        }

        throw new Error(`Method not found: ${request.method}`);
      } catch (error) {
        console.error('Error:', error);
        ws.send(JSON.stringify({
          jsonrpc: '2.0',
          id: typeof request !== 'undefined' ? request.id : null,
          error: {
            code: -32601,
            message: error.message || 'Internal error'
          }
        }));
      }
    });
  });

  console.log('Gemini MCP Server running on port 3005');
}

main().catch(console.error);