import consola from "consola"
import { events } from "fetch-event-stream"

import { copilotHeaders, copilotBaseUrl } from "~/lib/api-config"
import { getClaudeSettingsEnv } from "~/lib/claude-settings"
import { HTTPError } from "~/lib/error"
import { state } from "~/lib/state"

const usesMaxCompletionTokens = (modelId: string): boolean =>
  modelId.startsWith("gpt-5")

const defaultReasoningEffort = (
  modelId: string,
): ChatCompletionsPayload["reasoning_effort"] =>
  usesMaxCompletionTokens(modelId) ? "medium" : undefined

const normalizeReasoningEffort = (
  value: string | undefined | null,
): ChatCompletionsPayload["reasoning_effort"] => {
  switch (value?.toLowerCase()) {
    case "low": {
      return "low"
    }
    case "medium": {
      return "medium"
    }
    case "high": {
      return "high"
    }
    case "xhigh":
    case "max": {
      return "max"
    }
    default: {
      return undefined
    }
  }
}

const buildRequestPayload = (
  payload: ChatCompletionsPayload,
  claudeSettingsEnv: Record<string, string>,
): ChatCompletionsRequestPayload => {
  const requestedReasoningEffort =
    payload.reasoning_effort
    ?? normalizeReasoningEffort(process.env.COPILOT_REASONING_EFFORT)
    ?? normalizeReasoningEffort(claudeSettingsEnv.COPILOT_REASONING_EFFORT)
    ?? defaultReasoningEffort(payload.model)

  const reasoningEffort =
    (
      usesMaxCompletionTokens(payload.model)
      && payload.tools !== null
      && payload.tools !== undefined
      && payload.tools.length > 0
    ) ?
      undefined
    : requestedReasoningEffort

  if (
    !usesMaxCompletionTokens(payload.model)
    || payload.max_tokens === null
    || payload.max_tokens === undefined
  ) {
    return reasoningEffort === null || reasoningEffort === undefined ?
        payload
      : { ...payload, reasoning_effort: reasoningEffort }
  }

  return {
    ...payload,
    max_tokens: undefined,
    max_completion_tokens: payload.max_tokens,
    reasoning_effort: reasoningEffort,
  }
}

export const createChatCompletions = async (
  payload: ChatCompletionsPayload,
) => {
  if (!state.copilotToken) throw new Error("Copilot token not found")

  const enableVision = payload.messages.some(
    (x) =>
      typeof x.content !== "string"
      && x.content?.some((x) => x.type === "image_url"),
  )

  // Agent/user check for X-Initiator header
  // Determine if any message is from an agent ("assistant" or "tool")
  const isAgentCall = payload.messages.some((msg) =>
    ["assistant", "tool"].includes(msg.role),
  )

  // Build headers and add X-Initiator
  const headers: Record<string, string> = {
    ...copilotHeaders(state, enableVision),
    "X-Initiator": isAgentCall ? "agent" : "user",
  }

  const claudeSettingsEnv = await getClaudeSettingsEnv()
  const requestPayload = buildRequestPayload(payload, claudeSettingsEnv)

  const response = await fetch(`${copilotBaseUrl(state)}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(requestPayload),
  })

  if (!response.ok) {
    consola.error("Failed to create chat completions", response)
    throw new HTTPError("Failed to create chat completions", response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ChatCompletionResponse
}

// Streaming types

export interface ChatCompletionChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: Array<Choice>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
    completion_tokens_details?: {
      accepted_prediction_tokens: number
      rejected_prediction_tokens: number
    }
  }
}

interface Delta {
  content?: string | null
  role?: "user" | "assistant" | "system" | "tool"
  tool_calls?: Array<{
    index: number
    id?: string
    type?: "function"
    function?: {
      name?: string
      arguments?: string
    }
  }>
}

interface Choice {
  index: number
  delta: Delta
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null
  logprobs: object | null
}

// Non-streaming types

export interface ChatCompletionResponse {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: Array<ChoiceNonStreaming>
  system_fingerprint?: string
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens: number
    }
  }
}

interface ResponseMessage {
  role: "assistant"
  content: string | null
  tool_calls?: Array<ToolCall>
}

interface ChoiceNonStreaming {
  index: number
  message: ResponseMessage
  logprobs: object | null
  finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
}

// Payload types

export interface ChatCompletionsPayload {
  messages: Array<Message>
  model: string
  temperature?: number | null
  top_p?: number | null
  max_tokens?: number | null
  reasoning_effort?: "low" | "medium" | "high" | "max" | null
  stop?: string | Array<string> | null
  n?: number | null
  stream?: boolean | null

  frequency_penalty?: number | null
  presence_penalty?: number | null
  logit_bias?: Record<string, number> | null
  logprobs?: boolean | null
  response_format?: { type: "json_object" } | null
  seed?: number | null
  tools?: Array<Tool> | null
  tool_choice?:
    | "none"
    | "auto"
    | "required"
    | { type: "function"; function: { name: string } }
    | null
  user?: string | null
}

type ChatCompletionsRequestPayload = Omit<
  ChatCompletionsPayload,
  "max_tokens"
> & {
  max_tokens?: number | null
  max_completion_tokens?: number | null
}

export interface Tool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool" | "developer"
  content: string | Array<ContentPart> | null

  name?: string
  tool_calls?: Array<ToolCall>
  tool_call_id?: string
}

export interface ToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

export type ContentPart = TextPart | ImagePart

export interface TextPart {
  type: "text"
  text: string
}

export interface ImagePart {
  type: "image_url"
  image_url: {
    url: string
    detail?: "low" | "high" | "auto"
  }
}
