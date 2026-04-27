# 枭熊插件 / Owl Suite

> Owlbear Rodeo TRPG 全能套装 — 单一安装链接，集成 6 个独立功能模块的统一插件

**Status: v0.1 (under active migration). Settings panel + cluster + about page are complete. Time-Stop and Sync-Viewport modules fully migrated. The 4 larger plugins (Initiative, Bestiary, Character Cards, Global Search) still ship as separate plugins for now and are controlled from the suite's cluster via broadcast — full code migration is in progress.**

## 安装

OBR 房间 → 右上角 ⊕ → 粘贴下面的链接：

```
https://obr.dnd.center/suite/manifest.json
```

## 包含的功能

| 模块 | 状态 |
|---|---|
| 时停模式 | ✅ 已合并 |
| 同步视口 | ✅ 已合并 |
| 怪物图鉴 | 🚧 仍由独立插件提供（套装控制其状态） |
| 角色卡 | 🚧 同上 |
| 先攻追踪 | 🚧 同上 |
| 全局搜索 | 🚧 同上 |
| 设置 / 关于 | ✅ 已合并 |

## 主要交互

- **右下角矩形浮动按钮** — 点击展开横向功能条（向左展开），再次点击折叠
- **设置** — DM 控制启用哪些模块、数据版本（2014 / 2024 / 全部）、语言（中 / EN）
- **关于** — 选项卡式介绍每个模块，CN/EN 双语切换，含爱发电 + Ko-fi 支持入口

## 技术栈

- TypeScript + Vite
- @owlbear-rodeo/sdk v3.x
- 中央 scene metadata 管理跨客户端状态；localStorage 管理每客户端偏好

## 许可证

[PolyForm Noncommercial License 1.0.0](./LICENSE) — 详见 LICENSE 文件。

- ✅ 可：自由查看 / 修改 / 二次创作 / 非商用分发
- ✅ 必须保留 `Required Notice: Copyright (c) 2026 FullPeople`
- ❌ 禁止任何商业用途

---

## 💖 支持作者

[![Ko-fi](https://img.shields.io/badge/Ko--fi-FullPeople-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/fullpeople)
[![爱发电](https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-FullPeople-FF6B9D?style=for-the-badge&logo=heart&logoColor=white)](https://ifdian.net/a/fullpeople)

> 反馈 / Feedback: [1763086701@qq.com](mailto:1763086701@qq.com)
