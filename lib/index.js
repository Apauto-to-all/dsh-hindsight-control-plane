/**
 * 宿主半边入口：把控制台的地址交给浏览器半边，并持有四项启动设置。
 *
 * 设置就是这一行的 cordis `config`，由插件页上的卡片编辑。写入走
 * `configEditor.edit()`，它会持久化到 profile 的 patch 层并让 Loader 重新协调，
 * 所以这些值在任何地方都只有一份。
 *
 * 这里只放入口和两条路由；其余按职责分在 lib/ 下：
 *   settings.js —— 设置怎么规整、怎么校验、推出什么地址
 *   console.js  —— 控制台进程怎么拼、什么时候不该起、怎么停
 *   process.js  —— 端口在听吗、占着的是谁、怎么送走
 *   http.js     —— 读请求体、回 JSON
 */
import { commandOf, launch } from './console.js'
import { readJsonBody, sendJson } from './http.js'
import { addressOf, normalize, validate } from './settings.js'

const ROW_ID = 'dsh-hindsight-control-plane'
const URL_PATH = '/dsh-hindsight-control-plane/url'
const SETTINGS_PATH = '/dsh-hindsight-control-plane/settings'

export const inject = ['webServer', 'configEditor']

export function apply(ctx, config = {}) {
  const state = { settings: normalize(config) }

  // launch 是异步的：effect 接受 Promise<disposer>，卸载时会等它落定再清理。
  ctx.effect(async () => {
    try {
      return await launch(state.settings)
    } catch (error) {
      // 起不来也不该让插件挂掉：地址路由照常可用，页面会停在等待态。
      console.error(`[hindsight-control-plane] 启动失败：${error?.message ?? error}`)
      return () => {}
    }
  }, 'hindsight-control-plane: console')

  // 浏览器半边读不到宿主状态，所以挂载时来问这两条路由。挂载时现取，
  // 答案就与页面 HTML 是什么时候生成的无关。
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: URL_PATH,
    handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      sendJson(response, 200, { url: addressOf(state.settings) })
    },
  }))

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: SETTINGS_PATH,
    handler: async (request, response) => {
      if (request.method === 'GET') {
        sendJson(response, 200, {
          ok: true,
          settings: state.settings,
          url: addressOf(state.settings),
          command: commandOf(state.settings),
        })
        return
      }
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'GET, POST' })
        response.end()
        return
      }
      let body
      try {
        body = await readJsonBody(request)
      } catch (error) {
        sendJson(response, error.status ?? 400, { ok: false, error: error.message })
        return
      }
      const next = normalize(body)
      const problem = validate(next)
      if (problem) {
        sendJson(response, 400, { ok: false, error: problem })
        return
      }
      const entry = findEntry(ctx)
      if (!entry) {
        sendJson(response, 409, { ok: false, error: '找不到这一行，无法保存设置' })
        return
      }
      try {
        await ctx.configEditor.edit(entry, current => ({ ...current, ...next }))
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error?.message ?? '保存失败' })
        return
      }
      state.settings = next
      // 不在这里重启：configEditor.edit() 会让 Loader 重新协调这一行，
      // apply() 会带着新 config 再执行一次并起新的控制台。
      // 在这里也起一次就会有两个进程抢同一个端口，抢输的那个会卡死。
      sendJson(response, 200, { ok: true, settings: next, url: addressOf(next), command: commandOf(next) })
    },
  }))
}

/** 找到本插件自己的 Loader 行。
 *  patch id 就是包名，但 entry.id 带 include: 前缀，所以几个字段都看一遍。 */
function findEntry(ctx) {
  let rows
  try {
    rows = ctx.configEditor.configuration()
  } catch {
    return undefined
  }
  const hit = rows.find(item => {
    const entry = item?.entry
    if (!entry) return false
    return entry.patchId === ROW_ID
      || entry.name === ROW_ID
      || entry.id === ROW_ID
      || (typeof entry.id === 'string' && entry.id.endsWith(`:${ROW_ID}`))
  })
  return hit?.entry
}
