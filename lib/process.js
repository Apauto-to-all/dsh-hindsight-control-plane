/**
 * 端口与进程的底层探测：谁在听、还活着吗、占着不放的是谁、怎么整棵送走。
 *
 * 全部拿不到信息时返回 0 / '' / false，绝不抛错——调用方按“取不到”处理，
 * 这些函数常在启动路径上，抛一次整个插件就起不来。
 */
import { execFile } from 'node:child_process'
import { connect } from 'node:net'

const PROBE_TIMEOUT_MS = 2000
const PORT_WAIT_MS = 8000

/** 端口能不能连上；连上说明有东西在听。 */
export function portOpen(port, timeoutMs = 600) {
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
export async function consoleAnswers(port) {
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
export async function waitPortFree(port) {
  const deadline = Date.now() + PORT_WAIT_MS
  while (Date.now() < deadline) {
    if (!await portOpen(port, 300)) return true
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return !await portOpen(port, 300)
}

/** 监听某个端口的进程号，取不到返回 0。 */
export async function listeningPid(port) {
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
export async function processImage(pid) {
  const text = await run('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
  return text.match(/^"([^"]+)"/)?.[1] ?? ''
}

/** 连子进程一起杀掉，端口才真的空出来。 */
export function killTree(pid) {
  return run('taskkill', ['/pid', String(pid), '/t', '/f'])
}

/** 跑一条命令取标准输出；失败就当没输出。
 *  execFile 在部分环境（沙箱、权限不足）会同步抛错，所以整段包在 try 里。 */
export function run(command, args) {
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
