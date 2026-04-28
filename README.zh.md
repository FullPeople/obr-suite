# Full Suite

[English](./README.en.md) · 中文

<p align="center">
  <img src="docs/screenshots/hero.png" alt="Full Suite" width="900" />
</p>

[Owlbear Rodeo](https://owlbear.rodeo) 第三方扩展。在一个 manifest 下集成 8 个模块。

## 安装

在 OBR 房间内点击右上角 ⊕ "Add Extension"，粘贴：

```
https://obr.dnd.center/suite/manifest.json
```

## 模块清单

| 图标 | 模块 | 说明 |
|---|---|---|
| <img src="docs/icons/dice.svg" width="20" align="center" /> | 骰子 | 表达式投骰、多目标、历史记录、回放、音效、与 5etools 标签联动。 |
| <img src="docs/icons/swords.svg" width="20" align="center" /> | 先攻追踪 | 顶部横向先攻条。包含战斗开始、回合切换镜头、Owner 玩家可自助投骰与结束回合。 |
| <img src="docs/icons/dragon.svg" width="20" align="center" /> | 怪物图鉴 | 5etools 怪物搜索 + 一键召唤；Token 右键支持绑定 / 更换 / 移除怪物图鉴。 |
| <img src="docs/icons/idcard.svg" width="20" align="center" /> | 角色卡 | 解析 xlsx 角色卡（悲灵 v1.0.12 模板）为网页视图；选中绑定 token 时自动浮出信息卡。 |
| <img src="docs/icons/search.svg" width="20" align="center" /> | 全局搜索 | 顶部右侧浮窗搜索框，覆盖 5etools 全分类，悬停预览、点击钉住。 |
| <img src="docs/icons/clock-pause.svg" width="20" align="center" /> | 时停 | DM 一键禁用玩家画布操作，添加电影黑边。 |
| <img src="docs/icons/crosshair.svg" width="20" align="center" /> | 同步视口 | 把所有玩家镜头移动到指定坐标或所选 token。 |
| <img src="docs/icons/portal.svg" width="20" align="center" /> | 传送门 | 在场景中创建圆形传送区域，同标签互联，可绕过 Dynamic Fog 的光源拦截。 |

## 截图

<table>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/dice_roll.png" alt="骰子动画" width="100%" />
      <br/><sub>骰子表达式 + 飞行动画</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/initiative.png" alt="先攻条" width="100%" />
      <br/><sub>顶部先攻条 + 回合切换</sub>
    </td>
  </tr>
  <tr>
    <td align="center" width="50%">
      <img src="docs/screenshots/card.png" alt="角色卡" width="100%" />
      <br/><sub>角色卡浮窗 · 可点击投骰</sub>
    </td>
    <td align="center" width="50%">
      <img src="docs/screenshots/portal.png" alt="传送门" width="100%" />
      <br/><sub>传送门 + 目的地选择</sub>
    </td>
  </tr>
</table>

## 骰子表达式语法

```
基础         2d6 + 1d20 + 5
优势         adv(1d20)              投两次取较高
劣势         dis(1d20)              投两次取较低
精灵之准     adv(1d20, 2)           投三次取最高
保底         max(1d20, 10)          值不低于 10
封顶         min(1d20, 15)          值不高于 15
触发重投     reset(1d20, 1)         投到 1 时重投一次
爆发         burst(2d6)             投到最大值时追加一颗，链式最多 5 次
同值高亮     same(2d20)
重复         repeat(3, 1d20+5)      投 3 行，每行独立总和
独立段       adv(1d6) + adv(1d4)    两个独立优势骰
嵌套         adv(max(1d20, 10) + 5)
```

中文标点 `（）` 和 `，` 自动识别。

## 5etools 标签联动

`{@dice}`、`{@damage}`、`{@hit}`、`{@d20}`、`{@chance}`、`{@scaledice}`、`{@scaledamage}`、`{@recharge}` 在搜索结果、怪物面板、角色卡内容中均可点击直接投骰。

- 怪物面板：左键明骰；右键弹出菜单（投掷 / 暗骰 / 优势 / 劣势 / 添加到骰盘）。
- 角色卡能力：字母 = 豁免（含熟练加值），修正 = 检定。
- 角色卡武器：命中加值与伤害骰均可点击。
- 角色卡底部"特性 / 专长 / 法术"小盒：点击 chip 自动填入全局搜索框。

## 怪物图鉴绑定

每个 token 在元数据下存储一个 `com.bestiary/slug` 引用键。怪物完整数据存放在场景元数据 `com.bestiary/monsters` 表中（同种怪物共享一份）。

- 无绑定 token → 右键菜单出现"绑定怪物图鉴"
- 已绑定 token → 右键菜单出现"更换怪物图鉴"和"移除怪物图鉴绑定"
- 绑定与更换会重写 bubbles HP/AC、name 与 dexMod，以匹配新怪物数据。

## 传送门工作流程

1. DM 在左侧工具栏选中"传送门"工具。
2. 在地图上按下并拖拽：起点为圆心，距离为半径。
3. 释放鼠标后弹出命名面板：可填写名字（如"一楼"）和标签（如"001"）。
4. 玩家拖拽 token 到传送门内并松手时，弹出目的地选择面板，列出所有相同标签的传送门。
5. 选定后所有选中单位以六边形螺旋的方式集结到目的地。

### 关于 Dynamic Fog 兼容

OBR 官方的 Dynamic Fog 扩展会阻止有光源的 token 进入迷雾区域。本扩展在传送瞬间临时摘除 token 的光源 metadata（任何含 `attenuationRadius` 或 `sourceRadius` 字段的键），完成位置更新后立刻按 snapshot 1:1 还原，绕开拦截。

## 数据来源

默认使用 5etools 中文镜像 `https://5e.kiwee.top`。可在设置 → 库 中添加自定义数据源（需要遵循相同的 `search/index.json` + `data/*.json` 路径结构）。

## 项目结构

```
obr-suite/
├── public/manifest.json
├── src/
│   ├── background.ts
│   ├── cluster.ts
│   ├── settings.ts
│   ├── state.ts
│   └── modules/
│       ├── dice/         (panel / effect / history / replay / sfx)
│       ├── initiative/   (Preact tree)
│       ├── bestiary/
│       ├── characterCards/
│       ├── search/
│       ├── portals/
│       ├── timeStop.ts
│       └── focus.ts
└── *.html (iframe 入口)
```

技术栈：TypeScript + Vite + Preact（仅先攻面板使用）+ `@owlbear-rodeo/sdk` v3.x。

跨客户端状态：场景元数据（`com.obr-suite/state`），DM 写、玩家读。

每客户端偏好：localStorage（cluster 展开状态、自动浮窗开关、骰子音效、骰子历史等）。

## 许可证

[PolyForm Noncommercial License 1.0.0](./LICENSE)

| | |
|---|---|
| <img src="docs/icons/check.svg" width="14" align="center" /> | 允许查看、修改、二次创作、非商业分发 |
| <img src="docs/icons/check.svg" width="14" align="center" /> | 必须保留版权声明：`Copyright (c) 2026 FullPeople` |
| <img src="docs/icons/x-mark.svg" width="14" align="center" /> | 禁止任何商业用途 |

## 鸣谢

- 骰子图标：[flaticon](https://www.flaticon.com/) by [Freepik](https://www.flaticon.com/authors/freepik)
- 骰子音效：Sound Effect by [freesound_community](https://pixabay.com/users/freesound_community-46691455/) and ksjsbwuil from [Pixabay](https://pixabay.com/)
- 5etools 数据来源：[5e.kiwee.top](https://5e.kiwee.top)（中文镜像）
- D&D 5e 内容版权属于 Wizards of the Coast；本扩展仅作查阅与跑团辅助使用。

## 支持

如果该扩展对你的桌游有用，可以请作者喝杯咖啡：

[![Ko-fi](https://img.shields.io/badge/Ko--fi-FullPeople-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/fullpeople)
[![Afdian](https://img.shields.io/badge/%E7%88%B1%E5%8F%91%E7%94%B5-FullPeople-FF6B9D?style=for-the-badge&logo=heart&logoColor=white)](https://ifdian.net/a/fullpeople)

## 联系方式

- Email：[1763086701@qq.com](mailto:1763086701@qq.com)
- GitHub：[@FullPeople](https://github.com/FullPeople)
- 自托管节点：[obr.dnd.center](https://obr.dnd.center)
