# MARINA BAY GP · 新加坡夜赛

这是一个无需安装客户端、直接在浏览器运行的 Three.js 单机 F1 赛车游戏。默认主赛道使用 `MarinaBay_StreetCircuit_Blender.zip` 导出的滨海湾夜景 GLB 模型，并保留二维路点作为稳定的 AI 与护墙碰撞基准。

## 在线访问

静态网站已发布到 Cloudflare Pages：

- `https://racecar-ex4.pages.dev/`

打开网站即可游玩，不需要 `localhost`、Blender 或 Node.js。第一次进入滨海湾赛道时会加载约 16 MB 的 GLB 资源；如果资源加载失败，游戏会自动回退到内置程序化赛道。

## 操作

- `W` / `↑`：油门
- `S` / `↓`：刹车；静止长按可倒车
- `A` / `D` 或方向键：转向
- `Shift`：ERS 超车
- `E`：DRS
- `Q`：进站
- `C`：切换视角
- `P`：暂停
- `R`：回到赛道

## 本地运行

```bash
node serve.mjs
```

然后打开 <http://127.0.0.1:8000/>。本地服务器仍支持原有局域网/WebRTC 手动信令流程；公开 GitHub Pages 版本本次只保证单机玩法，不依赖 WebSocket 后端。

## 资产与碰撞

- `assets/models/marina_bay_street_circuit.glb`：由提供的 Blender 工程导出的浏览器模型。
- 模型加载失败时使用原有程序化赛道，保证页面仍可玩。
- 车辆位移现在按最大步长拆分，并在每个子步重新检测车身角点和维修区墙体，减少高速穿墙、斜向穿模和大帧间隔造成的越界。
