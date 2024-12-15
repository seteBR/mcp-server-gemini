export * from './completion';
export * from './resources';
export * from './prompts';

export interface BaseProvider {
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getCapabilities(): Record<string, any>;
}

export interface CompletionProvider extends BaseProvider {
  complete(argument: CompletionArgument): Promise<Completion>;
}

export interface ContentProvider extends BaseProvider {
  generateContent(prompt: string, options?: any): Promise<string>;
  streamContent?(prompt: string, options?: any): AsyncIterator<string>;
}