/**
 * Minimal typings for the WebMCP API (https://webmachinelearning.github.io/webmcp/),
 * which isn't part of TypeScript's DOM lib yet.
 */
export type WebMCPJSONSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, WebMCPJSONSchema>;
  required?: readonly string[];
  items?: WebMCPJSONSchema;
  enum?: readonly (string | number)[];
  additionalProperties?: boolean | WebMCPJSONSchema;
};

export type WebMCPToolAnnotations = {
  readOnlyHint?: boolean;
  /** the output contains content the page author doesn't control */
  untrustedContentHint?: boolean;
};

export type WebMCPTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: WebMCPJSONSchema;
  annotations: WebMCPToolAnnotations;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};

export interface WebMCPModelContext {
  registerTool(tool: WebMCPTool, options?: { signal?: AbortSignal }): Promise<void> | void;
}

export type ModelContextHost = Document & { modelContext?: WebMCPModelContext };
