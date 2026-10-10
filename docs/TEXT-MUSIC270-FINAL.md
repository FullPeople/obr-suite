# 2026-10-10 · 文字演出与音乐板 270 最终回执

新版插件已上线 **1.0.270-dev**，只更新 `/suite-dev/`。安装入口为 [新版插件](https://obr.dnd.center/suite-dev/manifest-dev.json)。房间参与者刷新插件后使用；点击“默认演出”可以载入新的初始效果。

## 最终行为

文字演出依据 [参考网站](https://kumachansteps.github.io/trpg-web-tools/tools/text-apng-maker/) 的实际中文页面、字体／动画／装饰设置截图及默认场景参数重新实现。默认是“战斗开始 / BATTLE START”：白色衬线标题、拉开字距的英文副标题、透明填色细线框；装饰先展开，标题逐字落下，副标题淡入，最后文字前推放大、细框收起，总长约 4.225 秒。参数与视觉以参考为依据，不宣称逐像素复制。

移除光晕、光芒、雾气、光点、光环和内置故事示例，只保留唯一默认演出与用户预设；保留 23 种入场、18 种退场、8 种停留、7 种正文方式及平面线条装饰。预览和播放区固定，设置分五页并用高亮按钮选择。支持本机预览、自己的枭熊画面预览、由 DM 向当前房间播放及停止，不生成 APNG。旧默认草稿更新到新初始效果，已修改的文字和配置保留，退役装饰转换为无装饰。

默认四字标题使用内嵌的 Noto Serif SC 小字体子集，英文、数字与标点使用 Cinzel 小子集，共 20,640 字节；运行时不访问外部字体网站。其他自定义汉字使用既有系统衬线回退。授权与来源保存在 `public/fonts/text-effects`，外站渲染器与 APNG 生成器未复制入产品。

音乐板直接整理和播放外链音频，移除额外网站入口、第二页签和配对。支持曲目编辑、背景音乐／音效、循环、分组、标签、收藏、颜色、曲目音量、搜索筛选、音效快捷播放、队列整理及上一首。关闭或缩小后后台继续播放。JSON、外链列表和旧分享码先预览，再合并或替换；可导出完整曲库，房间持久保存，本机保留上一版备份与添加草稿。个人音量与房间音量分别调整，原权限和音频生命周期保留。大库广播按大小分片，先完整重组再处理。

保留主线已上线的混合骰 269 改进和配套 Web 的已批准更新；本任务没有改写规则实现。267／268 为本地候选编号，未分别发布。稳定插件、独立网站、旧音乐网站、首页、三龙、后台服务和玩家数据本轮未发布或修改；本次发布前后 123 项保护值一致。

## 来源与验证

运行源码：Suite `caa63cab5c19a75907ec6f72389210b6fdb25d2a`，Web `cdcb8db708d501e97a650c0bb88453a5035c5728`，Data `acb91cd7790decd0289031cbeda8231f4ef2c91e`。Web 保持独立站公告版本 `0.1.55`，本轮只变更新版插件公告。配套资料核验保留 229 份锁定输入、62 个消费者模块、18789 条记录与 6535 项实现见证。

- FullPeople/DND-card-web：[PR 44](https://github.com/FullPeople/DND-card-web/pull/44)，合并提交 `ffb47a94ae9fcfaf93ba1fe9296f6181e8d40f4a`，tree `6267bb3f55202cfcb6c7d1b991d0401e1a7fb242` 与受测源码一致。
- FullPeople/obr-suite：[PR 42](https://github.com/FullPeople/obr-suite/pull/42)，合并提交 `306341d0fd01d9968ae62e64c6a415ea131900dd`，tree `92896e165a0461f7956dfe1c089be24790896f71` 与受测源码一致。

| 仓库 | 精确提交检查 | 源码 | 结果 |
| --- | --- | --- | --- |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37996648946) | `acb91cd7790decd0289031cbeda8231f4ef2c91e` | 成功 |
| data | [automation-ir validation](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37996604834) | `acb91cd7790decd0289031cbeda8231f4ef2c91e` | 成功 |
| web | [Verify tool proficiency choices](https://github.com/FullPeople/DND-card-web/actions/runs/38010061604) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| web | [Verify shield training binding](https://github.com/FullPeople/DND-card-web/actions/runs/38010061594) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| web | [Verify responsive spell icon painting](https://github.com/FullPeople/DND-card-web/actions/runs/38010061596) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| web | [Verify automation progress](https://github.com/FullPeople/DND-card-web/actions/runs/38010061581) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| web | [DND Center cloud migration](https://github.com/FullPeople/DND-card-web/actions/runs/38010061605) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| web | [Verify web](https://github.com/FullPeople/DND-card-web/actions/runs/38010061590) | `cdcb8db708d501e97a650c0bb88453a5035c5728` | 成功 |
| suite | [Verify Suite candidate](https://github.com/FullPeople/obr-suite/actions/runs/38010387139) | `caa63cab5c19a75907ec6f72389210b6fdb25d2a` | 成功 |

本机文字演出协议、权限、迁移和时间表 17 项通过，生产渲染浏览器 15 个场景通过，整套插件 50 组回归通过。音乐板转换、实际音频生命周期、113 曲目大库、分片广播、导入恢复、后台播放及窄屏界面通过。最终精确源码 CI 再次验证完整构建、文字演出、音乐、权限、骰子与既有功能。

服务器 8102 项完整目标文件散列吻合，本批 1328 项文件吻合，完整旧版备份验证通过。公网 89 项完整文件散列、9 个源码别名的大小／提交尾注及 6 项压缩响应吻合；其中两份代表性完整源码 ZIP 已下载核对，服务器核对全部别名完整内容。

已发布的真实编辑器与音乐界面由浏览器打开，默认排版、无下拉菜单、无光晕选项、编辑界面和本地预览动画通过，页面错误为零。该界面验收使用模拟 SDK 父页面，不向实际房间发指令；它证明公网正式文件可运行。真实多人 Owlbear 房间、玩家网络和实体设备仍未现场验收，不能以本机或模拟宿主结果代替。

## 备份与回滚

发布前版本为 `1.0.269-dev`，完整恢复点为 `/var/www/obr-plugins/suite-dev-before-text-music270-20261010`。发布器在所有备份、目标树和保护状态通过后原子切换，没有重启服务或写入玩家数据。冻结回执 SHA-256 为 `9c01753924ca8abb6cc2eb7b988cf758de93cbb3ac7a667be4d004c29d049278`。

如需恢复，先核对当前目标树、恢复副本和发布后的保护状态，再使用本批发布器；保护值变化时停止并复核。

```sh
python3 /root/codex-release-packages/text-music270-20261010/suite_links.py --archives /root/codex-release-packages/text-music270-20261010 --receipt-sha 9c01753924ca8abb6cc2eb7b988cf758de93cbb3ac7a667be4d004c29d049278 --rollback
```

此回执为发布后的记录文件；后续文档提交不替换上述运行源码、受测树、制品与源码 ZIP。
