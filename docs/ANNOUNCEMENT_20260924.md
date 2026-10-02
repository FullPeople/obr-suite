# 2026-09-24 稳定版公告

本次按作者定稿发布新版 Full Suite 引流公告，文字见 `public/announcement.md`。稳定版版本和功能保持 1.3.5，只替换公告正文、公告 HTML 的模块引用，并增加独立公告脚本。为显示作者提供的两个命名链接，补充转义后的 Markdown 链接渲染；不替换稳定版 background、骰子、角色卡或其他业务资源。

`node tools/announcement-inline-selftest.mjs` 通过 9 项断言，实际产物浏览器验证两条链接、中文标题、CN/EN 切换和无脚本错误。

构建：`node tools/build-announcement.mjs [当前公告HTML] [输出目录]`。发布时模板取自部署中的 `dm-announcement.html`，保留现有样式和结构，只替换模块脚本及预加载标签。
