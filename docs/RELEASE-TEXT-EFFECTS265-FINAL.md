# 文字演出 265 已上线

新版枭熊插件已更新至 **1.0.265-dev**，入口在音乐板右侧。安装地址保持 [新版插件](https://obr.dnd.center/suite-dev/manifest-dev.json)。关闭附加窗口并刷新枭熊后，可打开“文字演出”。

可配置标题、副标题和正文，以及字体、颜色、描边、发光、对齐、位置、背景、入场动画、画面效果和时长。支持即时预览、五个内置预设和最多 20 个本机自定义预设。“在枭熊中预览”只影响自己的画面；DM 点击“播放到房间”后，当前场景中已连接的玩家会收到演出。可显式停止，长正文按画面分页。

文字与效果直接渲染，完全不生成 APNG。效果独立实现，没有复制参考网页的程序或素材。

## 验证与范围

- 最终 9 个 CI 工作流全部成功，34 个任务通过；2 个 Data 抓取任务按原有执行条件跳过。
- 13 组生产控制器模拟、9 组浏览器场景、受限面板权限及完整 48 组 Suite 回归通过；配套 Web 的 1,176 项单元检查通过，90 项按原有条件跳过。
- 正式构建来自最终成功 CI，包含文字演出编辑器、原生显示页及原有生产骰子包。
- 229 份原始输入完成真实重审，18,789 条规则、60 个消费者模块、6,527 条已实现，规则状态与 264 相同。
- 公网 83 个入口、资源和源码包散列匹配；4 次压缩请求内容匹配。
- 服务器正式目录 7738 个文件及完整备份匹配，123 项受保护内容保持一致。
- 仅发布 `/suite-dev/`；稳定插件、独立站、卡库、首页、三龙、服务和玩家数据保留。

浏览器测试中的房间宿主是合成夹具。真实枭熊多人房间、实体手机及玩家原设备尚未现场验收。

首次 CI 暴露了启动清理顺序、权限入口旧邻接检查和停止完成检查的竞态，已修正并在最终提交复验通过。原有工具选择浏览器出现一次拖放波动，相关代码与 264 相同，仅重跑失败任务后通过。失败记录保留。本机发布连接在服务端任务结束后未正常返回，已依据正式发布回执及独立全树核对确认成功，并关闭了该本机连接。

## 来源与恢复

| 仓库 | 正式包源码 | 已合并提交 |
| --- | --- | --- |
| FullPeople/dnd5e-automation-data | `d6bee639c5e80c88d414fd5cdceabe648609d16d` | `81814264312aa691f586b39ec5d9fd2c73c8cc95` |
| FullPeople/DND-card-web | `9875b94c36191ce40473f78f60cb5dcbbfe464fa` | `1839524e44718ead3a124d593b51882a8ee02a89` |
| FullPeople/obr-suite | `2d549011f9983a182e3f05d9745665f213c9e452` | `afdc4b7373f3a229854ca2eeebd14091646cea36` |

三个合并树与各自最终受测源码相同。发布完成时间（UTC）：`2026-10-09T17:37:13.681652+00:00`。发布后的记录提交只补文档，不改变或重新封装上述运行包。

精确包回执 SHA-256：`90348daec37b4e59e50f9d3dd215187e0aaa2c5ddbb86eb91648b64e5c6ca776`。服务端发布回执：`/root/codex-release-receipts/text-effects265-20261010.json`。

完整回滚副本：`/var/www/obr-plugins/suite-dev-before-text-effects265-20261010`。仅在目标全树和受保护内容仍与本轮回执一致时，运行以下命令恢复 264；若后续发布改变了这些内容，帮助程序会拒绝执行，须重新核对。

```sh
python3 /root/codex-release-packages/text-effects265-20261010/suite_links.py --archives /root/codex-release-packages/text-effects265-20261010 --receipt-sha 90348daec37b4e59e50f9d3dd215187e0aaa2c5ddbb86eb91648b64e5c6ca776 --rollback
```

## 最终 CI

- [data · automation-ir validation · 37963194238](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37963194238)
- [data · automation-ir validation · 37963070257](https://github.com/FullPeople/dnd5e-automation-data/actions/runs/37963070257)
- [web · Verify tool proficiency choices · 37963642829](https://github.com/FullPeople/DND-card-web/actions/runs/37963642829)
- [web · Verify shield training binding · 37963642879](https://github.com/FullPeople/DND-card-web/actions/runs/37963642879)
- [web · Verify responsive spell icon painting · 37963642853](https://github.com/FullPeople/DND-card-web/actions/runs/37963642853)
- [web · DND Center cloud migration · 37963642978](https://github.com/FullPeople/DND-card-web/actions/runs/37963642978)
- [web · Verify automation progress · 37963642731](https://github.com/FullPeople/DND-card-web/actions/runs/37963642731)
- [web · Verify web · 37963642718](https://github.com/FullPeople/DND-card-web/actions/runs/37963642718)
- [suite · Verify Suite candidate · 37965742685](https://github.com/FullPeople/obr-suite/actions/runs/37965742685)
