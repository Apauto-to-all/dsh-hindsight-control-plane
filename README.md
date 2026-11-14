# DSH Hindsight 控制台

把 Hindsight 的记忆控制台嵌进 DeepSeek Harness 的主面板：侧栏点一下就是整块控制台，不必另开浏览器窗口。控制台由宿主用 `npx` 拉起，随插件起停。

## 特性

- **一个按钮**。侧栏出现 Hindsight，点开占满主区域。
- **自己拉起自己**。宿主执行 `npx -y @vectorize-io/hindsight-control-plane@<版本>`，插件卸载时连整棵进程树一起收掉。
- **端口冲突自愈**。启动前先探端口：已在跑且能应答就复用；被旧实例占着就等它自己退出；确认占用者确实是本控制台的 `node` 进程才清掉。绝不并排起第二个——两个控制台抢同一端口会双双卡死。
- **切面板不丢页面**。切去会话、再切回来，还是你离开时那一页（同一个 DSH 页面会话内有效）。
- **设置就在插件页**。四项启动参数，改完即生效，写进 profile 的 patch 层。

## 安装

控制台本体从 npm 下载，需要能访问 npm 的 Node 环境。

**从仓库本地装（当前可用）**

```bash
# Linux / macOS
ln -s "$PWD/dsh-hindsight-control-plane" ~/.dsh/profiles/<profile>/node_modules/dsh-hindsight-control-plane
```

```bat
:: Windows（管理员或已开启开发者模式）
mklink /J %USERPROFILE%\.dsh\profiles\<profile>\node_modules\dsh-hindsight-control-plane <仓库路径>
```

然后重启 DSH。`<profile>` 是 profile 目录名，桌面版默认 `desktop`。

**发布到 npm 之后**

```bash
npx -y @deepseek-ai/dsh plugin --profile <profile> add <包名>
```

也可以在桌面版的「添加插件」里填包名。

## 设置

插件页（设置 → 插件 → Hindsight）上的卡片，四项都落在启动命令行上：

| 字段 | 落到命令行 | 留空时 |
|---|---|---|
| 记忆服务地址 | `--api-url` | 不传，用控制台自己的默认值 |
| 控制台端口 | `--port` | 不传，控制台默认 `9999` |
| 绑定地址 | `--hostname` | 不传，控制台默认 `0.0.0.0` |
| 包版本 | `@<版本>` | `latest` |

卡片底下会显示**实际命令**，没配置的项不会出现在里面。设置存进 profile 的 `cordis.patch.yml`，不是插件私有的 JSON 文件。

## 工作原理

```
DSH 宿主进程
 └── cmd.exe / npx → node → Next.js 控制台（监听 127.0.0.1:<port>）

浏览器的 DSH 页面
 └── 面板里的 iframe → http://127.0.0.1:<port>
```

两边只靠两条宿主路由通信：

- `GET /dsh-hindsight-control-plane/url` —— 面板问：地址是多少
- `GET|POST /dsh-hindsight-control-plane/settings` —— 设置卡片读、写

保存设置走 `configEditor.edit()`：它持久化到 profile 的 patch 层，并让 Loader 重新协调这一行，插件因此带着新 config 再执行一次、起新的控制台。所以保存那一步自己不去重启——否则会有两个进程抢同一个端口。

### iframe 为什么不在 React 树里

面板一卸载，React 会连 iframe 一起拆掉，控制台的页面就被重载回首页。把 iframe 挪到别处挂着也不行，实测搬动它同样会重载。

所以 iframe 常驻在 `document.body` 下的一个固定层里，面板只留一个空位：出现时按空位的矩形把层盖上去，离开时把层移出屏幕（不是 `display:none`，那样视口被压扁、滚动位置会归零）。整个过程那个浏览上下文一次都没被搬动或销毁。

## 已知限制

- **刷新或重启 DSH 后回首页**。控制台在 `127.0.0.1:<port>`，DSH 在别的端口，两者不同源，页面读不到 iframe 的地址，也就无从还原。
- **DSH 被强杀时控制台会留成孤儿**（Windows 不会替父进程收尸）。下次启动会复用或清掉它，不会卡住。
- **Windows 是主要验证路径**。macOS / Linux 走的是更简单的分支（直接 `spawn`、`SIGTERM`），未实测。

## 开发

```
index.js        入口：apply、两条路由、找 Loader 行
lib/settings.js 设置怎么规整、怎么校验、推出什么地址
lib/console.js  控制台进程怎么拼、什么时候不该起、怎么停
lib/process.js  端口在听吗、占着的是谁、怎么送走
lib/http.js     读请求体、回 JSON
client.js       浏览器半边（单文件，分 6 节）
```

没有构建步骤：宿主半边是原生 ESM，浏览器半边由 DSH 直接加载插件目录里的 `client.js`。改客户端不用重装，热加载；改宿主半边要插件重新加载一次。

客户端半边保持**单文件**是有意的——DSH 一个包只加载一个客户端文件，拆成多文件就得引打包器。文件内用分节代替分包，文件头有目录。

## 许可

MIT，见 [LICENSE](LICENSE)。

控制台本体是 [`@vectorize-io/hindsight-control-plane`](https://www.npmjs.com/package/@vectorize-io/hindsight-control-plane)，按它自己的许可（ISC）分发；本仓库只负责把它拉起来、嵌进面板。
