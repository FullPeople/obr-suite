# 新版 Full Suite · 3D 骰子接入 211

用户授权“改吧！然后部署”，随后收窄为“只部署到新插件”“旧插件不需要改”。本轮只发布 `/suite-dev/`；不改 `/suite/`、`/card/`、`/dice-lab-dev/`、中继、三龙牌、Nginx 和玩家数据库。原生 Desktop Dice 工程、独立 Web Lab 均未修改。

## 基线和恢复位置

维护树 `F:/CodexWork/2026-09-27/feedback/suite`，独立分支 `codex/workbench-3d-dice`，从干净的 `d8932dd5b4adbcf105fd2e50a0a1679c632d9789` 续接。3D 源码和已锁定素材来自 `D:/Desktop/DesktopDiceWebLab` 当前工作树，固定快照放在 `extensions/workbench-dice3d/`，不修改来源目录。

开发期间线上由另一个项目从 209 升为 210，因此正式候选改为 **211**。210 公布的 Suite 源码标记 `5f1f30fa1700cdad25c52aeea92dbe2eb1fdee17`；去除 CRLF 差异后，本轮所依赖的 `src/` 与原维护基线一致。210 的新版 Web、阅读器与公告在服务器候选中逐文件保留，不使用本地未发布 Web 重建、不回滚成 209。

`tools/package-dice3d211.mjs` 打包新 Suite HTML/编译 JS、3D 独立覆盖层和工作台骰盘。`tools/deploy-dice3d211.py` 从实时 210 复制候选，覆盖允许的增量，校验散列、版本和未触及站点后原子替换；保留 `suite-dev-before-dice3d211`。源码包为本轮 Git 提交，Web 对应源码包仍是线上 210。

## 产品与权威

- 新版投骰窗口与快速投骰接入真实 Jolt/WASM，一条权威轨迹/结果/接触声，Three.js 只回放；不使用 2D 图片动画，也不另外掷一个用于显示的结果。
- 七种实体模型；逻辑 d100 展开为十位和个位两枚十面骰，00+0=100。每次提交有自己的 roll ID、来源、颜色、材质和公式时间线。
- 8 种材质：卡通涂鸦、瓷质、拉丝金属、猫眼石、半透明树脂、漫画印刷、流动水墨、霓虹符文。取投掷者的枭熊颜色；切换只影响后续提交。保留原 2D 皮肤资料，界面明确它们不用于 3D 表面。
- 加减乘、优势/劣势、精灵之准、repeat、max/min、一次重投、同值、爆炸骰共用物理公式；独立分支同一物理波次投出，只有规则要求的追加/重投才陆续出现。原本刻字对应的保底/封顶真实起跳翻面，未贴新数字；超出骰面范围的规则值保留原刻字并作为规则结算，明确记录。
- 已有先攻、群体豁免和 DM 指定结果仍是原权威结果；通过实体精确对称旋转对齐整个轨迹的刻字，不重新决定结果、不更换 glyph、不改变占据体积/碰撞。此兼容模式与正常物理抽取分开。
- 私密范围：全部、自己、自己+主持人、非主持人。未授权者只收到脱敏问号轨迹，无公式、种子、结果或历史；授权者正常看骰子/结算。秘密细节压缩后经 P256/HKDF/AES-GCM 加密，公开校验最初承诺。主动公开只更新同一历史并高亮，不再次产生 3D 骰子或飞值。
- 全屏 3D 覆盖层禁止鼠标拦截，统一历史沿用新版活动面板；不建立第二个 Lab 历史。私密历史只保留授权端内存，重新打开本端历史从后台授权内存补齐，不落地成跨页可共享的明文私密缓存。

## 边界不是完成声明

一次最多 100 枚实际骰子（d100 两枚），最多 7 个因果波次；repeat 最多 5 次，准备队列 10 条。过载、缺模型、未知材质、版本/散列不一致明示错误，绝不改用 2D 或默认皮肤。最近 20 条/64 MB 轨迹可回放，超限明确不能回放，不能以重掷冒充。

保留之前 roll 的最终实体作为后续碰撞体。预测和各条结算可重叠，但后续碰撞播放等先前骰子到达对应最终位姿；这不是已经广播轨迹之间的双向实时重算。当前没有声称任意规模、任意带宽无延迟并发。浏览器声音仍受自动播放/用户交互许可限制。

真实枭熊多人房间、实际声画质量、实体手机和用户视觉验收仍待真人测试。SDK 模拟宿主和三个本机页面不等于真人跨端网络验收。

## 本轮验证与命令

- Suite 和 3D 严格 TypeScript 检查通过；正式构建通过。新-only Vite 适配在 TS 转译前执行且匹配失败立即报错，稳定版适配关闭；共享旧骰子源文件未编辑。
- 33 项定向检查：Jolt 1.1.0 文件锁散列、七骰精确对称群、首波实体数量、d100 的 00/0、暗骰信息脱敏、压缩/加密大记录、未授权无明文、原插件适配关闭、每行重复总数/加值等。
- 三客户端真实 Jolt/WebGL：普通、优势、重复、d100、真实保底翻面、低点重投、乘法；三个页面轨迹/结果一致，GM 私密权限、公开不重演、三人不同材质独立提交通过，浏览器错误 0。证据 `.cache/dice3d-evidence/report.json`。
- 真实 Owlbear SDK + 模拟宿主：百分骰 +5、129 的固定既有结果、来源身份/颜色、私密范围、分组公开、仅 LOCAL 结果和穿透地图按钮通过。未连接真人枭熊房间。证据 `.cache/dice3d-evidence/sdk.json`。

```powershell
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit -p extensions/workbench-dice3d/tsconfig.json
node tools/workbench-dice3d-selftest.mjs
$env:SUITE_BASE='suite-dev'
node node_modules/vite/bin/vite.js build --outDir .cache/suite3d-root
node node_modules/vite/bin/vite.js build --config extensions/workbench-dice3d/vite.config.ts
$env:WORKBENCH_DICE_OUT='.cache/dice3d-panel'
node tools/build-workbench-dice.mjs
```

不要调用 `build-workbench-dev.mjs` 重建另一项目的未发布 Web；不要将本次 3D 适配部署到稳定插件。正式上线回执、源码提交和公网校验以 `RELEASE-DICE3D-211-RESULT.md` 为准。
