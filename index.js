/**
 * 宿主半边：拉起 Hindsight 控制台、把它的地址交给浏览器半边，并持有四项启动设置。
 *
 * 设置就是这一行的 cordis `config`，由插件页上的卡片编辑。写入走
 * `configEditor.edit()`，它会持久化到 profile 的 patch 层并让 Loader 重新协调，
 * 所以这些值在任何地方都只有一份。
 *
 * 默认值取自控制台自己的 bin/cli.js（v1.2.1）：端口 9999、绑定 0.0.0.0、
 * 没有 --api-url 默认值。没有配置的项完全不传，让控制台用自己的默认值。
 */
import { spawn } from 'node:child_process'

const PACKAGE = '@vectorize-io/hindsight-control-plane'
const ROW_ID = 'dsh-hindsight-control-plane'
const DEFAULT_PORT = 9999
const DEFAULT_VERSION = 'latest'
const URL_PATH = '/dsh-hindsight-control-plane/url'
const SETTINGS_PATH = '/dsh-hindsight-control-plane/settings'

export const inject = ['webServer', 'configEditor']

export function apply(ctx, config = {}) {
  const state = { settings: normalize(config), dispose: undefined }

  const restart = () => {
    state.dispose?.()
    state.dispose = startConsole(state.settings)
  }
  restart()

  ctx.effect(() => () => {
    state.dispose?.()
    state.dispose = undefined
  })

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
        sendJson(response, 200, { ok: true, settings: state.settings, url: addressOf(state.settings) })
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
      // Loader 是异步重新协调这一行的；这里同时重启一次，保证即使当前闭包没有被
      // 重新执行，控制台也会按新参数起来。
      restart()
      sendJson(response, 200, { ok: true, settings: next, url: addressOf(next) })
    },
  }))
}

/** 找到本插件自己的 Loader 行：先按 patch id，再按包名。 */
function findEntry(ctx) {
  const rows = ctx.configEditor.configuration()
  const row = rows.find(item => item.entry?.id === ROW_ID) ?? rows.find(item => item.entry?.name === ROW_ID)
  return row?.entry
}

/** 拉起控制台；返回的 disposer 负责停掉它。 */
function startConsole(settings) {
  const args = ['-y', `${PACKAGE}@${versionOf(settings.version)}`]
  if (settings.apiUrl) args.push('--api-url', settings.apiUrl)
  if (settings.port) args.push('--port', String(portOf(settings.port)))
  if (settings.hostname) args.push('--hostname', settings.hostname)

  const child = spawnNpx(args)
  let stopped = false
  let tail = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-2000) })
  child.on('error', error => {
    console.error(`[hindsight-control-plane] ${error.message}`)
  })
  child.on('exit', code => {
    if (stopped || !code) return
    console.error(`[hindsight-control-plane] console exited with ${code}\n${tail}`)
  })

  return () => {
    stopped = true
    stop(child)
  }
}

function spawnNpx(args) {
  if (process.platform !== 'win32') {
    return spawn('npx', args, { stdio: ['ignore', 'ignore', 'pipe'] })
  }
  // npx 在 Windows 上是个 .cmd 垫片，没有 shell 起不来；而 Node 的 shell:true 会
  // 重新拼一遍参数（DEP0190）。所以自己拼命令行，交给 cmd.exe 解析。
  const line = ['npx', ...args].map(quoteForCmd).join(' ')
  return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    stdio: ['ignore', 'ignore', 'pipe'],
    shell: false,
    windowsVerbatimArguments: true,
    windowsHide: true,
  })
}

function quoteForCmd(value) {
  return /[\s"&|<>^()]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function stop(child) {
  if (process.platform !== 'win32') {
    child.kill('SIGTERM')
    return
  }
  // ponytail: 直接整棵进程树杀掉，不做优雅退出的分层处理 —— npx、node、Next 服务
  // 都得走，否则端口被占着，下次起不来。
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}

function normalize(raw) {
  const value = raw && typeof raw === 'object' ? raw : {}
  const text = key => (typeof value[key] === 'string' ? value[key].trim() : '')
  return {
    apiUrl: text('apiUrl'),
    port: text('port'),
    hostname: text('hostname'),
    version: text('version') || DEFAULT_VERSION,
  }
}

/** 能启动就返回空串，否则返回一句问题说明。 */
function validate(settings) {
  if (settings.apiUrl && !/^https?:\/\//i.test(settings.apiUrl)) {
    return '记忆服务地址要以 http:// 或 https:// 开头'
  }
  if (settings.port) {
    const port = Number(settings.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return '端口要是 1 到 65535 之间的整数'
  }
  if (settings.hostname && !/^[A-Za-z0-9.:[\]-]+$/.test(settings.hostname)) {
    return '绑定地址要写成 127.0.0.1 或 0.0.0.0 这样的地址'
  }
  if (!/^[A-Za-z0-9.^~<>=*-]+$/.test(settings.version)) {
    return '版本要写成 latest、1.2.1 或 ^1.2.0 这样的值'
  }
  return ''
}

function addressOf(settings) {
  return `http://${browserHost(settings.hostname)}:${portOf(settings.port)}`
}

async function readJsonBody(request) {
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

function sendJson(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

function portOf(raw) {
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT
}

function versionOf(raw) {
  const version = typeof raw === 'string' ? raw.trim() : ''
  return /^[A-Za-z0-9.^~<>=*-]+$/.test(version) ? version : DEFAULT_VERSION
}

/** 0.0.0.0 和 :: 绑定所有网卡，但不是浏览器能访问的地址。 */
function browserHost(bind) {
  return !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind
}