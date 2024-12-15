# Claude Desktop MCP Configuration Guide

## Overview

This guide explains how to configure Claude Desktop to use the Gemini MCP server. The Model Context Protocol (MCP) allows Claude to interact with external AI models and tools.

## Configuration Steps

### 1. Get Gemini API Key

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create or sign in to your Google account
3. Generate a new API key
4. Copy the API key for later use

### 2. Locate Configuration File

The configuration file location depends on your operating system:

- **macOS**:
  ```
  ~/Library/Application Support/Claude/claude_desktop_config.json
  ```

- **Windows**:
  ```
  %APPDATA%\Claude\claude_desktop_config.json
  ```

- **Linux**:
  ```
  ~/.config/Claude/claude_desktop_config.json
  ```

### 3. Edit Configuration

1. Open the configuration file in a text editor
2. Add or update the mcpServers section:

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

### 4. Verify Setup

1. Save the configuration file
2. Restart Claude Desktop completely
3. Test the connection by asking Claude:
   "Can you verify if the Gemini MCP connection is working?"

## Advanced Configuration

### Debug Mode
```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": ["-y", "github:aliargun/mcp-server-gemini"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here",
        "DEBUG": "true"
      }
    }
  }
}
```

### Custom Port
```json
{
  "mcpServers": {
    "gemini": {
      "command": "npx",
      "args": ["-y", "github:aliargun/mcp-server-gemini"],
      "env": {
        "GEMINI_API_KEY": "your_api_key_here",
        "PORT": "3006"
      }
    }
  }
}
```

## Troubleshooting

### Common Issues

1. **Configuration File Not Found**
   - Run Claude Desktop at least once
   - Create the directory if it doesn't exist
   - Create an empty JSON file if needed

2. **Connection Errors**
   - Check if the port is available
   - Verify internet connection
   - Check firewall settings

3. **API Key Issues**
   - Verify the key is correct
   - Ensure no whitespace in the key
   - Check API key permissions

### Error Messages

1. **"Cannot connect to MCP server"**
   - Check if the server is running
   - Verify port settings
   - Check network connectivity

2. **"Invalid API key"**
   - Verify API key in config
   - Regenerate API key if needed
   - Check for copying errors

## Security Notes

1. **API Key Storage**
   - Keep your API key secure
   - Don't share the configuration file
   - Regularly rotate API keys

2. **File Permissions**
   - Set appropriate file permissions
   - Restrict access to config file
   - Use environment variables when possible

## Additional Resources

1. [Gemini API Documentation](https://ai.google.dev/docs)
2. [Claude Desktop Documentation](https://www.anthropic.com/claude)
3. [MCP Protocol Specification](https://modelcontextprotocol.io)
