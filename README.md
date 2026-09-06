<div align="center">

# 🍡 团子 Dango

**开箱即用的局域网聊天室 —— 一台电脑起服务，同一网络的人扫一眼就进来聊天、传文件。**

*A tiny, zero-dependency LAN chat & file-sharing room. Run it on one machine, everyone on the same network just opens a browser.*

![Node](https://img.shields.io/badge/Node-%E2%89%A518-339933?logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Vanilla JS](https://img.shields.io/badge/vanilla-JS-f7df1e?logo=javascript&logoColor=black)
![Platform](https://img.shields.io/badge/LAN%20%7C%20Wi--Fi%20%7C%20Thunderbolt-supported-informational)

</div>

---

## ✨ 这是什么

**团子**是一个只用 Node.js 标准库写成的局域网聊天室，**没有任何第三方依赖**。你在一台电脑上 `npm start`，同一个局域网（家里 Wi-Fi、公司内网、手机热点，甚至两台 Mac 用雷电线直连）里的其他人用浏览器打开地址，填个 4 位口令就能进同一个房间，实时聊天、互传文件和图片。

聊天记录持久化保存、重启也在；**超过 30 天没有新消息的房间会自动销毁**（清空消息、删除文件）。特别适合临时协作、当面传文件、活动现场对暗号建群这种场景。

## 🎯 特性

- 🔢 **口令即房间**：创建房间时系统分配一个 4 位数字口令（可自改），别人填口令 + 昵称就能加入。房间之间数据完全隔离。
- 🪟 **多房间并存**：一个人可同时加入多个房间，顶栏"房间"抽屉切换，未读消息用红点角标提示，可随时退出某个房间。
- 💬 **消息与文件**：文本、文件传输（带实时上传进度）、图片直接在气泡里预览、点开看大图。
- 📋 **粘贴即发**：直接往输入框粘贴或拖拽图片，先出缩略图，回车发送。
- 👥 **在线成员**：实时显示谁在房间里。
- 🌗 **明暗自适应**：跟随系统浅色 / 深色主题，窄屏自动适配手机。
- 🛠️ **管理后台**：`/admin` 用管理员口令登录，实时查看房间列表、每个房间的成员昵称与 IP、人数、消息与文件数，可删除房间、踢人。**只看元信息，看不到聊天正文**。
- 🗓️ **30 天自动清理**：聊天记录落盘保存、重启不丢；超过 30 天无更新的房间自动销毁（可用 `RETENTION_DAYS` 调整）。
- ⚡ **雷电直连**：两台 Mac 用雷电线直连也能用，无需路由器，见 [docs/thunderbolt-bridge.md](docs/thunderbolt-bridge.md)。
- 📦 **零依赖**：整个项目不装任何 npm 包，`node server.js` 即可运行。

## 🚀 快速开始

需要 Node.js 18 或更高版本。

```bash
git clone https://github.com/imelonkid/dango.git
cd dango
npm start
```

终端会打印管理员口令和访问地址（方括号里是网卡，雷电直连会标出"雷电网桥"）：

```text
团子 Dango 已启动
管理员口令: 4f2a9c1b7d3e
本机访问: http://localhost:3000
管理页面: http://localhost:3000/admin
局域网访问 [en0]: http://192.168.1.23:3000
```

把局域网地址发给同网络的人。每个人打开后：

- **创建房间**：填个昵称（房间名选填），系统给一个 4 位口令，也可自己改，把口令告诉别人。
- **加入房间**：填**口令 + 昵称**即可。

想让别人一键预填口令，直接分享 `http://192.168.1.23:3000?code=4821` 这样的链接。

## ⚙️ 配置

```bash
ADMIN_TOKEN=my-secret PORT=8080 RETENTION_DAYS=30 npm start
```

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `ADMIN_TOKEN` | 管理后台口令，未指定时每次启动随机生成 | 随机 |
| `PORT` | 服务端口 | `3000` |
| `HOST` | 监听地址 | `0.0.0.0` |
| `MAX_FILE_SIZE` | 单文件最大字节数 | 100 MB |
| `RETENTION_DAYS` | 房间无更新多少天后自动销毁 | `30` |

房间口令是用户加入时自定义的 4 位数字，不需要在启动参数里配置。

## 🖥️ 使用场景

- 🏢 公司内网里临时拉个群对齐进度、传文件，不经过任何外部服务器。
- 🏠 家里两台电脑、手机平板之间互传照片文档。
- 💻 两台 Mac 用雷电线直连，完全离线也能高速传文件（见文档）。
- 🎤 活动 / 教室现场，报个 4 位口令让大家秒进同一个房间。

## 🔐 数据与安全边界

- 房间、消息、文件都持久化在主机的 `data/rooms/<房间ID>/`（消息存在 `room.json`），不会提交到 Git。
- 聊天记录重启后自动恢复；超过 30 天无新消息的房间会被自动销毁（消息清空、文件删除、房间移除）。**因此聊天内容会以明文存在主机磁盘上。**
- 管理后台只展示元信息（房间、成员昵称与 IP、人数、消息数、文件数），**看不到聊天正文和文件内容**；管理员口令请妥善保管。
- 房间口令是 4 位数字，只用于在可信局域网里区分房间，**不是强密码**（一万种组合可被暴力尝试）。
- 当前版本没有 HTTPS 和端到端加密，**只适合可信局域网，不要映射到公网**。加密方案的调研见 [docs/encryption.md](docs/encryption.md)。

## 🧪 验证

```bash
npm test
```

基于 Node 内置测试框架，覆盖建房 / 加入 / 口令校验、房间隔离、在线成员推送、管理端踢人删房、持久化重启恢复、过期房间销毁、局域网地址枚举等。

## 📁 项目结构

```text
server.js            零依赖的 HTTP + SSE 服务端（含落盘持久化与过期清理）
public/
  index.html         聊天界面
  app.js             前端逻辑（多房间、文件、粘贴发图）
  style.css          样式（明暗主题、响应式）
  admin.html/js      管理后台
test/server.test.js  端到端测试
docs/
  thunderbolt-bridge.md   两台 Mac 雷电直连方案
  encryption.md           聊天加密与密钥管理调研
```

## 🗺️ Roadmap

- [ ] 端到端加密（房间密钥 + AES-GCM，见 docs/encryption.md）
- [ ] PWA：手机 / 平板加到主屏
- [ ] Bonjour 自动发现同网络的服务

## 📄 License

MIT

---

<div align="center">
<sub>用原生 JavaScript 手写，无框架、无依赖 · Made with vanilla JS, no framework, no dependencies</sub>
</div>
