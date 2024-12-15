# Development Guide

## Environment Setup

1. Prerequisites
   - Node.js 18+
   - npm/yarn
   - TypeScript
   - Gemini API key

2. Installation
```bash
git clone https://github.com/aliargun/mcp-server-gemini.git
cd mcp-server-gemini
npm install
```

3. Configuration
```bash
# Set your Gemini API key
export GEMINI_API_KEY=your_api_key_here
```

## Development Workflow

1. Start Development Server
```bash
npm run dev
```

2. Build for Production
```bash
npm run build
```

3. Run Tests
```bash
npm test
```

## Project Structure

```
src/
├── index.ts         # Main entry point
├── types/           # TypeScript type definitions
├── utils/           # Utility functions
test/                # Test files
docs/                # Documentation
```

## Adding Features

1. Create new message handler:
```typescript
if (request.method === 'newMethod') {
  // Handle new method
}
```

2. Add capability:
```typescript
capabilities: {
  experimental: {
    newFeature: true
  }
}
```

## Testing

1. Unit Tests
```typescript
describe('Message Handler', () => {
  it('handles new method', () => {
    // Test implementation
  });
});
```

2. Integration Tests
```typescript
describe('WebSocket Server', () => {
  it('connects and processes messages', () => {
    // Test implementation
  });
});
```

## Debugging

1. Enable Debug Logging
```typescript
const DEBUG = true;
if (DEBUG) console.log('Debug:', message);
```

2. Use WebSocket Client
```bash
wscat -c ws://localhost:3005
```

## Best Practices

1. Code Style
   - Use TypeScript
   - Follow existing patterns
   - Document public APIs

2. Error Handling
   - Use type-safe errors
   - Provide meaningful messages
   - Log appropriately

3. Testing
   - Write unit tests
   - Add integration tests
   - Test error cases
