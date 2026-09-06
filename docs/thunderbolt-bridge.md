# 调研：两台 Mac 用雷电线直连能否加入聊天室

结论：**可以，而且不需要改代码。** 两台 Mac 用雷电线直连后，macOS 会自动建立一个名为"雷电网桥（Thunderbolt Bridge）"的网络接口，本质上是 IP over Thunderbolt，等价于一根网线直连。聊天室服务监听 `0.0.0.0`，另一台 Mac 用雷电网桥上的 IP 访问即可。

## 原理

- macOS 把雷电口之间的连接虚拟成一块以太网卡，接口名通常是 `bridge0`（系统设置里叫"雷电网桥"）。本机已确认存在：`networksetup -listallhardwareports` 输出 `Hardware Port: Thunderbolt Bridge / Device: bridge0`。
- 默认 IPv4 配置为 DHCP。直连时没有 DHCP 服务器，两台机器各自分配一个 `169.254.x.x` 的链路本地地址，同网段可互通。
- 服务端启动时会枚举所有非回环 IPv4 地址并打印，`bridge0` 上的地址会以"局域网访问 [雷电网桥 Thunderbolt Bridge]"的形式列出来（本次改动新增的标注），把这条地址发给另一台机器即可。
- 不依赖 Wi‑Fi 或路由器；两台机器可以完全离线。

## 操作步骤

1. 用**支持雷电（Thunderbolt 3 / 4 或 USB4）的线**连接两台 Mac 的雷电口。注意：Apple 随机附带的 USB‑C 充电线只有 USB 2.0 数据能力，不能建立雷电网桥；线上一般印有闪电标志。
2. 在两台 Mac 上打开"系统设置 → 网络"，确认列表里有"雷电网桥"，状态显示"已连接"或"自分配的 IP"。如果没有，点左下角"…" → "添加服务" → 选"雷电网桥"。
3. 在主机上 `npm start`，终端里找带 `[雷电网桥 Thunderbolt Bridge]` 的那一行地址（形如 `http://169.254.x.x:3000?token=xxxx`）。
4. 另一台 Mac 用浏览器打开该地址即可加入。

## 可选：固定 IP

`169.254.x.x` 每次重连可能变化，需要重新看终端。如果嫌麻烦，可以在两台机器的"雷电网桥"里把 IPv4 改成"手动"：

| 机器 | IP 地址 | 子网掩码 |
| --- | --- | --- |
| 主机 | 10.10.10.1 | 255.255.255.0 |
| 另一台 | 10.10.10.2 | 255.255.255.0 |

之后地址固定为 `http://10.10.10.1:3000`。也可以用 Bonjour 名字访问，例如 `http://<主机名>.local:3000`，mDNS 会走雷电网桥解析，不需要记 IP。

## 让雷电直连的 Mac 借主机上网、进入主机所在局域网

直连本身不需要局域网。但如果另一台 Mac 没有 Wi‑Fi 或网线，可以让主机用"互联网共享"做 NAT 路由：

1. 主机打开"系统设置 → 通用 → 共享 → 互联网共享"，点 ⓘ。
2. "共享以下来源的连接"选 Wi‑Fi（或以太网），"用以下端口共享给电脑"勾选"雷电网桥"，打开开关。
3. 另一台 Mac 的雷电网桥保持 DHCP，会拿到 `192.168.2.x`，网关是主机的 `192.168.2.1`。
4. 它可以上网，也能主动访问主机 Wi‑Fi 网段里的设备。聊天室用 `http://192.168.2.1:3000?token=…`，服务端会把这条地址打印出来。

限制：这是 NAT，局域网里其他设备不能主动连到那台 Mac。要让它拿到路由器分配的 IP、成为真正的局域网成员，需要在主机上做二层桥接（`ifconfig bridge`），而 macOS 的 Wi‑Fi 网卡不支持桥接，只有主机用网线时才可行，一般没必要。

## 性能

雷电点对点模式实测带宽在 10–20 Gbps 量级，实际文件拷贝约 4–8 Gbps（受磁盘和协议栈限制），远高于 Wi‑Fi。对本项目而言，瓶颈会落在浏览器上传（单请求、不分片）和主机磁盘写入上，而不是链路。

## 注意事项

- 两台机器同时连着 Wi‑Fi 和雷电时，`169.254` 网段的流量会走雷电网桥，Wi‑Fi 不受影响；用手动 IP 时也一样，因为 `10.10.10.0/24` 不会和常见家用网段冲突。
- macOS 的"防火墙"如果开启且拦截了 Node，需要放行（第一次运行时系统会弹窗询问）。
- 主机休眠会断开网桥；合盖前请保持主机唤醒或接电源。
- Windows 端不适用这条路径：Windows 需要额外的雷电网络驱动，而且和 Mac 之间的互通不保证。

## 参考

- Apple 支持文档《使用 IP over Thunderbolt 连接 Mac 电脑》：<https://support.apple.com/guide/mac-help/mchld53dd2f5/mac>
- Macworld《How to connect two Macs without a network》（含 169.254 自分配地址说明和实测速度）：<https://www.macworld.com/article/698765/how-to-connect-two-macs-without-a-network.html>
- Thunderbolt Networking 白皮书：<https://www.thunderbolttechnology.net/sites/default/files/Thunderbolt%E2%84%A2%20Networking%20Bridging%20and%20Routing%20Instructional%20White%20Paper.pdf>
