import { randomUUID } from 'node:crypto'
import { buildGithubCopilotModel, buildXaiModel } from './adapters/pi-model-registry'
import { resolveGithubCopilotOAuthCredentials, resolveXaiOAuthCredentials, persistGithubCopilotOAuthCredentials, persistXaiOAuthCredentials } from './channel-manager'
import { closePiRequestProxyDispatcher, createPiRequestProxyDispatcher, installPiRequestProxyFetch, runWithPiRequestProxy } from './adapters/pi-request-proxy'

export interface AutomaticMemoryOAuthInput {
  provider: 'github-copilot' | 'xai'
  channelId: string
  modelId: string
  prompt: string
  signal: AbortSignal
  proxyUrl?: string
}

/** OAuth token不能发给普通OpenAI adapter；沿用Pi的内存凭据与订阅路由。 */
export async function extractAutomaticMemoryOAuth(input: AutomaticMemoryOAuthInput): Promise<string> {
  const sdk = await import('@earendil-works/pi-coding-agent')
  let copilotCredentials = input.provider === 'github-copilot'
    ? await resolveGithubCopilotOAuthCredentials(input.channelId) : undefined
  const { modelRuntime, model } = input.provider === 'github-copilot'
    ? await buildGithubCopilotModel(sdk, {
      model: input.modelId,
      githubCopilotOAuthCredentials: copilotCredentials,
      onGithubCopilotOAuthCredentialsRefreshed: (credentials) => {
        if (copilotCredentials && persistGithubCopilotOAuthCredentials(input.channelId, credentials, copilotCredentials)) copilotCredentials = credentials
      },
    })
    : await buildXaiModel(sdk, {
      channelId: input.channelId, model: input.modelId,
      xaiOAuthCredentials: await resolveXaiOAuthCredentials(input.channelId),
      onXaiOAuthCredentialsRefreshed: (credentials) => persistXaiOAuthCredentials(input.channelId, credentials),
    })
  const dispatcher = createPiRequestProxyDispatcher({ proxyUrl: input.proxyUrl, httpIdleTimeoutMs: 30_000 })
  try {
    installPiRequestProxyFetch()
    const response = await runWithPiRequestProxy(dispatcher, () => modelRuntime.complete(model, {
      messages: [{ role: 'user', content: input.prompt, timestamp: Date.now() }],
    }, { signal: input.signal, maxTokens: 2048, timeoutMs: 30_000, maxRetries: 0, sessionId: randomUUID() }))
    if (response.stopReason === 'error' || response.stopReason === 'aborted' || response.stopReason === 'length') {
      throw new Error('记忆订阅模型请求未完整结束')
    }
    return response.content.filter((block) => block.type === 'text').map((block) => block.type === 'text' ? block.text : '').join('')
  } finally {
    await closePiRequestProxyDispatcher(dispatcher)
  }
}
