# 团子 Dango · macOS 桌面壳

用 Electron 把团子包成一个 Mac App：双击即用，无需终端 `npm start`。壳复用仓库根目录的 `server.js`，核心服务端仍保持零依赖，Electron 只作为这个子目录的开发依赖。

## 运行（开发）

```bash
cd desktop
npm install      # 下载 Electron，约 200MB，首次较慢
npm start
```

启动后出现「选择」界面：

- **自建服务器**：在这台 Mac 上起服务，你就是主机。窗口连本机 `https://localhost:3000`（localhost 是安全上下文，加密 / 通知 / PWA 全部可用，且不会有证书警告）。创建房间后把**邀请码**和**本机局域网地址**发给别人。终端会打印管理员口令、局域网地址与证书指纹。
- **加入服务器**：填主机地址（如 `192.168.1.23:3000` 或 `dango.local:3000`），窗口直接加载对方页面，再用邀请码进房间。壳会自动信任你主动加入的那台主机的自签证书。

## 打包成 .app / .dmg

```bash
cd desktop
npm run dist     # electron-builder --mac，产物在 desktop/dist/
```

图标用 `desktop/build/icon.icns`（由仓库图标生成）。注意：

- `electron-builder` 的 `extraResources` 会把 `../server.js` 与 `../public` 打进 App；如首次打包路径有出入，按 `package.json` 里的 `build` 段微调。
- 要免除 Gatekeeper 警告、分发给别人，需要 Apple 开发者账号做**签名 + 公证**；自用可右键「打开」绕过一次。

## 说明与边界

- 壳里 `server.js` 跑在 Electron 主进程内，**开 App = 起服务 + 开界面**。但架构仍是客户端—服务端：**运行时的服务器 = 大家实际连过去的那台主机**，不是"谁开了 App"。
- **主机下线**：该主机上的房间会暂时不可达，成员端显示"连接中断，正在重试…"；主机重开后自动恢复（聊天记录持久化在主机 `data/`，遵循 30 天保留）。
- 想要房间长期在线，把「自建服务器」跑在一台**常开的机器**上，其他人用「加入服务器」连它。
- 证书信任目前按 origin 放行（本机 + 你主动加入的主机）；后续可加**指纹校验/固定**来防中间人。
- "主机下线自动选新主机"的去中心方案，见根目录后续的设计文档。
