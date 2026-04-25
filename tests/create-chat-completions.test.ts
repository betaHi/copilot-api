import { afterEach, test, expect, mock } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type { ChatCompletionsPayload } from "../src/services/copilot/create-chat-completions"

import { state } from "../src/lib/state"
import { createChatCompletions } from "../src/services/copilot/create-chat-completions"

// Mock state
state.copilotToken = "test-token"
state.vsCodeVersion = "1.0.0"
state.accountType = "individual"

const isolatedHome = path.join(os.tmpdir(), "copilot-api-test-home")
await mkdir(isolatedHome, { recursive: true })
process.env.HOME = isolatedHome

const createMockResponse = (jsonBody: unknown, ok: boolean = true) => ({
  ok,
  status: ok ? 200 : 400,
  json: () => Promise.resolve(jsonBody),
  text: () => Promise.resolve(JSON.stringify(jsonBody)),
  clone() {
    return createMockResponse(jsonBody, ok)
  },
})

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string>; body?: string }) => {
    return Object.assign(
      createMockResponse({ id: "123", object: "chat.completion", choices: [] }),
      {
        headers: opts.headers,
        body: opts.body,
      },
    )
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

afterEach(() => {
  fetchMock.mockClear()
  delete process.env.COPILOT_REASONING_EFFORT
  process.env.HOME = isolatedHome
})

test("sets X-Initiator to agent if tool/assistant present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "tool", content: "tool call" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("agent")
})

test("sets X-Initiator to user if only user present", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [
      { role: "user", content: "hi" },
      { role: "user", content: "hello again" },
    ],
    model: "gpt-test",
  }
  await createChatCompletions(payload)
  expect(fetchMock).toHaveBeenCalled()
  const headers = (
    fetchMock.mock.calls[0][1] as { headers: Record<string, string> }
  ).headers
  expect(headers["X-Initiator"]).toBe("user")
})

test("uses max_completion_tokens for GPT-5 family models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 512,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_completion_tokens).toBe(512)
  expect(body.max_tokens).toBeUndefined()
})

test("uses max_completion_tokens for gpt-5.5 with explicit reasoning effort", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.5",
    max_tokens: 384,
    reasoning_effort: "high",
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_completion_tokens).toBe(384)
  expect(body.max_tokens).toBeUndefined()
  expect(body.reasoning_effort).toBe("high")
})

test("passes through reasoning_effort none for gpt-5.5", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.5",
    max_tokens: 128,
    reasoning_effort: "none",
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_completion_tokens).toBe(128)
  expect(body.reasoning_effort).toBe("none")
})

test("uses max_completion_tokens for gpt-5.3-codex", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-123",
          created_at: 123,
          model: "gpt-5.3-codex",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.3-codex",
    max_tokens: 384,
  }

  const response = await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(fetchMock.mock.calls[0][0]).toContain("/responses")
  expect(body.max_output_tokens).toBe(384)
  expect(body.reasoning).toEqual({ effort: "medium" })
  expect(body.input).toBe("hi")
  expect((response as { model: string }).model).toBe("gpt-5.3-codex")
})

test("uses max_completion_tokens for gpt-5.4-mini", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-234",
          created_at: 234,
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "Mini OK" }],
            },
          ],
          usage: {
            input_tokens: 11,
            output_tokens: 7,
            total_tokens: 18,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4-mini",
    max_tokens: 192,
  }

  const response = await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(fetchMock.mock.calls[0][0]).toContain("/responses")
  expect(body.max_output_tokens).toBe(192)
  expect(body.reasoning).toEqual({ effort: "medium" })
  expect((response as { model: string }).model).toBe("gpt-5.4-mini-2026-03-17")
})

test("translates responses tool calls back to chat completions", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-tool",
          created_at: 345,
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              type: "function_call",
              call_id: "call_123",
              name: "lookup_weather",
              arguments: '{"city":"Tokyo"}',
            },
          ],
          usage: {
            input_tokens: 20,
            output_tokens: 12,
            total_tokens: 32,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "weather?" }],
    model: "gpt-5.4-mini",
    max_tokens: 64,
    tools: [
      {
        type: "function",
        function: {
          name: "lookup_weather",
          parameters: {
            type: "object",
            properties: {
              city: { type: "string" },
            },
          },
        },
      },
    ],
  }

  const response = await createChatCompletions(payload)

  expect(fetchMock.mock.calls[0][0]).toContain("/responses")
  expect(
    (
      response as {
        choices: Array<{
          finish_reason: string
          message: { tool_calls: Array<{ function: { name: string } }> }
        }>
      }
    ).choices[0]?.finish_reason,
  ).toBe("tool_calls")
  expect(
    (
      response as {
        choices: Array<{
          message: { tool_calls: Array<{ function: { name: string } }> }
        }>
      }
    ).choices[0]?.message.tool_calls[0]?.function.name,
  ).toBe("lookup_weather")
})

test("keeps max_tokens for non GPT-5 models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "claude-sonnet-4.6",
    max_tokens: 256,
  }

  await createChatCompletions(payload)

  expect(fetchMock).toHaveBeenCalled()
  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_tokens).toBe(256)
  expect(body.max_completion_tokens).toBeUndefined()
})

test("keeps max_tokens and omits reasoning_effort for gemini-3.1-pro-preview", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gemini-3.1-pro-preview",
    max_tokens: 256,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_tokens).toBe(256)
  expect(body.max_completion_tokens).toBeUndefined()
  expect(body.reasoning_effort).toBeUndefined()
})

test("keeps max_tokens and omits reasoning_effort for gemini-3-flash-preview", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gemini-3-flash-preview",
    max_tokens: 256,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_tokens).toBe(256)
  expect(body.max_completion_tokens).toBeUndefined()
  expect(body.reasoning_effort).toBeUndefined()
})

test("passes through explicit reasoning_effort for GPT-5 family models", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
    reasoning_effort: "high",
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.reasoning_effort).toBe("high")
  expect(body.max_completion_tokens).toBe(128)
})

test("truncates long user identifiers for gpt-5.4", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
    user: "u".repeat(100),
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect((body.user as string).length).toBe(64)
})

test("falls back to medium for unsupported none on gpt-5.4", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
    reasoning_effort: "none",
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.reasoning_effort).toBe("medium")
  expect(body.max_completion_tokens).toBe(128)
})

test("passes through reasoning_effort none for gpt-5.4-mini", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-none-mini",
          created_at: 456,
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4-mini",
    max_tokens: 128,
    reasoning_effort: "none",
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(fetchMock.mock.calls[0][0]).toContain("/responses")
  expect(body.reasoning).toEqual({ effort: "none" })
  expect(body.max_output_tokens).toBe(128)
})

test("truncates long user identifiers for gpt-5.4-mini", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-user-mini",
          created_at: 678,
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4-mini",
    max_tokens: 128,
    user: "u".repeat(100),
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect((body.user as string).length).toBe(64)
})

test("falls back to medium for unsupported high on gpt-5.4-mini", async () => {
  fetchMock.mockImplementationOnce(
    (_url: string, opts: { headers: Record<string, string>; body?: string }) =>
      Object.assign(
        createMockResponse({
          id: "resp-high-mini",
          created_at: 567,
          model: "gpt-5.4-mini-2026-03-17",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "OK" }],
            },
          ],
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        }),
        { headers: opts.headers, body: opts.body },
      ),
  )

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4-mini",
    max_tokens: 128,
    reasoning_effort: "high",
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(fetchMock.mock.calls[0][0]).toContain("/responses")
  expect(body.reasoning).toEqual({ effort: "medium" })
})

test("uses COPILOT_REASONING_EFFORT env override for GPT-5 family models", async () => {
  process.env.COPILOT_REASONING_EFFORT = "xhigh"

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.reasoning_effort).toBe("xhigh")
})

test("uses COPILOT_REASONING_EFFORT env override for claude-opus-4.7", async () => {
  process.env.COPILOT_REASONING_EFFORT = "xhigh"

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "claude-opus-4.7",
    max_tokens: 128,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_tokens).toBe(128)
  expect(body.output_config).toEqual({ effort: "xhigh" })
  expect(body.reasoning_effort).toBeUndefined()
})

test("does not apply Claude Opus 4.7 effort override to other Claude models", async () => {
  process.env.COPILOT_REASONING_EFFORT = "xhigh"

  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "claude-opus-4.6",
    max_tokens: 128,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.max_tokens).toBe(128)
  expect(body.output_config).toBeUndefined()
  expect(body.reasoning_effort).toBeUndefined()
})

test("defaults GPT-5 family models to medium reasoning effort", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.reasoning_effort).toBe("medium")
})

test("uses COPILOT_REASONING_EFFORT from Claude settings.json", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "claude-settings-"))
  const claudeDirectory = path.join(tempHome, ".claude")

  try {
    await mkdir(claudeDirectory, { recursive: true })
    await writeFile(
      path.join(claudeDirectory, "settings.json"),
      JSON.stringify({
        env: {
          COPILOT_REASONING_EFFORT: "xhigh",
        },
      }),
    )

    process.env.HOME = tempHome

    const payload: ChatCompletionsPayload = {
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-5.4",
      max_tokens: 128,
    }

    await createChatCompletions(payload)

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>

    expect(body.reasoning_effort).toBe("xhigh")
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})

test("uses COPILOT_REASONING_EFFORT from Claude settings.json for gpt-5.5", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "claude-settings-"))
  const claudeDirectory = path.join(tempHome, ".claude")

  try {
    await mkdir(claudeDirectory, { recursive: true })
    await writeFile(
      path.join(claudeDirectory, "settings.json"),
      JSON.stringify({
        env: {
          COPILOT_REASONING_EFFORT: "none",
        },
      }),
    )

    process.env.HOME = tempHome

    const payload: ChatCompletionsPayload = {
      messages: [{ role: "user", content: "hi" }],
      model: "gpt-5.5",
      max_tokens: 128,
    }

    await createChatCompletions(payload)

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>

    expect(body.max_completion_tokens).toBe(128)
    expect(body.reasoning_effort).toBe("none")
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})

test("uses COPILOT_REASONING_EFFORT from Claude settings.json for claude-opus-4.7", async () => {
  const tempHome = await mkdtemp(path.join(os.tmpdir(), "claude-settings-"))
  const claudeDirectory = path.join(tempHome, ".claude")

  try {
    await mkdir(claudeDirectory, { recursive: true })
    await writeFile(
      path.join(claudeDirectory, "settings.json"),
      JSON.stringify({
        env: {
          COPILOT_REASONING_EFFORT: "max",
        },
      }),
    )

    process.env.HOME = tempHome

    const payload: ChatCompletionsPayload = {
      messages: [{ role: "user", content: "hi" }],
      model: "claude-opus-4.7",
      max_tokens: 128,
    }

    await createChatCompletions(payload)

    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as { body: string }).body,
    ) as Record<string, unknown>

    expect(body.output_config).toEqual({ effort: "max" })
    expect(body.reasoning_effort).toBeUndefined()
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})

test("omits reasoning_effort for GPT-5 family tool calls", async () => {
  const payload: ChatCompletionsPayload = {
    messages: [{ role: "user", content: "hi" }],
    model: "gpt-5.4",
    max_tokens: 128,
    reasoning_effort: "high",
    tools: [
      {
        type: "function",
        function: {
          name: "lookup_weather",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
    ],
  }

  await createChatCompletions(payload)

  const body = JSON.parse(
    (fetchMock.mock.calls[0][1] as { body: string }).body,
  ) as Record<string, unknown>

  expect(body.reasoning_effort).toBeUndefined()
  expect(body.max_completion_tokens).toBe(128)
})
