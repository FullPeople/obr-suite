# 217 发布准备（未部署）

本文件只描述可审阅工具和发布边界，不是线上成功回执。候选版本为 Web 公告 0.1.19 / standalone-1.0.217、Suite 1.0.217-dev。基线为已发布216：Web `4e1d74356d1db927a2e6054fe7536287c6ff2484`、Suite `6ff0b11c42c96bdc64427510b6e8f1862ce30e27`。最终217提交由发布者填写，不猜测SHA，不合并远端旧stable main。

## 构建及源码边界

- `tools/build-release217.mjs` 从当前源码构建宿主、物理worker、workbench-dice和整个dice3d（suite-3d-3、R8纹理）。拒绝覆盖已有输出，保存构建前后完整输入散列、产物散列与静态引用检查。**不复用216骰子目录。**
- 当前曾验证的 `release217-build-r3/suite-host` 是阶段产物。资源接线或群体边界改动后必须构建新的目录，并将新路径传给打包器；不得将r3当最终217。
- `tools/package217.py` 要求Web及Suite两个完整审阅SHA、两个干净工作树、构建输入与源码散列一致、构建输出与回执一致、锁定版本及无多人模块的独立构建。生成包之前不创建输出目录。
- Web最终构建前使用 `--snapshot-web` 保存src/public/tools和真实构建配置的散列；生成的tsbuildinfo不作为源码。最终两种Web构建完成后传入此快照。它证明输入没有变化，不替代此前产品测试或构建命令记录。
- 两个源码ZIP由明确提交的git archive生成，要求ZIP注释匹配提交、CRC通过、文件集合与完整Git树相等、含LICENSE、无私有资料/本地证据/环境文件。打包完成再次核对源码树及构建输入未变。

以下仅为待执行命令；尖括号参数由发布者替换。输出/证据使用真实F盘，不能用指向U盘的visualizations junction。

```powershell
python U:/code/DND-card-suite-release210/tools/package217.py --snapshot-web F:/DND-card-217-evidence-20261001/web-build-source-final.json
# 接着运行最终 integrated / standalone 构建；保存实际构建日志。
$env:DND_SUITE_DEPS_ROOT='F:/CodexWork/2026-09-27/feedback/suite'
$env:DND_SUITE_RELEASE_OUT='F:/DND-card-217-evidence-20261001/<fresh-build>/suite-host'
$env:TEMP='F:/DND-card-217-evidence-20261001/tmp/dice'
$env:TMP=$env:TEMP
& 'C:/Program Files/nodejs/node.exe' U:/code/DND-card-suite-release210/tools/build-release217.mjs
python U:/code/DND-card-suite-release210/tools/package217.py --web-commit <40位Web提交> --suite-commit <40位Suite提交> --web-source-snapshot F:/DND-card-217-evidence-20261001/web-build-source-final.json --standalone F:/DND-card-217-evidence-20261001/<final-standalone> --integrated F:/DND-card-217-evidence-20261001/<final-integrated> --suite-host F:/DND-card-217-evidence-20261001/<fresh-build>/suite-host --out F:/DND-card-217-evidence-20261001/<fresh-ready>
```

输出包括card-217.tar.gz、suite-dev-217.tar.gz、两个完整源码ZIP、独立下载ZIP、逐文件SHA256和package-receipt.json。大小和数量从实际产物计算，不沿用216的238文件/80骰子文件常量。

## 服务器切换边界

`tools/deploy-release217.py` 默认只读预检；部署脚本与包/回执置于同一全新暂存目录，显式 `--apply` 才创建stage并切换。本批准备没有执行以下服务器命令，也没有上传文件。

```sh
python3 /path/to/reviewed-stage/deploy-release217.py
# 仅在发布获得授权、审阅并完成其他门禁后：
python3 /path/to/reviewed-stage/deploy-release217.py --apply
```

预检检查线上216版本、216文件清单、已知Web源码SHA与Suite源码ZIP提交、217包完整SHA、每个tar成员内容SHA/总长度、源包所有副本一致、宿主依赖的保留静态资产。拒绝绝对路径、父目录逃逸、重复项、链接和特殊文件。不会请求或修改玩家数据。

两个目标均先复制到站点根目录中的全新stage。只在隔离stage中完整替换`dice3d`和`workbench-dice`，验证新目录准确等于217清单，旧骰子chunk不会残留。宿主assets/HTML与workbench按清单更新，其余历史资产保留。card-viewer只更新Suite源码ZIP，其他独立应用内容不改。独立suite、dice-lab-dev、three-dragon-ante-dev全树散列，relay/三龙牌后端程序、Nginx及服务启动时间均须保持。

切换前再次验证两个线上目录未被其他发布修改。恢复点固定为`/var/www/obr-plugins/card-before-217`和`/var/www/obr-plugins/suite-dev-before-217`，存在即拒绝覆盖。两次目录改名不是跨目录原子事务；任一切换或后验失败会逆序恢复旧目录，失败候选保留为`*-failed-217`供审查。成功回执原子落盘。脚本不重启服务、不改relay代码、不改数据。

离线合成回归：`python tools/release217-selftest.py`，20项通过，覆盖路径/链接/重复成员拒绝、完整新骰子替换、独立子应用保留、失败回退、Web源码变更与缓存排除。此结果不代表线上发布或真实Owlbear验收通过。

## 跨宿主骰子最高层级：仍未解决

2026-10-01真实宿主祖先样式证据显示：可穿透的骰子iframe外层1299，先攻/历史等宿主层1300；没有transform、isolation或浏览器原生top-layer导致的另一条解释。独立站的top-layer修复不能改变跨源父宿主层级。

已重新核对当时实际宿主加载的公开[room-DgTw80K-.js](https://www.owlbear.rodeo/assets/room-DgTw80K-.js)，SHA256为`38d1b2d7e740a7b22cbcdd3ebc56558f3f5b4110774e129e5438697e85c75c2a`。其分支使用 `height===0 || width===0 || disablePointerEvents` 决定穿透；穿透分支明确指定1299。fullScreen和hideBackdrop独立于此判断，换成非全屏加明确尺寸不能保留穿透又提升层级。

当前[官方Modal API](https://docs.owlbear.rodeo/extensions/apis/modal/)与安装SDK的Modal类型都没有公开zIndex或可穿透最高层参数。取消disablePointerEvents只会回到普通modal层并恢复焦点/输入拦截；全屏会挡住地图，且与其他1300层同级，不能宣称高于全部宿主UI。Popover的全屏矩形同样拦截地图。iframe内调高z-index无法越过父iframe的1299层。

可行的后续方向是宿主新增可穿透的演出层/API，或改用有边界的交互骰盘并明确接受其不能盖住所有宿主UI。尚未找到同时满足“盖住所有宿主界面”和“地图持续可操作”的公开API组合；未修改跨源宿主DOM，未以透明全屏遮罩冒充完成。私有祖先样式/最小分支证据保持在本机，不将房间信息写入仓库。
