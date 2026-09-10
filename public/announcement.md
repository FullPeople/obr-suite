# DM 公告

> 编辑此文件更新公告。[release] 为当前分条日志，[history] 为默认折叠的历史日志。

> 使用 [zh] / [en] 区分语言；[changelog] 第一条版本号决定公告未读提示。

## 2026/9/9 · 1.3.0 [release] [zh]

- 上线了音乐板功能。现在可以使用枭熊播放音乐了。
- 添加了boss级别的血条显示，在玩家端正常保持阈值。
- 优化了转场和CG的显示。
- 增加了玩家视野可共享的开关。
- 现在传送门可以在设置里自定义默认图标了。

## 2026/9/9 · 1.3.0 [release] [en]

- Launched the music board. You can now play music in Owlbear Rodeo.
- Added boss health bars that respect the existing player visibility thresholds.
- Improved transition effects and CG presentation.
- Added a switch for sharing vision between players.
- You can now choose a default portal icon in Settings.

## 2026/8/25 · 1.2.2 [history] [zh]

- 添加了动态迷雾：可以在迷雾墙上开门、开窗、开密门，玩家能自己开关门。详见设置。
- 为 DM 添加了简易的改骰子结果功能，在骰盘界面。
- 为先攻角色轮添加了轮到的提示，轮到你时会弹出，下一位会收到准备提示。
- 新增了「搜索栏仅 DM 可见」开关。
- 优化了状态追踪的同步，状态图标不会再丢失或重复。
- 优化了传送门，落点会自动避开墙壁。
- 优化了性能，描边地图的墙体计算、迷雾编辑器、怪物搜索都快了数倍。
- 修复了变身后仍然显示 DM 变身菜单的问题。
- 本套件已经包含官方 Dynamic Fog 的全部功能，并且多了窗户、玩家可开关的门和密门。两个同时开着不会报错，但每面墙、每盏灯都会被建两遍。官方扩展里画好的门会自动继承，光源需要重新添加一次。

## 2026/8/25 · 1.2.2 [history] [en]

- Added dynamic fog: doors, windows and secret doors on fog walls, and players can work the doors themselves. See Settings.
- Added a simple DM dice-result override, in the dice panel.
- Added turn notifications to the initiative tracker — a prompt on your turn, and a heads-up for whoever is next.
- Added a "search bar is DM-only" toggle.
- Improved status-tracker syncing; status icons no longer go missing or double up.
- Improved portals — landing spots now avoid walls.
- Improved performance: wall derivation on traced maps, the fog editor and monster search are all several times faster.
- Fixed the DM transform menu still showing on already-transformed tokens.
- This suite already contains everything the official Dynamic Fog does, plus windows, player-operable doors and secret doors. Running both is not an error, but every wall and every light gets built twice. Doors you already drew are imported automatically; lights need adding again.

## 版本 [changelog]

- 1.3.0 · 2026/9/9

## 落款 [footer]

- — 弗人 / FullPeople
