# DM 公告

> 编辑此文件直接修改弹窗内容。每个 `## 标题 [kind] [lang]` 是一个分区，
> kind 决定渲染样式：
>   - `[warn]` 红色警告条 / `[info]` 蓝色提示条
>   - **A 板块** `[issues]` bug / 需求表格 — 每行 `类型 | 严重度 | 描述`，
>     类型 ∈ `bug` / `feature` / `wip` / `done`；严重度 ∈ `critical` /
>     `high` / `medium` / `low`（可省略）。
>   - **B 板块** `[highlights]` 新亮点图文 — 每行 `图片URL | 标题 | 描述`，
>     图片可省（仅写 `标题 | 描述` 也行）。图片相对路径会自动按 base 解析。
>   - **C 板块** `[changelog]` 简单更新日志 — 每行 `版本号 · 描述`。
>   - `[todo]` 普通待办列表（每行 `desc | tag | size`）/ `[footer]` 落款。
> lang 控制独立的 CN|EN 切换：`[zh]` 仅中文模式显示，`[en]` 仅英文，
> 不带语言标签则两边都显示（如 footer / 共享通知）。
>
> 行内：`**粗体**`、`` `代码` ``、邮箱自动转 mailto 链接，
> `<span style="color:#hex">文本</span>` 给一段文字上色。
> 部署：`bash deploy-suite-dev.sh`（dev）或 `bash deploy-suite.sh`（正式版）。

## 警告 [warn] [zh]

## 提示 [info] [zh]

- 有任何其他的 bug 可以汇报到在线文档：https://docs.qq.com/sheet/DWE9JVFN6VXhvYmpX?tab=000001。提bug之前请看看文档里有没有记录！！提bug之前请看看文档里有没有记录！！提bug之前请看看文档里有没有记录！！
- <span style="color:#5dade2">**由于改了血量的数据结构，会导致之前所有的怪物血量/进度玩家不可见。可在「设置 → 血量气泡 → 维护」里点「修复当前场景」一键修复（每个旧场景需点一次）。**</span>
- <span style="color:#5dade2">**修复了大量的bug**</span>，但不保证没有新的bug，**如果发现了新的bug请务必汇报**（邮箱 / 在线文档都行）。我会尽快修复的。
- 您的支持会添加到 **贡献名单**，在**设置**里找到支持链接，**助力我修快些加功能加快点**，並且完成以下待办！！

## 新亮点 [highlights] [zh]

> 给重要新功能配一张演示图（放在 `obr-suite/public/` 下，写相对路径），或省略图片只写标题 + 描述。

- trickster-tool-icon.svg | 捣蛋鬼在哪？ | 工具栏新插件。GM 在地图上**画一个隐藏触发圆**（玩家看不见），等目标 token 走进圆里 → <span style="color:#a06bd9">**自动开时停 + 镜头聚焦它**</span>。做<span style="color:#a06bd9">**埋伏 / 陷阱触发器**</span>很顺手，可选"仅触发一次"模式。详见 设置 → 捣蛋鬼在哪？
- circleimage-icon.svg | 圆形图片 / 黑白底剔除 | 工具栏新插件。本地拖图进去 → <span style="color:#5dade2">**圆形头像裁剪**</span>（pan/zoom + 自定义颜色环）<span style="color:#5dade2">**或白底/黑底自动剔除**</span>（容差 + 羽化）→ 上传到 OBR 资源库 → 从资源库拖到场景。给临时 NPC 做头像 / 把立绘抠成透明背景 token 都行。
- exe_icon.png | 角色卡名词点击搜索 | 全屏角色卡里点击**法术 / 特性 / 专长**的名字，全局搜索会自动打开并选中第一项 — 不用手动复制粘贴

## Notice [info] [en]

- Found a bug? Email me at 1763086701@qq.com.
- <span style="color:#5dade2">**The suite now ships its own HP/AC bubbles**</span> — you can safely **disable** the third-party "Stat Bubbles for D&D" plugin; the built-in bubbles take over with a more unified look (silhouette mode for bestiary-bound enemies, locked/viewmode, threshold quantisation).
- The current public build is the **stable** channel. New features land first on the dev channel; once they settle they get promoted here.
- Your support will be credited in the **contributors list** (link in **Settings**). It directly funds faster fixes and ongoing development!

## 落款 [footer]

— 弗人 / FullPeople
