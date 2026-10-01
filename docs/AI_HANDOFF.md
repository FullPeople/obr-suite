# 2026-10-02 · 230 最终配套源码，仅 GitHub、不部署

当前源码以 startup-226 的实际 227 宿主基线 1da2715 为基础，包含骰子225及其完整回执，合入 selection-follow223-suite。对应 Web 为 codex/final-integration230（229/228首屏与Wiki恢复 + selection-follow223）。Suite 输出 codex/final-integration230-suite。230为源码合并编号，manifest仍保留1.0.227-dev和stable1.3.14，本次没有部署，下面225的“当前新版”表述仅为历史记录。

合并后的单元482通过/23跳过，组合Edge浏览器40通过/5跳过；Suite选择及群体37项、骰子各类53项通过；真实物理/完整动画、59资产锁、1053静态引用、实际SDK及5卡20怪物本地HTTP relay通过。未执行真实登录房间、玩家原设备/线路、公网发布和完整发布CI。首轮失败、修订及具体复验见 [230合并记录](INTEGRATION-230-RESULT.md)。

构建时必须用 DND_CARD_WEB_ROOT 指定同批最终Web分支，不能使用历史混合脏根目录。隔离目录 D:/Desktop/DND-card-web/.local-evidence/final-integration230/{web,suite}；旧工作树和用户预览保留。不得把旧稳定main整体覆盖到当前宿主，不推送main或dev，不运行部署脚本。下面历史发布回执不能代替本批合并验收。

