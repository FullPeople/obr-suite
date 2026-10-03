# 2026-10-04 · 初加载修复242最终回执

网站standalone-1.0.242（公告0.1.33）与新版Suite1.0.242-dev已配套发布。用户原线路无痕复测回复“已无额外等待”。该反馈没有逐入口拆分，不扩展为真实多人房间或实体手机验收。

## 查明的共同回归与修复

- 加入遮罩动画后，原来的afterPaint下一帧回调仍把隐藏的卡面当成已经显示，Wiki、编辑运行时和装饰会在开屏期间下载，离线缓存也提前启动。现以开屏实际complete为可选任务的边界。恢复明确保存的编辑模式时提前准备对应运行时，避免临时只读和错误显示；新浏览保持延后加载。
- 旧HTML的卡面CSS会阻止内联开屏脚本运行，四张外链PNG全部下载解码后才开始动画。样式体积小并不保证请求快，此前实际样本曾观测到CSS约10秒、最后一层图片约33秒。现由小型内联样式显示开屏，卡面CSS独立下载，准备好后才允许透明退出。生产HTML内嵌无损WebP图层，总体积241159到77868字节（减少约68%）；可见像素和alpha一致，原PNG仍保留原散列。
- 黄色层降低opacity，淡出时下方实际卡面已显示；退出完成后才解除inert并显示公告。保留每层1.9秒移动、0.42秒错开、0.95秒完成淡入、0.33秒最终姿态停留和0.45秒退出。
- 241上线验收还复现了早期资源失败漏接：CSS请求在HTML主体控制器到达前失败，黄色层会一直等待。242从head捕获资源错误、主体就绪后重放；root先于控制器存在，失败路径不留下无效计时器。真实分段HTTP响应和浏览器中止样式请求验证了该竞态。
- 对动画前8c58542、240与本批修复候选做同条件比较。依赖锁定版本未升级，首屏核心JS压缩后约增加11KB、CSS约增加5KB；没有查到固定5秒计时器或巨大新首屏依赖。32KiB/s、150ms、相同原创角色和空缓存条件下，进入卡面约9.5/18.2/12.6秒；24KiB/s约12.4/23.4/16.4秒。角色名称、关闭自动化的意愿和资源2/5保留，页面错误0。修复候选测量在242公告号变更前运行，不能当作玩家线路的保证。本方正常公网未精确复现原有限约5秒现象；部署后的用户复测补充了这个边界。
- 241阶段已应用Nginx预压缩gzip和immutable缓存，仅作用于/card/和/suite-dev/带内容散列的JS/CSS。HTML、SW、manifest和公告更新策略保留。242保留同一已审查配置，没有再次修改Nginx。

## 合入、来源与CI

无冲突、非强推快进合入；没有额外merge commit。运行源码及公网ZIP绑定如下精确SHA，最终回执后续文档提交不改变运行代码。

| 仓库 / 主线 | 原241提交 | 242合入提交 | 完整CI |
| --- | --- | --- | --- |
| FullPeople/DND-card-web / main | 9e8cf1fdafcb29d5573a8467418ea32b9ad41f70 | 21affa0025c21a3f59d8b84a097eb2e467f63567 | [37136654840](https://github.com/FullPeople/DND-card-web/actions/runs/37136654840)，verify及16浏览器组success |
| FullPeople/obr-suite / dev | b48783c9263dd7a30fcf324802ba33c8cd492b59 | f0831bc15749e67b12630184c993b00380f071cc | [37136774393](https://github.com/FullPeople/obr-suite/actions/runs/37136774393)，success，固定精确Web SHA |

Web单元800通过、25外部资料条件跳过；集成和standalone构建通过。完整CI覆盖技能、仪表盘保存与草稿、护甲、装备、恢复、来源及其他既有回归。Suite检查包括公告、权限夹具和三龙牌座位/离开等既有流程。旧稳定main保持639c8217b41905fbde4222783ff16e95bde13b67；未写入oldstable，不合入后端PR、Owner修复或自动化重构分支。仅使用F:/CodexWork/2026-10-03/startup241/{web,suite}隔离源码构建，不以混合D:/Desktop/DND-card-web根目录为发布输入。

241阶段双方CI和443项公网文件校验通过，但首次公网启动检查11通过/5失败：3条是测试在DOM解析前读取documentElement的竞态，2条是真实早期CSS错误漏接。因此追加242；保留原失败记录，不把241首次启动验收记为全绿。

## 部署与验收

- /card/：standalone-1.0.242，公告0.1.33。
- /suite-dev/：1.0.242-dev，workbench、card-viewer和共用面板配套。suite-3d-4标记保留。
- 公网244项文件/源码ZIP散列通过，21项gzip内容与缓存头检查通过。
- 本机及实际HTTPS公网各18项启动浏览器检查通过，覆盖首次/缓存、慢脚本/样式、实际卡面下的透明退出、公告顺序、减少动画、独立于外链图片、失败恢复、提前资源错误及中断重入。资料采用原创夹具；不是登录枭熊真实房间。
- 批量下载和公网功能测试结束后，独立进行未模拟上游资料的空缓存/热缓存测量：网站3.453/4.012秒，新版工作台3.355/3.299秒，只读阅读器启动外壳3.301/3.201秒。六次均complete、页面错误0。依据实际CSS动画startTime，拼合结束至开始淡出约0.344至0.349秒，包含约0.33秒批准的姿态停留；停留结束后无额外加载等待。这些总时长不能推广到所有玩家线路。
- 用户在原线路无痕复测反馈“已无额外等待”。本轮没有逐项现场复验实体手机、原设备和真实多人房间。
- 发布后完整文件树及两份恢复副本散列一致。旧/suite/、独立/three-dragon-ante-dev/、三龙牌service.mjs、防护、relay代码、Nginx配置、系统服务状态和运行起点保留。发布过程不写玩家数据；此前赞助弹幕密度、柔和颜色/黑阴影、金额字号及洛伦兹力100、技能/仪表盘/护甲和三龙牌成果保留。

## 回滚与证据

发布键startup-recovery242-20261004，服务端回执/root/codex-release-receipts/startup-recovery242-20261004.json。

- /var/www/obr-plugins/card-before-startup-recovery242-20261004
- /var/www/obr-plugins/suite-dev-before-startup-recovery242-20261004

两站完整备份均在任何切换前创建并校验；renameat2原子交换、保留旧资源，异常按相反顺序恢复。同批deploy242.py的--rollback要求当前站点、备份和受保护状态仍匹配回执。242未修改Nginx，回到241无需改配置。若继续回到240，应先恢复241的Nginx备份并核验，再执行241回滚器，避免其原始配置断言失败。

本地证据U:/CodexWork/2026-10-03/startup241/：ci-{web,suite}242.json、package242/package-receipt.json、server-receipt242.json、public242-result.json、hosting-public242.json、browser-public242.json及截图、public-timing242/results.json、protected-after242.json、compare-228-240-241-final.json和acceptance-user242.json。生成证据、私人角色及上游正文不进入公共仓库。
