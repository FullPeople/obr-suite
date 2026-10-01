# 自动群体结果被历史替换后的取消修复

修复源码：`3fc7c710019bd7ac705915d5b91e633aeeb4215f`，已保存到 `FullPeople/obr-suite` 的 `codex/suite-host-repair-20261001`，远端完整 SHA 已核对。之前 `259672c6e7f504c43deca6ee340f2bbf62a865d8` 的 P1 和快速双击修复保留；本次只改 Suite 标签显示状态及组合回归。后续报告提交不改变运行源码。

配对 Web 为只读检出的 `4da0b4cd6f37d1c2ad6181baeee2864d25df50ac`，运行代码为 `a6f5f29225d7c94ec61f05ee4b4970510ffd1c06`。使用 Web 原始 `tools/verifyPairedDice230.mjs`，没有修改 Web 源码、测试脚本或消息协议。未合 main、未部署、未操作真实房间或删除玩家历史。

## 用户操作与结果

| 操作 | 修复前 | 修复后 |
| --- | --- | --- |
| 已自动显示群体 14 → 点击另一条单人历史 16 → 再点同项取消 | 单人历史删除，但旧群体 14 重新出现，opacity=1 | 所有结果节点清除，旧群体保持隐藏 |
| 已显示两个自动组 → 进入历史 → 切换历史 → 取消 | 旧自动组可能重新显示 | 被替换的旧组保持隐藏，历史仍互斥 |
| 被替换旧组的迟到成员带着 `visible:true` 到达 | 可能让旧数字复活 | 该组此前的隐藏意图优先 |
| 取消历史后真正的新投掷 ID 到达 | 原有功能 | 新结果正常显示；浏览器实测数字 24 |
| 用户明确显示旧群体结果 | 原有功能 | 仍可显示与隐藏 |
| 查看原骰子历史 | 原有功能 | 原记录保留，本次只改变本机地图标签 |

根因是 `setTokenResults('history:'+cid)` 只隐藏同 cid 自动组，`refresh()` 在历史关闭后又渲染其他仍为 visible 的旧组。现在进入历史时，把当前所有自动组的显示状态与对应 visibility 意图设为 false，同时移除上一条历史显示；新投掷 ID 不继承旧组隐藏意图。不清理 `rolls`、localStorage 或房间数据，权限规则不变。

## 实际复现与复验

- Chromium `151.0.7922.173`，390×850 / 1280×850：原始 Web/Suite 配对脚本在 259 上 **13 通过 / 2 失败，退出 1**。两项失败都记录旧 `group-synthetic` 的 `{text:'14member',opacity:'1'}`，Web 正确发送 LOCAL / REMOTE 的 `open → close`。
- 同一脚本、相同两宽度、锁定 3fc 源码及重新构建的生产子应用：**15 通过 / 0 失败，退出 0**，取消后的 `remaining:[]`，pageerror 为零。Action 迟到 SDK 回执下的双击 `open/close` 仍通过。
- Suite 宿主/实际 Action 页/overlay 标签检查：360 / 1280 宽度 **59 通过 / 0 失败**。增加旧自动组已可见时的单人取消，以及随后新组显示 24；保留初始无场景和场景恢复检查。
- 生命周期 **18 项通过**。新增两个旧自动组替换、迟到成员、原历史保留、新 ID 显示、历史切换后取消与明确显示旧组组合。`ready=false` 初始停稳、未 ready 的结果、读取中场景卸载及 false→true 首个结果恢复均仍通过。将同一新回归加载 259 的 token-results 时预期失败，旧自动组残留 `2 !== 0`。
- 群体 29、历史权限 11、Controller 历史 5 项再次通过；TypeScript、新旧 Vite 构建通过。新宿主覆盖包重建宿主 / workbench-dice / dice3d，261 文件、1061 静态引用、59 资产锁通过；616 个运行源码 SHA-256 与当前源码逐项一致。

证据目录：[evidence/dice-replacement-20261001](evidence/dice-replacement-20261001)。其中 `paired-before.json` / `paired-after.json` 是未经删改行为断言的原始配对结果；两者记录源码 SHA，前者的失败是有意保留的对照。窄屏/宽屏取消前后截图均为原创合成数据，报告中的运行源码提交为 3fc，报告提交只增加说明与证据。

## 复跑

在干净、锁定完整 SHA 的 Suite checkout 中生成 dev 构建与 `tools/build-release217.mjs` 覆盖包，明确 `DND_CARD_WEB_ROOT` 为上述 Web 源码。然后从 Web 只读检出运行：

```sh
PLAYWRIGHT_EXECUTABLE_PATH=/usr/bin/chromium node tools/verifyPairedDice230.mjs \
  --suite /path/to/suite \
  --sha 3fc7c710019bd7ac705915d5b91e633aeeb4215f \
  --dice-build /path/to/rebuilt-host-overlay \
  --dev-build /path/to/dev-build \
  --out /path/outside-suite
```

本机对应原始日志在忽略目录 `.local-evidence/paired-suite-before.log`、`paired-suite-after.log`，重建包在 `.local-evidence/host-overlay-replacement`，dev 构建在 `.local-evidence/dist-replacement`。Suite 组合回归用 `node tools/workbench-dice-lifecycle-217.mjs` 和 `tools/suite-host-repair-browser.mjs`；旧代码对照通过 `DND_TOKEN_RESULTS_BASELINE` 指定只读导出文件，未改产品校验。

## 验证边界与风险

配对运行实际 Web `DiceFrame`、Suite `diceRpc` / history / observation / token-results / overlay 及实际安装 SDK；房间底层 postMessage、物理 Controller/renderer 等由合成夹具提供。它验证真实组件协议与标签 DOM，不能证明真实 Owlbear 登录房间、多人权限或本批物理投掷。新投掷显示和旧组迟到组合另由 Suite 生命周期与实际 DOM 检查验证，不冒充 Web 配对脚本新增的断言。

进入历史会替换本机所有既有自动标签，这是用户要求的取消语义；需要显示被替换的组时仍可明确点击“显示”。新投掷由生产 UUID 创建独立组，不继承旧组隐藏状态。真实房主/玩家双端、实体手机和生产网络仍待真人复验。此环境只有 Chromium 可用，Firefox/WebKit 本次配对未运行。

Suite manifest 仍保留源基线 227、配套 Web 公告为 230，正式发布时需统一版本。没有运行部署脚本；本分支没有 GitHub Actions workflow，外部 hooks 未能独立核实，保存使用 `[skip ci]`。回滚本次改动可撤销 3fc 源码提交，生产当前没有变化。
