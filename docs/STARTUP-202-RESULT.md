# 2026-09-27 · 首次进入长时间停在读取提示：服务器热修已上线

本次是 `obr.dnd.center` 的传输配置热修，编号 202 仅用于证据归档，不是应用版本。国内单机仍为 `standalone-1.0.200`，Full Suite 为 `1.0.201-dev`，旧插件为 `1.3.10`，独立三龙牌为 `0.7.16-dev`。GitHub Pages、应用源码及角色数据没有重新发布。

## 已证实的原因

`src/main.tsx` 中小字“正在读取角色卡…”是 React 动态导入 App / PlayerViewer 的等待界面，此时还没有执行 App 的角色读取。实际本地角色恢复提示是“正在打开你的角色卡…”，旧阅读器数据请求提示是“正在读取角色资料…”，不能混为一谈。

服务器虽有全局 `gzip on`，但未配置脚本、样式的 `gzip_types`，这些文件首次请求返回未压缩内容。新浏览器实测单机启动资源传输约 1.23 MB，新版约 1.32 MB；第二次命中浏览器缓存则没有这些下载。这解释了本次复现的首次很慢、加载后正常。

修复在该站点启用 JavaScript、CSS、JSON、manifest、SVG 的 gzip，增加 `Vary: Accept-Encoding`，最小压缩长度 512 字节，压缩级别 5。没有更改文件哈希或缓存有效期。配置检查通过后平滑重载 Nginx，没有重启中继。新旧插件及独立三龙牌使用同一站点，因此相应资源也获得压缩。

## 公网浏览器验证

Windows Edge、1280 × 960、测试浏览器直连、每个入口新建空缓存上下文。记录从导航开始到页面外壳挂载；暖启动强制 reload，不能把同 URL hash 导航算作新加载。以下都是单次样本，不是所有玩家网络的保证。

| 入口 | 修复前冷启动 | 修复后冷启动 | 修复后暖启动 | 首屏资源传输前 → 后 |
| --- | --- | --- | --- | --- |
| 国内单机 `/card/` | 4.299 秒 | 0.912 秒 | 0.437 秒 | 1,232,363 → 421,078 字节 |
| 新版 `/suite-dev/workbench/` | 10.569 秒 | 0.616 秒 | 0.398 秒 | 1,317,243 → 464,242 字节 |

上述对照只替换 Wiki 上游 fetch 返回值，以隔离程序启动，不替换生产脚本、样式或本地存储实现。修复前 Suite 暖启动误用了同 URL hash 导航，证据中这一行无效，未用于结论。随后修正为 reload。

补测完全不拦截 Wiki 请求：单机冷启动 1.094 秒、暖启动 0.490 秒；新版冷启动 0.624 秒、暖启动 0.412 秒；旧阅读器冷启动 0.849 秒、暖启动 0.367 秒。六次均无页面脚本异常，桌面截图已检查。旧阅读器没有传入私人角色 URL，仅验证阅读器程序结束加载并显示缺少 JSON 的明确提示，不能称作远程角色读取通过。

80 个 gzip / identity 公网响应检查通过，涵盖单机、新版、旧阅读器、新旧插件入口、独立三龙牌及三个安装清单。解压结果逐个与服务器原文件字节一致；512 字节以上协商压缩，短文件保留原样。当前 App / PlayerViewer 文件根据入口脚本引用解析，不从历史保留资源中随意取第一个。

运行版本清单与中继三个代码文件哈希前后相同，中继进程启动时间未变。角色目录没有任何写操作。

## 证据与恢复

- 本机证据：`D:/Temp/DND-card-startup202/`，含 `before-browser.json`、`after-browser.json`、`after-real-browser.json`、`after-integrity.json`、`nginx-deployment.json` 及截图。
- 浏览器复测：Web `node tools/startup202-browser.mjs after-real --real-wiki --legacy`，默认写到上述证据目录，使用隔离浏览器，不影响用户自己的浏览器。
- 公网压缩与内容复核：Suite `python tools/startup202-verify.py`，需要已配置的服务器 SSH 访问，只读检查。
- 线上配置：`/etc/nginx/sites-enabled/obr-plugins`；原配置备份：`/etc/nginx/rollback/obr-plugins.before-startup202`；部署记录：`/var/www/obr-plugins/startup202-compression.json`。
- 修改前配置 SHA-256：`6517a8300a287711d627b5401850d167cee85a1dd8e5400048f005750a17ef67`；修改后：`fc00af890bf7441b957fa06769a60dace5c91fd8a23bc10db052385aea4ade49`。

需要回滚时先比较现有配置与上述修改后哈希，防止覆盖后续维护；仅在匹配时将原配置复制回原位置，`nginx -t` 通过后执行 `systemctl reload nginx`。备份必须在 `sites-enabled/*` 包含范围之外。本次第一次放在该目录的备份产生了重复 server_name 警告，已立即移出并重新校验、重载；最终只有原有 vtt 配置的重复 MIME 类型警告，没有本站重复 server 警告。

实际应用的站点配置：

```nginx
gzip on;
gzip_vary on;
gzip_comp_level 5;
gzip_min_length 512;
gzip_proxied any;
gzip_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml;
```

## 验证边界

本次确认并修复的是国内站首次程序下载阻塞。没有真人多人枭熊房间、实际手机弱网、完整 Wiki 下载结束耗时或私人远程角色读取的验收，也不宣称 GitHub Pages 有相同服务器配置问题。已有待验证项保持原状态。用户正常刷新即可获得修复，不需要清空缓存或角色。

两处主目录混合源码保持不动，开发继续使用 `F:/CodexWork/2026-09-27/feedback/{web,suite}`。本轮主目录只回填交接和验证文档。
