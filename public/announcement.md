# DM 公告

> 编辑此文件直接修改弹窗内容。每个 `## 标题 [kind] [lang]` 是一个分区，
> kind 决定渲染样式：
>   - `[warn]` 红色警告条 / `[info]` 蓝色提示条 / `[notice]` 长文段落
>   - **A 板块** `[issues]` bug / 需求表格 — 每行 `类型 | 严重度 | 描述`，
>     类型 ∈ `bug` / `feature` / `wip` / `done`；严重度可省略。
>   - **B 板块** `[highlights]` 新亮点图文 — 每行 `图片URL | 标题 | 描述`。
>   - **C 板块** `[changelog]` 简单更新日志 — 每行 `版本号 · 描述`。
>     **注意：侧栏喇叭的「未读」判定就是从这里抓第一个 `- x.y.z ·` 版本号，
>     每次发布务必更新它，否则玩家端不会提示有新公告。**
>   - `[todo]` 普通待办列表 / `[footer]` 落款。
> lang 控制独立的 CN|EN 切换：`[zh]` 仅中文，`[en]` 仅英文，不带标签则两边都显示。
>
> 行内：`**粗体**`、`` `代码` ``、邮箱自动转 mailto，
> `<span style="color:#hex">文本</span>` 上色。
> 部署：`bash deploy-suite-dev.sh`（dev）或 `bash deploy-suite.sh`（正式版）。

## 2026/8/25 [notice] [zh]

添加了动态迷雾：可以在迷雾墙上开门、开窗、开密门，玩家能自己开关门。详见设置。
为 DM 添加了简易的改骰子结果功能，在骰盘界面。
为先攻角色轮添加了轮到的提示，轮到你时会弹出，下一位会收到准备提示。
新增了「搜索栏仅 DM 可见」开关。
优化了状态追踪的同步，状态图标不会再丢失或重复。
优化了传送门，落点会自动避开墙壁。
优化了性能，描边地图的墙体计算、迷雾编辑器、怪物搜索都快了数倍。
修复了变身后仍然显示 DM 变身菜单的问题。

## ⚠️ 请关掉官方 Dynamic Fog 扩展 [warn] [zh]

本套件已经包含官方 Dynamic Fog 的全部功能，并且多了窗户、玩家可开关的门和密门。两个同时开着不会报错，但每面墙、每盏灯都会被建两遍。官方扩展里画好的门会自动继承，光源需要重新添加一次。

## 2026/8/25 [notice] [en]

Added dynamic fog: doors, windows and secret doors on fog walls, and players can work the doors themselves. See Settings.
Added a simple DM dice-result override, in the dice panel.
Added turn notifications to the initiative tracker — a prompt on your turn, and a heads-up for whoever is next.
Added a "search bar is DM-only" toggle.
Improved status-tracker syncing; status icons no longer go missing or double up.
Improved portals — landing spots now avoid walls.
Improved performance: wall derivation on traced maps, the fog editor and monster search are all several times faster.
Fixed the DM transform menu still showing on already-transformed tokens.

## ⚠️ Please turn off the official Dynamic Fog extension [warn] [en]

This suite already contains everything the official Dynamic Fog does, plus windows, player-operable doors and secret doors. Running both is not an error, but every wall and every light gets built twice. Doors you already drew are imported automatically; lights need adding again.

## 版本 [changelog]

- 1.2.2 · 2026/8/25 更新

## 落款 [footer]

— 弗人 / FullPeople
