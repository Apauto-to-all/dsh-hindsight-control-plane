/**
 * 宿主半边：拉起 Hindsight 控制台、把它的地址交给浏览器半边，并持有四项启动设置。
 *
 * 设置就是这一行的 cordis `config`，由插件页上的卡片编辑。写入走
 * `configEditor.edit()`，它会持久化到 profile 的 patch 层并让 Loader 重新协调，
 * 所以这些值在任何地方都只有一份。
 *
 * 默认值取自控制台自己的 bin/cli.js（v1.2.1）：端口 9999、绑定 0.0.0.0、
 * 没有 --api-url 默认值。没有配置的项完全不传，让控制台用自己的默认值。
 *
 * 启动前先看端口：已在跑且应答就复用，绝不并排起第二个；被占但不应答时，
 * 只在确认对方是本控制台的 node 进程后才清掉。两个控制台抢同一端口会双双卡死。
 */
import { execFile, spawn } from 'node:child_process'
import { connect } from 'node:net'

const PACKAGE = '@vectorize-io/hindsight-control-plane'
const ROW_ID = 'dsh-hindsight-control-plane'
const DEFAULT_PORT = 9999
const DEFAULT_VERSION = 'latest'
const URL_PATH = '/dsh-hindsight-control-plane/url'
const SETTINGS_PATH = '/dsh-hindsight-control-plane/settings'
const PROBE_TIMEOUT_MS = 2000
const PORT_WAIT_MS = 8000

export const inject = ['webServer', 'configEditor']

export function apply(ctx, config = {}) {
  const state = { settings: normalize(config) }

  // launch 是异步的：effect 接受 Promise<disposer>，卸载时会等它落定再清理。
  ctx.effect(async () => {
    try {
      return await launch(state)
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

/** 端口已经是我们的控制台就复用，是正在退出的旧实例就等它走，都没有才启动。 */
async function launch(state) {
  const port = portOf(state.settings.port)

  if (await portOpen(port)) {
    if (await consoleAnswers(port)) {
      console.log(`[hindsight-control-plane] 端口 ${port} 上已有控制台在跑，直接复用`)
      return () => {}
    }
    // 端口被占却不应答：可能是上一个实例还在退出。先等它自己走。
    if (await waitPortFree(port)) {
      console.log(`[hindsight-control-plane] 端口 ${port} 已空出，正常启动`)
      return startConsole(state.settings)
    }
    // 等不到就只清掉确实是 node 的进程，避免误杀用户自己占着这个端口的程序。
    const pid = process.platform === 'win32' ? await listeningPid(port) : 0
    const image = pid ? await processImage(pid) : ''
    if (pid && /^node(\.exe)?$/i.test(image)) {
      console.warn(`[hindsight-control-plane] 端口 ${port} 被卡住的旧进程 ${pid} 占用，清掉后重启`)
      await killTree(pid)
      if (await waitPortFree(port)) return startConsole(state.settings)
    }
    console.error(`[hindsight-control-plane] 端口 ${port} 被${pid ? `进程 ${pid}（${image || '未知'}）` : '其他程序'}占用且不应答，这次不启动，避免再卡一个`)
    return () => {}
  }

  return startConsole(state.settings)
}

/** 拉起控制台；返回的 disposer 负责停掉它。 */
function startConsole(settings) {
  const args = argvFor(settings)
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
    console.error(`[hindsight-control-plane] 控制台退出，码 ${code}\n${tail}`)
  })

  return () => {
    stopped = true
    stop(child)
  }
}

/** 命令行参数；spawn 和页面展示共用这一份，避免两处走样。 */
function argvFor(settings) {
  const args = ['-y', `${PACKAGE}@${versionOf(settings.version)}`]
  if (settings.apiUrl) args.push('--api-url', settings.apiUrl)
  if (settings.port) args.push('--port', String(portOf(settings.port)))
  if (settings.hostname) args.push('--hostname', settings.hostname)
  return args
}

/** 页面展示用的完整命令；没配置的项不会出现在里面。 */
function commandOf(settings) {
  return ['npx', ...argvFor(settings)].join(' ')
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
  killTree(child.pid)
}
/** 端口能不能连上；连上说明有东西在听。 */
function portOpen(port, timeoutMs = 600) {
  return new Promise(resolve => {
    const socket = connect({ port, host: '127.0.0.1' })
    const finish = value => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** 控制台能不能应答；接受连接却永远不回，就是卡死。 */
async function consoleAnswers(port) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal, redirect: 'manual' })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** 等到端口空出来；超时返回 false。 */
async function waitPortFree(port) {
  const deadline = Date.now() + PORT_WAIT_MS
  while (Date.now() < deadline) {
    if (!await portOpen(port, 300)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return !await portOpen(port, 300)
}

/** 监听某个端口的进程号，取不到返回 0。 */
async function listeningPid(port) {
  const text = await run('netstat', ['-ano'])
  for (const line of text.split(/\r?\n/)) {
    if (!/LISTENING\s+\d+\s*$/.test(line)) continue
    const local = line.trim().split(/\s+/)[1] ?? ''
    if (local.endsWith(`:${port}`)) {
      const pid = Number(line.trim().match(/LISTENING\s+(\d+)/)?.[1])
      if (Number.isInteger(pid) && pid > 0) return pid
    }
  }
  return 0
}

/** 进程的可执行文件名，例如 node.exe；取不到返回空串。 */
async function processImage(pid) {
  const text = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  return text.match(/^"([^"]+)"/)?.[1] ?? ''
}

function killTree(pid) {
  return run('taskkill', ['/pid', String(pid), '/t', '/f'])
}

/** 跑一条命令取标准输出；失败就当没输出，调用方按“取不到”处理。
 *  execFile 在部分环境（沙箱、权限不足）会同步抛错，所以整段包在 try 里。 */
function run(command, args) {
  return new Promise(resolve => {
    try {
      execFile(command, args, { windowsHide: true, timeout: 5000 }, (error, stdout) => {
        resolve(error ? '' : String(stdout))
      })
    } catch {
      resolve('')
    }
  })
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