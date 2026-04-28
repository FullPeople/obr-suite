# 枭熊插件 · Owl Suite

> 一站式 [Owlbear Rodeo](https://owlbear.rodeo) 中文 TRPG 套件 — 单一安装链接，集成 9 个功能模块。
>
> One-install Owlbear Rodeo TRPG suite for D&D 5e — 9 modules behind a single manifest.

---

## 安装 / Install

OBR 房间 → 右上角 ⊕ "Add Extension" → 粘贴：

```
https://obr.dnd.center/suite/manifest.json
```

仅此一条链接，DM 装一次，全房间共享。

---

## 模块 / Modules

| 模块 | 中文说明 | English |
|---|---|---|
| 🎲 **骰子** | 完整骰子系统（表达式 / 多目标 / 历史 / 回放 / 音效 / 5etools 联动） | Full dice system (expressions / multi-target / history / replay / SFX / 5etools integration) |
| ⚔ **先攻追踪** | 顶部横向先攻条，集成 Dice+ 投骰，回合切换自动同步视野 | Top initiative strip, Dice+ integration, auto-camera-pan on turn change |
| 🐉 **怪物图鉴** | 5etools 全数据怪物库，搜索 + 一键召唤 + 自动设置 HP/AC/先攻 | 5etools-powered bestiary, search + one-click spawn |
| 📇 **角色卡** | xlsx（悲灵 v1.0.12 模板）→ 网页角色卡，支持 Owner 玩家自助投骰 | xlsx → web character card, owner-aware roll |
| 🔍 **全局搜索** ⚠ | 集群内嵌输入框 + 5etools 联想（**默认关闭**，仍在打磨） | Inline search input + 5etools dropdown (**default OFF**, still polishing) |
| ⏸ **时停模式** | DM 一键禁用玩家所有画布操作，电影黑边淡入 | One-click freeze on all player canvas input, cinematic black bars |
| 🎯 **同步视野** | 全员摄像头瞬移到指定位置 / 选中角色 | Pan everyone's camera to a point / token |
| 🚪 **传送门** ⚠ | 拖拽画圆 → 创建场景内传送门，同标签互联（**默认关闭，开发中**） | Drag-circle scene-portal with same-tag linking (**default OFF, in dev**) |
| ⚙ **设置 / 关于** | 模块开关、数据版本（2014/2024/all）、中英切换、音效、支持作者 | Module enable/disable, data version, locale switch, SFX toggle, donation links |

⚠ = 默认关闭，需手动启用 / default OFF, opt-in via Settings.

---

## 亮点 / Highlights

### 🎲 骰子系统 / Dice system

- **表达式** ：`adv(1d20)` / `dis(1d20)` / `max(1d20, 10)` / `min(1d20, 15)` / `reset(1d20, 12)` / `burst(2d6)` / `same(2d20)` / `repeat(3, 1d20+5)`，**可任意嵌套**
- **多目标投掷**：选中多个 token → 每个 token 各自独立投骰，集体合并为一条历史
- **暗骰**：DM 限定，玩家完全不接收
- **5etools 联动**：搜索 / 怪物 / 角色卡里所有 `{@dice}`、`{@damage}`、`{@hit}` 标签都可点击直接投骰
- **角色卡联动**：六维属性、技能、武器伤害都是可点击的快速投骰
- **音效**：Web Audio API 合成（无需下载素材） — 抛物线 / 缩放 / 飞行 / 旋转 / 爆炸 / 同值钟铃
- **历史回放**：点击左下角浮窗的玩家行 → 滑入详情；点条目 → 在所有相关 token 头顶显示气泡（带玩家颜色）
- **完整动画管线**：bounce → settle → max/min/reset 旋转变值 → burst 链式飞入 → same 高亮 → 数字冲刺 → final pop → 飞向左下角历史框

### Expression syntax (English)

- Wrapped operators: `adv` / `dis` (advantage), `max` / `min` (clamp), `reset` (trigger reroll), `burst` (explode-on-max), `same` (highlight), `repeat` (N independent rows)
- Nesting: `repeat(3, adv(max(1d20, 10) + 5))`
- Smart parser: prefix/suffix terms get absorbed — `adv(1d20)+6` ≡ `adv(1d20+6)`
- Chinese punctuation auto-recognized: `（）`, `，`

### ⚔ 先攻追踪 / Initiative

- 完整 D&D 5e 战斗流程；右键 token → 加入；DM 战斗开始按钮初始化所有数值
- Player owns a token → can roll initiative themselves, edit modifier, click "End Turn"
- Optional Dice+ integration; falls back to local roll
- 切换回合自动 `OBR.viewport.animateTo` 聚焦当前角色 + "登"音效

### 🐉 怪物图鉴 + 📇 角色卡 / Bestiary + Character Cards

- All 5etools `{@hit X}`, `{@damage NdM}`, `{@chance X}`, `{@scaledice base|levels|scale}` etc. become clickable
- Monster panel: **left-click = dark roll**, **right-click = open roll** (DM workflow)
- Character card abilities: **letter = save (with proficiency)**, **modifier = check**
- Character card weapons: attack bonus + damage dice both clickable
- 角色卡底部三个紧密小盒：特性 / 专长 / 法术 — 点击 chip → 自动填入集群搜索框

---

## 设计与状态 / Architecture & Status

```
obr-suite/
├── public/manifest.json     # action.popover = dice panel; background.html
├── src/
│   ├── background.ts         # always-alive iframe; opens cluster + manages module lifecycle
│   ├── cluster.ts            # bottom-right popover with module buttons + inline search
│   ├── settings.ts           # tabbed about + per-module enable + bilingual
│   ├── state.ts              # scene-metadata-backed shared state + per-client localStorage
│   └── modules/
│       ├── dice/             # panel/effect/history/replay/sfx — full dice system
│       ├── initiative/       # Preact tree
│       ├── bestiary/         # spawn + monster info popover
│       ├── characterCards/   # xlsx upload + bind + info popover
│       ├── search/           # inline-input cluster + dropdown popover
│       ├── portals/          # scene-portal tool (in dev)
│       ├── timeStop.ts
│       └── focus.ts
└── ... html entry points + assets ...
```

- TypeScript + Vite + Preact (initiative panel)
- @owlbear-rodeo/sdk v3.x
- Scene metadata (`com.obr-suite/state`) for cross-client sync — DM writes, players read
- localStorage for per-client preferences (cluster expanded, auto-popup toggles, SFX on/off, dice history)

State of play (2026-04-28):
- ✅ All 9 modules live + integrated
- ✅ Dice system: full expressions / animation pipeline / replay / 5etools integration
- ✅ History popover with collective grouping + click-to-replay
- ⚠ Portals: drag-create works in single scene; cross-scene + permissions still TODO
- ⚠ Search: layout & keyboard nav rough; default OFF until polished
- 📋 OBR Extensions Store submission: pending (some modules ship 5etools-derivative content; either submit individual standalones or a "lite" suite)

---

## 截图 / Screenshots

(coming soon)

---

## 许可证 / License

[PolyForm Noncommercial License 1.0.0](./LICENSE)

- ✅ 自由查看 / 修改 / 二次创作 / 非商用分发 — Free to view / modify / derive / non-commercial distribute
- ✅ 必须保留 — Required Notice: `Copyright (c) 2026 FullPeople`
- ❌ **禁止任何商业用途 — No commercial use**

---

## 💖 支持作者 / Support the author

如果这个套件对你的桌游有帮助，可以请作者喝杯咖啡 ☕：

[![Ko-fi](https://img.shields.io/badge/Ko--fi-FullPeople-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/fullpeople)
[![爱发电](https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-FullPeople-FF6B9D?style=for-the-badge&logo=heart&logoColor=white)](https://ifdian.net/a/fullpeople)

> 反馈 / Bug 报告 / 功能建议 — [1763086701@qq.com](mailto:1763086701@qq.com)

> Plugin author: [@FullPeople](https://github.com/FullPeople) · runs on a self-hosted Alibaba Cloud node ([obr.dnd.center](https://obr.dnd.center))
