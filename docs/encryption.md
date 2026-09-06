# 调研：聊天内容加密与密钥管理

## 现状与威胁模型

当前版本：HTTP 明文传输；主机内存里存明文消息；上传的文件以明文落在主机的 `data/files/`；口令 `token` 只做访问控制，不做加密。

要防的对象，从弱到强：

| 层级 | 谁能看到内容 | 现状 | 需要的手段 |
| --- | --- | --- | --- |
| A. 链路上的旁观者 | 同一 Wi‑Fi 下抓包的人 | 能看到一切 | 传输加密（TLS） |
| B. 主机磁盘 | 事后翻主机 `data/files/` 的人 | 文件明文 | 文件落盘前加密 |
| C. 主机进程本身 | 运行服务的那台电脑 | 能看到一切 | 端到端加密（E2EE），主机只存密文 |

雷电线直连时 A 基本不存在（物理点对点），但 B 和 C 仍然存在。所以只做 TLS 对本项目意义有限，**真正有价值的是 E2EE：主机只当密文中转和密文仓库。**

## 一个关键限制：浏览器 Web Crypto 只在安全上下文可用

浏览器里做加密的标准 API 是 `crypto.subtle`（Web Crypto），但它**只在安全上下文（HTTPS、`localhost`、`127.0.0.1`）下存在**。用 `http://192.168.1.23:3000` 或 `http://169.254.x.x:3000` 打开页面时，`crypto.subtle` 是 `undefined`。`.local` 域名也不算安全上下文。

因此方案二选一：

1. **服务端改为 HTTPS（自签名证书）**，然后在浏览器里用 Web Crypto 做 E2EE。推荐。
2. 保持 HTTP，前端内置一份纯 JavaScript 的加密库（如 `@noble/ciphers` 单文件，约 30 KB），不依赖 `crypto.subtle`。缺点：破坏了"零依赖"，且明文 HTTP 下页面脚本本身可被链路上的人篡改（雷电直连场景无此风险）。

也可以在 Chrome 里通过 `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 把某个 HTTP 源标记为安全，但每台机器都要手动配，不适合作为正式方案。

## 推荐方案：房间密钥 E2EE（预共享密钥）

适合本项目"一台主机、两三个可信参与者"的规模，实现约 150 行前端代码。

### 密钥来源

服务启动时生成两样东西：

- `token`：访问口令，和现在一样，走 `?token=` 或 `Authorization` 头，**服务端知道**。
- `roomKey`：32 字节随机密钥，Base64URL 编码后放在链接的 **fragment**（`#` 后面）：

```text
http://10.10.10.1:3000/?token=ab12cd34#k=Zt8g...（43 个字符）
```

URL fragment 不会随请求发给服务器，也不会出现在服务端访问日志里。浏览器读到后存进 `sessionStorage`，然后用 `history.replaceState` 把它从地址栏抹掉。服务端只是在启动时**打印**这段密钥，之后不持有它（生成后立即丢弃即可）。

替代做法：让用户输入一个口令短语，用 PBKDF2（≥ 600 000 次迭代，SHA‑256）派生密钥。更符合"记忆"习惯，但短口令会被离线暴力破解，对本项目不如随机密钥好。

### 加密算法

- 对称加密：**AES‑256‑GCM**，每条消息随机 12 字节 nonce，附加数据（AAD）放消息 id 和发送者名，防止密文被移花接木到别的发送者身上。
- 消息格式：服务端存的是 `{ id, time, sender, type: 'text', cipher: { iv, data } }`，`text` 字段不再明文出现。
- 文件：上传前在浏览器里分块（如 4 MB 一块）逐块 AES‑GCM 加密，每块独立 nonce（块序号写进 AAD 防重排），流式发给服务端；下载时逐块解密再拼成 `Blob` 触发保存。100 MB 的文件在浏览器内存里处理没有问题；分块的意义是避免一次性把整个文件读进内存。
- 文件名同样加密后再传，服务端只看到随机文件 id。图片预览改为"下载密文 → 解密 → `URL.createObjectURL`"，不能再用 `<img src="/api/files/...">` 直链。

### 密钥存放

- 浏览器端：用 `crypto.subtle.importKey(..., extractable = false)` 导入后存 `CryptoKey` 对象，页面刷新前放在内存；要跨刷新保留就放 IndexedDB（可直接存不可导出的 `CryptoKey`）。不要放 `localStorage` 明文，不要放 URL query。
- 服务端：不存。`data/files/` 只有密文。
- 换密钥：重启服务即换。如果想在不重启时踢掉某人，也只能重新生成密钥并让其余人重新打开新链接——这是预共享密钥方案的固有局限。

### 得到什么，没得到什么

得到：主机磁盘和主机进程都看不到内容；Wi‑Fi 抓包看不到内容；链接一次分发，用户无感知。

没得到：**前向保密**（一把密钥泄露，历史密文全部可解）和**成员撤销**。对"两台笔记本临时传文件"的场景这两点通常可以接受。

## 更强的方案（按需）

### 方案 B：每人一对密钥 + 群密钥分发

每个浏览器生成 X25519 密钥对，公钥通过服务端交换；发送方为群生成对称密钥，用 ECDH 派生的密钥分别加密给每个成员。成员变化时轮换群密钥即可实现撤销。需要用户在两台机器上**互相核对指纹**（safety number），否则主机可以做中间人。Web Crypto 已原生支持 X25519（Chrome 133+ / Safari 17+），无需第三方库。

### 方案 C：Signal 双棘轮 / MLS

提供前向保密和后向保密，是即时通讯领域的标准答案，但要维护会话状态、跳过消息的密钥链、多设备同步，工程量是方案 A 的十倍以上。除非项目目标变成"可信度接近 Signal 的聊天工具"，否则不建议。

## 关于 HTTPS 自签名证书

零依赖前提下，可以在首次启动时调用系统自带的 `openssl` 生成证书并缓存到 `data/tls/`：

```bash
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -keyout data/tls/key.pem -out data/tls/cert.pem -days 3650 \
  -subj "/CN=mk-inner-net" \
  -addext "subjectAltName=IP:192.168.1.23,IP:10.10.10.1,DNS:localhost"
```

然后用 `https.createServer({ key, cert }, handler)` 代替 `http.createServer`。另一台 Mac 第一次打开会看到"此连接不是私密连接"，点"仍要访问"一次即可（Safari 需要"显示详细信息 → 访问此网站"）。因为证书公钥固定，可以在终端打印证书 SHA‑256 指纹，让对方比对，从而在不信任网络上也能确认没被中间人。

注意 `EventSource` 和 `fetch` 在浏览器接受自签名证书后可正常工作；`macOS` 上如果想彻底消除警告，把 `cert.pem` 拖进"钥匙串访问"并设为"始终信任"。

## 实施建议（如果要做）

1. 先加 HTTPS 自签名（约 40 行服务端代码，含证书生成和指纹打印）。这一步单独就解决了 Wi‑Fi 抓包问题，并解锁 Web Crypto。
2. 再加房间密钥 E2EE（方案 A）：链接 fragment 携带密钥；文本消息和文件名加密；文件分块加密。服务端改动很小，主要是不再解析 `text`、图片预览路径改成前端解密。
3. 保留一个 `E2EE=off` 开关用于排障。
4. 在 README 里明确写：链接里 `#k=` 之后的部分是密钥，不要发到不可信的渠道；换密钥重启即可。

## 参考

- MDN《Crypto: subtle property》，安全上下文限制：<https://developer.mozilla.org/en-US/docs/Web/API/Crypto/subtle>
- MDN《SubtleCrypto》：<https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto>
- W3C Web Crypto 关于强制安全上下文的讨论：<https://github.com/w3c/webcrypto/issues/170>
