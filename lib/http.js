/** 两条路由共用的请求/响应小工具。 */

/** 读一个 JSON 请求体；超过 16 KiB 直接拒绝，不把内存交给调用方。 */
export async function readJsonBody(request) {
  const chunks = []
  let total = 0
  for await (const chunk of request) {
    total += chunk.length
    if (total > 16 * 1024) {
      const error = new Error('设置内容过大')
      error.status = 413
      request.destroy()
      throw error
    }
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new Error('请求体要是 JSON 对象')
  }
}

export function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}
