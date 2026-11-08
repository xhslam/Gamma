interface FetchDependencies {
  fetch: (url: string | URL, options: RequestInit) => Promise<Response>
  sleep: (milliseconds: number) => Promise<void>
}

/** 只重试临时网络故障；404 等永久错误交由调用者处理，最终失败不得降级成成功。 */
export async function fetchWithRetry(
  url: string | URL,
  options: RequestInit,
  dependencies: FetchDependencies = { fetch: (input, init) => fetch(input, init), sleep: milliseconds => Bun.sleep(milliseconds) },
): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await dependencies.fetch(url, { ...options, signal: AbortSignal.timeout(120_000) })
      if (attempt === 3 || !(response.status === 408 || response.status === 429 || response.status >= 500)) return response
      await response.body?.cancel()
      console.warn(`[下载] HTTP ${response.status}，准备第 ${attempt + 1}/3 次请求`)
    } catch (error) {
      if (attempt === 3) throw error
      console.warn(`[下载] 网络请求失败，准备第 ${attempt + 1}/3 次请求：${String(error)}`)
    }
    await dependencies.sleep(attempt * 10_000)
  }
}
