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

- 有任何其他的 bug 可以汇报到在线文档： https://docs.qq.com/sheet/DWE9JVFN6VXhvYmpX?tab=000001
- 提 bug 之前请先看看文档里有没有记录！！提 bug 之前请先看看文档里有没有记录！！提 bug 之前请先看看文档里有没有记录！！
- 您的支持会添加到 **贡献名单**，在**设置**里找到支持链接，**助力我修快些加功能加快点**

## 新功能 [highlights] [zh]

> 给重要新功能配一张演示图（放在 `obr-suite/public/` 下，写相对路径），或省略图片只写标题 + 描述。

- DM 状态面板 | 右侧栏新增「<span style="color:#5dade2">**状态面板**</span>」—— 一站式管理全员状态和消耗性资源。有英雄激励 / 扮演激励等村规时，不必再打断 PL 扮演说「啊你获得了一个英雄激励」，DM 直接拖一下就完事。
- 骰子皮肤 | 骰子现在可以定制皮肤。把图片 / webm 当作附件拖进场景，<span style="color:#f5d76e">**右键 attachment → 设为我的骰子皮肤**</span>，选好骰种后从场景中删除附件即可。还支持「皮肤库 / 皮肤套组 / 随机池」（每次掷骰从池中随机抽一张）。

## 生活质量更新 [highlights] [zh]

- 角色卡右侧栏快开 | 角色卡现在可以在右侧栏便捷打开了。
- 不再闪烁白屏 | 角色卡默认界面不再是闪烁的白色了，切换角色卡时不会光敏性癫痫了。
- 特效工坊更丰富 | 50 种循环无缝动画（脉冲 / 抖动 / 粒子迸发 / 悠扬乐符 / 落叶 / 萤火虫…），混合模式 + 旋转 + 透明度参数更全，并新增预览底色让混合模式立刻能看清效果。
- 怪物预览网站 | 添加了可以预览怪物数据的网站：<span style="color:#5dade2">**obr.dnd.center/studio/monster-studio/**</span>，粘贴 5etools / 自定义 JSON 即可实时复刻 OBR 弹窗效果。
- 圆角现代化 | 更新了部分难看的圆角按钮，资源追踪 / 骰子面板 / 状态调色板都改成方角现代化样式。
- 顺手报错 bug | 全局搜索栏内的内容详情面板右上角加了「<span style="color:#f5d76e">**未显示？顺手汇报一下**</span>」按钮——发现某条数据没正确显示时点一下，我会统计哪些内容需要做适配。

## bug 修复 [highlights] [zh]

- 翻转 token 不再让 buff 特效颠倒 | 把 token 翻成镜像（scale = -1）后，buff webm 不再上下倒挂。
- 投骰子卡死修复 | 修复了角色卡快捷掷骰偶发卡死整页的问题。
- 角色卡面板点两次才开 | 修复了「点工具栏图标关掉角色卡面板后需要再点一次才能重新打开」的问题，同样修了资源追踪面板。

## 剩余待办 [todo] [zh]

- 角色卡添加 .st 类的可复制直接粘贴到枭熊中的功能模块 | feature
- 接续上一项 — 背包和消耗性资源的自动显示和绑定 | feature
- 迷雾系统重做 | feature | large
- 在线音乐 / 音效平台网站 | feature | large

## Notice [info] [en]

- Found a bug? Email me at 1763086701@qq.com.
- <span style="color:#5dade2">**The suite now ships its own HP/AC bubbles**</span> — you can safely **disable** the third-party "Stat Bubbles for D&D" plugin; the built-in bubbles take over with a more unified look (silhouette mode for bestiary-bound enemies, locked/viewmode, threshold quantisation).
- The current public build is the **stable** channel. New features land first on the dev channel; once they settle they get promoted here.
- Your support will be credited in the **contributors list** (link in **Settings**). It directly funds faster fixes and ongoing development!

## 落款 [footer]

— 弗人 / FullPeople
