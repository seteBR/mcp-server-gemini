# Gemini MCP Server

MCP server implementation for Google's Gemini AI that enables Claude Desktop to interact with Gemini models through the Model Context Protocol (MCP).

## Features

- Full MCP protocol support
- Real-time response streaming
- Secure API key handling
- Configurable model parameters
- TypeScript implementation

## Quick Start

1. Install from GitHub:
```bash
npx github:aliargun/mcp-server-gemini
```

2. Add to Claude Desktop configuration:
```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": ["-y", "github:aliargun/mcp-server-gemini"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here"
      }
    }
  }
}
```

3. Restart Claude Desktop

## Local Development

```bash
git clone https://github.com/aliargun/mcp-server-gemini.git
cd mcp-server-gemini
npm install
npm run dev
```

## Documentation

- [Implementation Notes](docs/implementation-notes.md)
- [Development Guide](docs/development-guide.md)
- [Troubleshooting Guide](docs/troubleshooting.md)

## Contributing

Contributions are welcome! Please see our [Contributing Guide](CONTRIBUTING.md)

## License

MIT
