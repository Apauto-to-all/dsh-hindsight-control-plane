window.__ModuleLoader__.load({
  id: 'dsh-hindsight-control-plane',
  factory(require) {
    // 浏览器半边：侧栏按钮、主区域面板、插件页上的设置卡片。
    //
    // 单文件是刻意的：DSH 一个包只加载一个客户端文件（同机的 dsh-pet、
    // dsh-notify-me、modsearch 发布出来的也全是打包好的单文件），拆成多文件
    // 就得引打包器，改一行就要 build。所以用分节代替分包：
    //   1. 常量与样式   2. 设置字段表   3. 图标与等待态
    //   4. 面板（含 iframe 保活）   5. 设置卡片   6. 槽位注册
    const React = require('react')
    const h = React.createElement

    // ---- 1. 常量与样式 ----
    const URL_PATH = '/dsh-hindsight-control-plane/url'
    const SETTINGS_PATH = '/dsh-hindsight-control-plane/settings'
    const CHANGED = 'dsh-hindsight-control-plane:changed'

    const mono = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'

    const rowStyle = { height: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex' }
    const hostStyle = { flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex' }
    const spinnerStyle = {
      width: 32,
      height: 32,
      borderRadius: '50%',
      border: '3px solid currentColor',
      borderTopColor: 'transparent',
      opacity: 0.6,
      animation: 'hcp-spin 0.9s linear infinite',
    }
    const cardStyle = {
      display: 'grid',
      gap: 14,
      padding: '14px 16px',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: 12,
      background: 'var(--dsw-alias-bg-layer-2)',
    }
    const fieldStyle = {
      width: '100%',
      height: 32,
      padding: '0 10px',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 13,
    }
    const headStyle = { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }
    const titleStyle = { fontSize: 13, color: 'var(--dsw-alias-label-primary)', fontWeight: 500 }
    const hintStyle = { margin: 0, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
    const flagStyle = { fontFamily: mono, fontSize: 12, color: 'var(--dsw-alias-label-secondary)' }
    const commandStyle = {
      margin: 0,
      padding: '8px 10px',
      border: '0.5px solid var(--dsw-alias-border-l2)',
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: mono,
      fontSize: 12,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all',
    }
    const buttonStyle = {
      height: 32,
      padding: '0 14px',
      border: 0,
      borderRadius: 8,
      background: 'var(--dsw-alias-state-business-primary)',
      color: '#fff',
      font: 'inherit',
      fontSize: 13,
      cursor: 'pointer',
    }

    // ---- 2. 设置字段表 ----
    // 每项都标出它落到命令行上的位置，避免“这一格到底改了什么”的误解。
    const FIELDS = [
      {
        key: 'apiUrl',
        label: '记忆服务地址（Memory service URL）',
        flag: '--api-url',
        hint: '控制台读取的 Hindsight 接口，例如 http://127.0.0.1:9077；留空则用控制台默认值（empty = console default）',
      },
      {
        key: 'port',
        label: '控制台端口（Console port）',
        flag: '--port',
        hint: '控制台监听端口；留空则用 9999（empty = 9999）',
        inputMode: 'numeric',
      },
      {
        key: 'hostname',
        label: '绑定地址（Bind address）',
        flag: '--hostname',
        hint: '控制台绑定的网卡地址；留空则用 0.0.0.0（empty = 0.0.0.0）',
      },
      {
        key: 'version',
        label: '包版本（Package version）',
        flag: '',
        hint: '安装的版本或范围，例如 latest、1.2.1；留空则用 latest（empty = latest）',
      },
    ]

    // ---- 3. 图标与等待态 ----
    function Icon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 3.5, y: 4, width: 17, height: 5, rx: 1.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        h('rect', { x: 3.5, y: 11, width: 17, height: 4, rx: 1.4, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.75 }),
        h('rect', { x: 3.5, y: 17, width: 17, height: 3, rx: 1.2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, opacity: 0.5 }))
    }

    function Waiting() {
      return h('div', {
        role: 'status',
        'aria-label': '正在启动 Hindsight 控制台（starting the console）',
        style: { flex: '1 1 auto', display: 'grid', placeItems: 'center' },
      },
        h('style', null, '@keyframes hcp-spin{to{transform:rotate(360deg)}}'),
        h('div', { style: spinnerStyle }))
    }

    // ---- 4. 面板 ----
    // 面板一卸载，React 就会连 iframe 一起拆掉，控制台的页面被重载回首页。
    // 把 iframe 挪到别处挂着也不行：上一版把帧搬来搬去，实测切回来还是重载了。
    // 所以 iframe 干脆不进 React 树：
    // 它常驻在 document.body 下的固定层里，面板只留一个空位，按空位的矩形把它
    // 盖上去，切走时收起这一层。文档从头到尾没被搬动过。
    // ponytail: 只在同一个 DSH 页面生命周期内有效。刷新或重启 DSH，iframe 随
    // 页面销毁，而控制台在另一个源上（:端口不同），读不到它的地址，重开只能回首页。
    let kept = null
    let shell = null

    function shellNode() {
      if (shell) return shell
      shell = document.createElement('div')
      // 自己常驻、从不被搬动；位置和大小每次都按面板空位现算。
      shell.style.cssText = 'position:fixed;display:none;overflow:hidden;z-index:10'
      document.body.appendChild(shell)
      return shell
    }

    function makeFrame(url) {
      const node = document.createElement('iframe')
      node.src = url
      node.title = 'Hindsight 控制台（Hindsight console）'
      node.style.cssText = 'width:100%;height:100%;border:0;display:block'
      return node
    }

    /** 把这一层盖到面板空位上；空位被藏起来（尺寸归零）时，这一层跟着藏。 */
    function cover(box) {
      const rect = box.getBoundingClientRect()
      if (!rect.width || !rect.height) {
        uncover()
        return
      }
      const node = shellNode()
      node.style.display = 'block'
      node.style.left = `${rect.left}px`
      node.style.top = `${rect.top}px`
      node.style.width = `${rect.width}px`
      node.style.height = `${rect.height}px`
    }

    /** 藏起来而不是 display:none：视口尺寸保住了，帧里的滚动位置才不会归零。 */
    function uncover() {
      if (shell) shell.style.left = '-20000px'
    }

    function Panel() {
      // null = 还在问宿主；'' = 宿主答复了但没有地址。
      const [url, setUrl] = React.useState(null)
      const [ready, setReady] = React.useState(false)
      const [nonce, setNonce] = React.useState(0)
      const slot = React.useRef(null)

      // 保存设置会重启控制台，面板要重新取一次地址。
      React.useEffect(() => {
        const reload = () => setNonce(value => value + 1)
        window.addEventListener(CHANGED, reload)
        return () => window.removeEventListener(CHANGED, reload)
      }, [])

      React.useEffect(() => {
        let live = true
        setUrl(null)
        setReady(false)
        fetch(URL_PATH, { cache: 'no-store' })
          .then(res => (res.ok ? res.json() : null))
          .then(body => {
            if (live) setUrl(body && typeof body.url === 'string' ? body.url : '')
          }, () => {
            if (live) setUrl('')
          })
        return () => {
          live = false
        }
      }, [nonce])

      // 首次 npx 要下载控制台，所以在地址应答之前不挂 iframe；
      // 没有服务在听时，no-cors 探测会直接失败。
      React.useEffect(() => {
        if (!url || ready) return
        // 挂着的那个 iframe 就是这个地址，直接接回来，不必再探一次。
        if (kept && kept.url === url) {
          setReady(true)
          return
        }
        let live = true
        let timer
        const probe = () => {
          fetch(url, { mode: 'no-cors', cache: 'no-store' }).then(() => {
            if (live) setReady(true)
          }, () => {
            if (live) timer = setTimeout(probe, 1000)
          })
        }
        probe()
        return () => {
          live = false
          clearTimeout(timer)
        }
      }, [url, ready])

      // 地址变了（改了设置、控制台换了端口）才换新靶子，否则还是原来那一页。
      React.useEffect(() => {
        const box = slot.current
        if (!box || !ready || !url) return
        if (!kept || kept.url !== url) {
          if (kept) kept.node.remove()
          kept = { url, node: makeFrame(url) }
        }
        const node = shellNode()
        if (kept.node.parentNode !== node) node.appendChild(kept.node)
        const sync = () => cover(box)
        sync()
        // 面板空位的尺寸一动（窗口缩放、侧栏收放）就重新盖一次。
        const observer = new ResizeObserver(sync)
        observer.observe(box)
        window.addEventListener('resize', sync)
        return () => {
          observer.disconnect()
          window.removeEventListener('resize', sync)
          uncover()
        }
      }, [url, ready])

      if (url === '') {
        return h('div', { style: { padding: 16 } }, '宿主没有提供控制台地址（the Host published no address）。')
      }
      return h('div', { style: rowStyle }, ready && url
        ? h('div', { ref: slot, style: hostStyle })
        : h(Waiting))
    }

    // ---- 5. 设置卡片 ----
    function ConfigCard(props) {
      const [draft, setDraft] = React.useState(null)
      const [saved, setSaved] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const [error, setError] = React.useState('')

      React.useEffect(() => {
        let live = true
        fetch(SETTINGS_PATH, { cache: 'no-store' })
          .then(res => (res.ok ? res.json() : null))
          .then(body => {
            if (!live) return
            if (body && body.ok) {
              setDraft(body.settings)
              setSaved(body)
              setStatus('ready')
            } else {
              setStatus('error')
              setError((body && body.error) || '读不到设置（cannot read settings）。')
            }
          }, () => {
            if (!live) return
            setStatus('error')
            setError('读不到设置（cannot read settings）。')
          })
        return () => {
          live = false
        }
      }, [])

      if (props && props.view === 'summary') {
        return h('span', { style: hintStyle }, saved && saved.url ? saved.url : 'Hindsight 控制台（Hindsight console）')
      }

      const change = key => event => {
        const value = event.target.value
        setDraft(current => ({ ...current, [key]: value }))
      }

      const save = () => {
        setStatus('saving')
        setError('')
        fetch(SETTINGS_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(draft),
        }).then(res => res.json().then(body => ({ ok: res.ok, body })), () => ({ ok: false, body: null }))
          .then(({ ok, body }) => {
            if (!ok || !body || !body.ok) {
              setStatus('error')
              setError((body && body.error) || '保存失败（save failed）。')
              return
            }
            setDraft(body.settings)
            setSaved(body)
            setStatus('saved')
            window.dispatchEvent(new Event(CHANGED))
          })
      }

      if (!draft) {
        return h('div', { style: cardStyle },
          h('p', { style: hintStyle, role: 'status' }, status === 'error' ? error : '正在读取设置（loading settings）…'))
      }

      const note = status === 'error'
        ? error
        : status === 'saved'
          ? `已保存，控制台正在重启（saved, restarting）：${saved.url}`
          : saved && saved.url ? `运行中（running）：${saved.url}` : ''

      return h('div', { style: cardStyle },
        FIELDS.map(field => h('div', { key: field.key, style: { display: 'grid', gap: 4 } },
          h('div', { style: headStyle },
            h('label', { htmlFor: `hcp-${field.key}`, style: titleStyle }, field.label),
            h('span', { style: flagStyle }, field.flag)),
          h('input', {
            id: `hcp-${field.key}`,
            value: draft[field.key] || '',
            onChange: change(field.key),
            placeholder: field.key === 'version' ? 'latest' : '',
            inputMode: field.inputMode,
            disabled: status === 'saving',
            style: fieldStyle,
          }),
          h('p', { style: hintStyle }, field.hint))),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('button', {
            type: 'button',
            onClick: save,
            disabled: status === 'saving',
            style: { ...buttonStyle, opacity: status === 'saving' ? 0.6 : 1 },
          }, status === 'saving' ? '保存中…（saving）' : '保存并重启（Save and restart）'),
          h('span', { role: 'status', style: hintStyle }, note)),
        h('div', { style: { display: 'grid', gap: 4 } },
          h('span', { style: titleStyle }, '实际命令（actual command）'),
          h('code', { style: commandStyle }, saved && saved.command ? saved.command : ''),
          h('p', { style: hintStyle }, '没配置的项不会出现在命令里（unset flags are omitted）。')))
    }

    // ---- 6. 槽位注册 ----
    return {
      inject: ['slots'],
      apply(ctx) {
        // 侧栏负责按钮，并按同一个 id 找到主区域的面板。
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'dsh-hindsight-control-plane',
          order: 30,
          label: 'Hindsight',
        }, Icon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'dsh-hindsight-control-plane',
        }, Panel))
        // 插件自己的页面上放配置卡片。
        ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
          name: 'plugins.bundle.config',
          key: 'dsh-hindsight-control-plane',
        }, ConfigCard))
      },
    }
  },
})
