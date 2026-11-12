/**
 * Host half: starts the Hindsight control plane and publishes its address to the
 * browser half, which embeds it in the main panel.
 *
 * The defaults below mirror the console's own bin/cli.js (v1.2.1): PORT 9999,
 * HOSTNAME 0.0.0.0, and no --api-url default. Config values that are absent are
 * not passed at all, so the console keeps its own defaults.
 */
import { spawn } from 'node:child_process'

const PACKAGE = '@vectorize-io/hindsight-control-plane'
const DEFAULT_PORT = 9999
const DEFAULT_VERSION = 'latest'
const URL_PATH = '/dsh-hindsight-control-plane/url'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const bind = typeof config.hostname === 'string' ? config.hostname.trim() : ''
  const port = portOf(config.port)
  const url = `http://${browserHost(bind)}:${port}`

  // The browser half cannot read Host config, so it asks this route when it
  // mounts. Fetching at mount keeps the answer independent of when the page's
  // HTML was generated.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: URL_PATH,
    handler: (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405, { allow: 'GET' })
        response.end()
        return
      }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      response.end(JSON.stringify({ url }))
    },
  }))

  ctx.effect(() => launch(config, port, bind))
}

/** Spawn the console; the returned disposer stops it with the plugin. */
function launch(config, port, bind) {
  const args = ['-y', `${PACKAGE}@${versionOf(config.version)}`]
  if (typeof config.apiUrl === 'string' && config.apiUrl.trim()) {
    args.push('--api-url', config.apiUrl.trim())
  }
  if (config.port != null) args.push('--port', String(port))
  if (bind) args.push('--hostname', bind)

  const child = spawnNpx(args)
  let tail = ''
  let stopped = false

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
  // npx is a .cmd shim and cannot start without a shell, while Node's shell:true
  // re-quotes argv (DEP0190). Build the command line and let cmd.exe parse it.
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
  // ponytail: one tree kill, no graceful tier — npx, node, and the Next server
  // must all go or the port stays taken for the next launch.
  spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
}

function portOf(raw) {
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT
}

function versionOf(raw) {
  const version = typeof raw === 'string' ? raw.trim() : ''
  return /^[A-Za-z0-9.^~<>=*-]+$/.test(version) ? version : DEFAULT_VERSION
}

/** 0.0.0.0 and :: bind every interface but are not browsable addresses. */
function browserHost(bind) {
  return !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind
}