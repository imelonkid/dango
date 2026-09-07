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

- 🔐 **端到端加密**：消息、文件、文件名都用 AES-GCM 在浏览器加解密，密钥只存在参与者本地，**服务端只经手密文、永远看不到内容**。
- 🔒 **自动 HTTPS**：首次启动用系统 openssl 自签证书（覆盖本机所有局域网 IP），让每台设备进入安全上下文——解锁浏览器加密与系统通知，无需域名。
- 🎟️ **邀请码进房**：创建房间后生成一串邀请码（含房间标识与加密密钥），好友用二维码或邀请码即可加入，无需手输口令。
- 🪟 **多房间并存**：一个人可同时加入多个房间，顶栏"房间"抽屉切换，未读消息用红点角标提示，可随时退出某个房间。
- 💬 **消息与文件**：文本、文件传输（带实时上传进度）、图片直接在气泡里预览、点开看大图。
- 📋 **粘贴即发**：直接往输入框粘贴或拖拽图片，先出缩略图，回车发送。
- 📲 **扫码 / 邀请码邀请**：创建房间后出二维码和一键复制的邀请码，加密密钥就藏在邀请码里，只在参与者浏览器之间流转、不会发给服务器。
- 👥 **在线成员**：实时显示谁在房间里。
- 🌗 **明暗自适应**：跟随系统浅色 / 深色主题，窄屏自动适配手机。
- 🛠️ **管理后台**：`/admin` 用管理员口令登录，实时查看房间列表、每个房间的成员昵称与 IP、人数、消息与文件数，可删除房间、踢人。**只看元信息，看不到聊天正文**。
- 🗓️ **30 天自动清理**：聊天记录落盘保存、重启不丢；超过 30 天无更新的房间自动销毁（可用 `RETENTION_DAYS` 调整）。
- ⚡ **雷电直连**：两台 Mac 用雷电线直连也能用，无需路由器，见 [docs/thunderbolt-bridge.md](docs/thunderbolt-bridge.md)。
- 📦 **近零依赖**：服务端不装任何 npm 包；前端仅内置两个随源码提交的单文件库（[sjcl](https://github.com/bitwiseshiftleft/sjcl) 负责 AES-GCM、qrcode-generator 负责二维码），无需构建。

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
本机访问: https://localhost:3000
管理页面: https://localhost:3000/admin
局域网访问 [en0]: https://192.168.1.23:3000
证书指纹(SHA-256): E9:75:D7:7C:…
```

服务走 HTTPS（自签名证书）。每台设备第一次打开会提示"此连接不是私密连接"，点一次"仍要访问"即可（Safari 是"显示详细信息 → 访问此网站"）——这是自签证书的正常现象，功能完全正常。用 `NO_HTTPS=1` 可强制明文 HTTP（不推荐，浏览器将无法使用系统通知）。

把局域网地址发给同网络的人。每个人打开后：

- **创建房间**：填个昵称（房间名选填）。创建后弹出二维码和邀请码，把它发给要加入的人。
- **加入房间**：扫码，或把邀请码粘进"加入房间"，再填昵称即可。

邀请码形如 `4821.Zt8g…`：前面是房间标识，`.` 后面是端到端加密密钥，浏览器不会把它发给服务器——请通过可信渠道分享。

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
| `NO_HTTPS` | 设为 `1` 则强制明文 HTTP（默认走自签名 HTTPS） | 未设置 |

房间口令是用户加入时自定义的 4 位数字，不需要在启动参数里配置。

## 🖥️ 使用场景

- 🏢 公司内网里临时拉个群对齐进度、传文件，不经过任何外部服务器。
- 🏠 家里两台电脑、手机平板之间互传照片文档。
- 💻 两台 Mac 用雷电线直连，完全离线也能高速传文件（见文档）。
- 🎤 活动 / 教室现场，报个 4 位口令让大家秒进同一个房间。

## 🔐 数据与安全边界

- 房间、消息、文件都持久化在主机的 `data/rooms/<房间ID>/`（消息存在 `room.json`），不会提交到 Git。
- 聊天记录重启后自动恢复；超过 30 天无新消息的房间会被自动销毁（消息清空、文件删除、房间移除）。落盘的是**密文**——没有密钥的人（包括跑服务的主机）都看不到内容。
- 端到端加密只保护内容，不保护元信息：服务端和管理后台仍能看到房间、成员昵称与 IP、消息条数、时间。管理员口令请妥善保管。
- 加密密钥就在邀请码里，通过二维码 / 邀请码带外分发，发给谁就等于把房间内容给谁看——请只发给可信的人。
- 房间口令是 4 位数字，只用于在可信局域网里区分房间，**不是强密码**（一万种组合可被暴力尝试）。
- 已启用自签名 HTTPS 与端到端加密，但证书非公认 CA 签发（首次需手动信任），**仍只适合可信局域网，不要映射到公网**。可核对启动时打印的证书指纹以防中间人。加密方案的调研见 [docs/encryption.md](docs/encryption.md)。

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
  crypto.js          端到端加密封装（AES-GCM）
  vendor/            内置的 sjcl 与 qrcode-generator（随源码提交）
test/server.test.js  端到端测试
docs/
  thunderbolt-bridge.md   两台 Mac 雷电直连方案
  encryption.md           聊天加密与密钥管理调研
```

## 🗺️ Roadmap

- [ ] PWA：手机 / 平板加到主屏
- [ ] Bonjour 自动发现同网络的服务

## 📄 License

MIT

---

<div align="center">
<sub>用原生 JavaScript 手写，无框架、无依赖 · Made with vanilla JS, no framework, no dependencies</sub>
</div>
