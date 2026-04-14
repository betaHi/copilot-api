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

// Helper to mock fetch
const fetchMock = mock(
  (_url: string, opts: { headers: Record<string, string>; body?: string }) => {
    return {
      ok: true,
      json: () => ({ id: "123", object: "chat.completion", choices: [] }),
      headers: opts.headers,
      body: opts.body,
    }
  },
)
// @ts-expect-error - Mock fetch doesn't implement all fetch properties
;(globalThis as unknown as { fetch: typeof fetch }).fetch = fetchMock

afterEach(() => {
  fetchMock.mockClear()
  delete process.env.COPILOT_REASONING_EFFORT
  process.env.HOME = originalHome
})

const originalHome = process.env.HOME

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

  expect(body.reasoning_effort).toBe("max")
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

    expect(body.reasoning_effort).toBe("max")
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})
