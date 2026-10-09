# 文字演出 266 已上线

新版枭熊插件已更新至 **1.0.266-dev**。刷新枭熊后，从音乐板右侧打开“文字演出”。安装地址：[新版插件](https://obr.dnd.center/suite-dev/manifest-dev.json)。

预览区和播放按钮在滚动设置时保持可见，动画照常播放。设置分为文字、样式、动画、装饰和背景五页，全部使用高亮点选，没有下拉菜单；相关参数随当前内容和效果显示，数值可拖动滑块或直接输入。桌面为左右布局，窄屏固定预览在上方。

独立实现参考工具全部效果类型：23 种入场、18 种退场、9 种停留、7 种正文展开、横竖排、10 种参考装饰和 5 种参考背景。另保留原 4 种画面装饰及横幅、暗幕。支持渐变、内外描边、阴影、发光、故障颜色、副标题样式、逐字或逐行展开、标点停顿、分页、九个位置和相应细节设置。

八个内置预设和最多 20 个本机自定义预设可点选应用，删除支持撤销，原 265 草稿可继续使用。配置完成后，“在枭熊中预览”影响自己的画面，DM 点击“播放到房间”向当前场景播放，并可停止本次演出。文字与效果直接渲染，不生成 APNG 或其他图片。

## 验证与范围

- 最终 9 个精确提交 CI 工作流全部成功，34 个任务通过；2 个 Data 抓取任务按原有条件跳过。Data 验证沿用同一不可变提交的既有成功运行，Web 和 Suite 为本轮最终提交的新运行。
- 16 组控制器、模型与运动检查、14 组实际浏览器场景、48 组完整 Suite 回归通过。浏览器覆盖全部效果、横竖排、字素、分页、原生显示页、权限变化、停止、重复请求及固定预览窄屏布局。
- 配套 Web 最终 CI 的 1,176 项单元检查通过，90 项按原有条件跳过。
- 正式产物下载自 Suite 最终成功 CI，包含文字演出编辑器、原生显示页及生产骰子包；各源码下载包与受测提交绑定。
- 本轮逐一核对 60 个规则消费者模块及已锁定 Data 报告字节未变，复用原 229 份输入报告：18,789 条规则、6,527 条已实现。未修改规则结论，未把本轮核对表述为重新审查 229 份输入。
- 公网 90 个入口、资源和源码包散列匹配；4 次压缩请求内容匹配。
- 服务器正式目录 7894 个文件和完整备份匹配，123 项受保护内容保持一致。
- 本轮只发布 `/suite-dev/`。

浏览器房间宿主是合成夹具。真实枭熊多人房间、实体手机和玩家原设备尚未现场验收。

## 失败记录与复验

首轮整体验证发现文字演出测试页面的专用依赖被普通网页预扫描，影响其他浏览器检查。已将依赖限制为文字演出测试页面，最终 Web 与 Suite 提交重新运行完整 CI。普通网页的独立与集成流程本机也复验通过。原有工具选择检查出现一次拖放波动；最终提交对应工作流通过。最终提交首次完整浏览器运行中的原有法术赠送检查在刷新后的拖放处失败，相关生产代码和断言未变，保留失败日志并复跑该任务后通过。

本机 Windows 首轮 Web 全量检查受到读取超时及 Node 类型加载设置影响；延长本机检查等待时间并限制并发后，必需的自动化进度检查通过。最终 CI 使用仓库正常设置并通过。首轮失败日志保留。

## 来源与恢复

| 仓库 | 正式包源码 | 已合并提交 |
| --- | --- | --- |
| FullPeople/DND-card-web | `8a328c4d643b8ac94d87d59d376e2532736079e3` | `cfc75455ba1ae7d9594d518ed54912748a76fd50` |
| FullPeople/obr-suite | `e57af4455c1087f2a5e373a1c15b48130ca20a20` | `318a6aeee308754f903e91622ea6a938b02c0911` |
| FullPeople/dnd5e-automation-data | `d6bee639c5e80c88d414fd5cdceabe648609d16d` | 本轮未修改或合并 Data |

两次合并的树均与最终受测源码相同。发布完成时间（UTC）：`2026-10-09T19:07:42.851198+00:00`。发布后的记录提交只补文档，不重包或重部署。

包回执 SHA-256：`d3043d28e4da57c545fa39c11b6d8258dfa0c47d07c20845e7b5c72c268ff350`。服务端回执：`/root/codex-release-receipts/text-effects266-20261010.json`。

完整回滚副本：`/var/www/obr-plugins/suite-dev-before-text-effects266-20261010`。以下命令仅在目标全树和受保护内容仍与本轮回执一致时恢复 265；若后续发布改变这些内容，帮助程序会拒绝执行，须重新核对。

```sh
python3 /root/codex-release-packages/text-effects266-20261010/suite_links.py --archives /root/codex-release-packages/text-effects266-20261010 --receipt-sha d3043d28e4da57c545fa39c11b6d8258dfa0c47d07c20845e7b5c72c268ff350 --rollback
```

## 最终 CI

- [data · automation-ir validation · 37963194238](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37963194238)
- [data · automation-ir validation · 37963070257](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37963070257)
- [web · Verify tool proficiency choices · 37974966292](https://github.com/FullPeople/DND-card-web/actions/runs/37974966292)
- [web · Verify shield training binding · 37974966258](https://github.com/FullPeople/DND-card-web/actions/runs/37974966258)
- [web · Verify responsive spell icon painting · 37974966320](https://github.com/FullPeople/DND-card-web/actions/runs/37974966320)
- [web · DND Center cloud migration · 37974966099](https://github.com/FullPeople/DND-card-web/actions/runs/37974966099)
- [web · Verify automation progress · 37974966476](https://github.com/FullPeople/DND-card-web/actions/runs/37974966476)
- [web · Verify web · 37974966066](https://github.com/FullPeople/DND-card-web/actions/runs/37974966066)
- [suite · Verify Suite candidate · 37975057435](https://github.com/FullPeople/obr-suite/actions/runs/37975057435)
