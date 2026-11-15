/**
 * 四项启动设置：规整、校验，以及从设置推导出浏览器能访问的地址。
 *
 * 端口和 api-url 没有配置就完全不传，让控制台用自己的默认值
 * （9999 / http://localhost:8888 —— 后者不是本机的 Hindsight 服务）。
 * 绑定地址是例外：控制台自己的默认值是 0.0.0.0，等于把记忆数据开放给整个
 * 局域网，所以留空一律按 127.0.0.1 传；要开局域网得显式填 0.0.0.0。
 */

export const DEFAULT_PORT = 9999
export const DEFAULT_HOSTNAME = '127.0.0.1'
export const DEFAULT_VERSION = 'latest'

/** 缺省、空白、类型不对的值一律归零，只留字符串。 */
export function normalize(raw) {
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
export function validate(settings) {
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

/** 浏览器该访问的地址。 */
export function addressOf(settings) {
  return `http://${browserHost(hostnameOf(settings.hostname))}:${portOf(settings.port)}`
}

/** 端口取不到或越界时退回默认值。 */
export function portOf(raw) {
  const port = Number(raw)
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT
}

/** 绑定地址留空就是本机回环，不回落到控制台自己的 0.0.0.0。 */
export function hostnameOf(raw) {
  const host = typeof raw === 'string' ? raw.trim() : ''
  return host || DEFAULT_HOSTNAME
}

/** 版本串只允许能安全拼进命令行的字符。 */
export function versionOf(raw) {
  const version = typeof raw === 'string' ? raw.trim() : ''
  return /^[A-Za-z0-9.^~<>=*-]+$/.test(version) ? version : DEFAULT_VERSION
}

/** 0.0.0.0 和 :: 绑定所有网卡，但不是浏览器能访问的地址。 */
function browserHost(bind) {
  return !bind || bind === '0.0.0.0' || bind === '::' ? '127.0.0.1' : bind
}
