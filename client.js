window.__ModuleLoader__.load({
  id: 'dsh-hindsight-control-plane',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const URL_PATH = '/dsh-hindsight-control-plane/url'

    const rowStyle = { height: '100%', flex: '1 1 auto', minHeight: 0, display: 'flex' }
    const frameStyle = { flex: '1 1 auto', minHeight: 0, width: '100%', border: 0, display: 'block' }
    const spinnerStyle = {
      width: 32,
      height: 32,
      borderRadius: '50%',
      border: '3px solid currentColor',
      borderTopColor: 'transparent',
      opacity: 0.6,
      animation: 'hcp-spin 0.9s linear infinite',
    }

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
        'aria-label': 'Starting Hindsight Control Plane',
        style: { flex: '1 1 auto', display: 'grid', placeItems: 'center' },
      },
        h('style', null, '@keyframes hcp-spin{to{transform:rotate(360deg)}}'),
        h('div', { style: spinnerStyle }))
    }

    function Panel() {
      // null = still asking the Host; '' = the Host answered without an address.
      const [url, setUrl] = React.useState(null)
      const [ready, setReady] = React.useState(false)

      React.useEffect(() => {
        let live = true
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
      }, [])

      // A first npx run downloads the console, so the iframe stays unmounted until
      // the address answers; an opaque no-cors probe rejects while nothing listens.
      React.useEffect(() => {
        if (!url || ready) return
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

      if (url === '') {
        return h('div', { style: { padding: 16 } }, 'The control plane address is unavailable.')
      }
      return h('div', { style: rowStyle }, ready && url
        ? h('iframe', { src: url, title: 'Hindsight Control Plane', style: frameStyle })
        : h(Waiting))
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        // The sidebar owns the button and resolves the panel by this same id.
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
      },
    }
  },
})