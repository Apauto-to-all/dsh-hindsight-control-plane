/**
 * 控制台进程本身：命令行怎么拼、什么时候不该起、怎么停。
 *
 * 启动前先看端口：已在跑且应答就复用，绝不并排起第二个；被占但不应答时，
 * 只在确认对方是本控制台的 node 进程后才清掉。两个控制台抢同一端口会双双卡死。
 */
import { spawn } from 'node:child_process'
import { portOf, versionOf } from './settings.js'
import { consoleAnswers, killTree, listeningPid, portOpen, processImage, waitPortFree } from './process.js'

const PACKAGE = '@vectorize-io/hindsight-control-plane'
const LOG = '[hindsight-control-plane]'

/** 端口已经是我们的控制台就复用，是正在退出的旧实例就等它走，都没有才启动。 */
export async function launch(settings) {
  const port = portOf(settings.port)

  if (await portOpen(port)) {
    if (await consoleAnswers(port)) {
      console.log(`${LOG} 端口 ${port} 上已有控制台在跑，直接复用`)
      return () => {}
    }
    // 端口被占却不应答：可能是上一个实例还在退出。先等它自己走。
    if (await waitPortFree(port)) {
      console.log(`${LOG} 端口 ${port} 已空出，正常启动`)
      return startConsole(settings)
    }
    // 等不到就只清掉确实是 node 的进程，避免误杀用户自己占着这个端口的程序。
    const pid = process.platform === 'win32' ? await listeningPid(port) : 0
    const image = pid ? await processImage(pid) : ''
    if (pid && /^node(\.exe)?$/i.test(image)) {
      console.warn(`${LOG} 端口 ${port} 被卡住的旧进程 ${pid} 占用，清掉后重启`)
      await killTree(pid)
      if (await waitPortFree(port)) return startConsole(settings)
    }
    console.error(`${LOG} 端口 ${port} 被${pid ? `进程 ${pid}（${image || '未知'}）` : '其他程序'}占用且不应答，这次不启动，避免再卡一个`)
    return () => {}
  }

  return startConsole(settings)
}

/** 拉起控制台；返回的 disposer 负责停掉它。 */
export function startConsole(settings) {
  const child = spawnNpx(argvFor(settings))
  let stopped = false
  let tail = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { tail = (tail + chunk).slice(-2000) })
  child.on('error', error => {
    console.error(`${LOG} ${error.message}`)
  })
  child.on('exit', code => {
    if (stopped || !code) return
    console.error(`${LOG} 控制台退出，码 ${code}\n${tail}`)
  })

  return () => {
    stopped = true
    stop(child)
  }
}

/** 命令行参数；spawn 和页面展示共用这一份，避免两处走样。 */
export function argvFor(settings) {
  const args = ['-y', `${PACKAGE}@${versionOf(settings.version)}`]
  if (settings.apiUrl) args.push('--api-url', settings.apiUrl)
  if (settings.port) args.push('--port', String(portOf(settings.port)))
  if (settings.hostname) args.push('--hostname', settings.hostname)
  return args
}

/** 页面展示用的完整命令；没配置的项不会出现在里面。 */
export function commandOf(settings) {
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
