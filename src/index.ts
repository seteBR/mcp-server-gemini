#!/usr/bin/env node
import { MCPServer } from './server.js'; // Added .js

// Start server
const apiKey = process.env.GEMINI_API_KEY;
const portString = process.env.PORT || '3005';
const port = parseInt(portString, 10);

if (!apiKey) {
  console.error('ERROR: GEMINI_API_KEY environment variable is not set.');
  process.exit(1);
}

if (isNaN(port) || port <= 0 || port > 65535) {
  console.error(`ERROR: Invalid PORT environment variable: "${portString}". Using default 3005.`);
  new MCPServer(apiKey); // Use default port
} else {
  new MCPServer(apiKey, port);
}
