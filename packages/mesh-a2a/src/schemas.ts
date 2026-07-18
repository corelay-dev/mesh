import { z } from "zod";

/**
 * A2A Protocol schemas based on the Google A2A spec.
 * All typed with zod for runtime validation.
 */

export const AgentSkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  examples: z.array(z.string()).optional(),
});
export type AgentSkill = z.infer<typeof AgentSkillSchema>;

export const AgentCapabilitiesSchema = z.object({
  streaming: z.boolean().optional(),
  pushNotifications: z.boolean().optional(),
  stateTransitionHistory: z.boolean().optional(),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilitiesSchema>;

export const AgentAuthenticationSchema = z.object({
  schemes: z.array(z.string()),
  credentials: z.string().optional(),
});
export type AgentAuthentication = z.infer<typeof AgentAuthenticationSchema>;

export const AgentCardSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  url: z.string(),
  version: z.string(),
  capabilities: AgentCapabilitiesSchema.optional(),
  authentication: AgentAuthenticationSchema.optional(),
  defaultInputModes: z.array(z.string()).optional(),
  defaultOutputModes: z.array(z.string()).optional(),
  skills: z.array(AgentSkillSchema).optional(),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

export const TaskStateSchema = z.enum([
  "submitted",
  "working",
  "input-required",
  "completed",
  "canceled",
  "failed",
]);
export type TaskState = z.infer<typeof TaskStateSchema>;

export const TextPartSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const FilePartSchema = z.object({
  type: z.literal("file"),
  file: z.object({
    name: z.string().optional(),
    mimeType: z.string().optional(),
    bytes: z.string().optional(),
    uri: z.string().optional(),
  }),
});

export const DataPartSchema = z.object({
  type: z.literal("data"),
  data: z.record(z.unknown()),
});

export const PartSchema = z.discriminatedUnion("type", [
  TextPartSchema,
  FilePartSchema,
  DataPartSchema,
]);
export type Part = z.infer<typeof PartSchema>;

export const A2AMessageSchema = z.object({
  role: z.enum(["user", "agent"]),
  parts: z.array(PartSchema),
  metadata: z.record(z.unknown()).optional(),
});
export type A2AMessage = z.infer<typeof A2AMessageSchema>;

export const ArtifactSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  parts: z.array(PartSchema),
  index: z.number().optional(),
  append: z.boolean().optional(),
  lastChunk: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const TaskStatusSchema = z.object({
  state: TaskStateSchema,
  message: A2AMessageSchema.optional(),
  timestamp: z.string().optional(),
});
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  status: TaskStatusSchema,
  artifacts: z.array(ArtifactSchema).optional(),
  history: z.array(A2AMessageSchema).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskSendParamsSchema = z.object({
  id: z.string(),
  sessionId: z.string().optional(),
  message: A2AMessageSchema,
  acceptedOutputModes: z.array(z.string()).optional(),
  pushNotification: z.object({
    url: z.string(),
    token: z.string().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskSendParams = z.infer<typeof TaskSendParamsSchema>;

export const TaskQueryParamsSchema = z.object({
  id: z.string(),
  historyLength: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskQueryParams = z.infer<typeof TaskQueryParamsSchema>;

export const TaskCancelParamsSchema = z.object({
  id: z.string(),
  metadata: z.record(z.unknown()).optional(),
});
export type TaskCancelParams = z.infer<typeof TaskCancelParamsSchema>;

export const JsonRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.unknown().optional(),
});
export type A2AJsonRpcRequest = z.infer<typeof JsonRpcRequestSchema>;

export interface A2AJsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: A2AError;
}

export interface A2AError {
  code: number;
  message: string;
  data?: unknown;
}

export const A2A_ERROR_CODES = {
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;
