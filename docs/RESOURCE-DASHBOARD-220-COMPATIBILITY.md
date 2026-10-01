# 2026-10-01 仪表盘兼容验证（本地，未发布）

本次从 219 热修复树单独接入仪表盘数据兼容；没有复制待发布 218 的历史记录或其他改动。

## 修改范围

- `resource-presentation.ts` 接受 16 款保留模块，继续读取旧 `bar` / `icon` 样式；网格保持 12 × 6，最小模块宽度从 3 改为 2。颜色仅接受六位十六进制；图标仅接受 spark / diamond / shield / flame / leaf / bottle。
- 已授权资源的宿主摘要投影保留颜色、图标和分组，分组成员仍按接收者可见 ID 过滤。外观修改不改变资源值；删除分组主资源时，剩余资源保留分组位置与外观。
- 武器区域使用独立 `resourceAttacks` 摘要。原生 `quickbarLayout.attacks` 优先于旧格式 `web_quickbar_attacks`；武器区域不能声明资源成员组，也不会创建假的资源。
- 公共仓库资源可以保存新的样式、颜色和图标。设置外观仍仅限 DM；玩家消费资源时保留已有外观。
- 没有修改原生 DM 资源面板布局；字符卡及总览 UI 由 Web 集成负责。

## 已验证

- `node tools/resource-dashboard-220-selftest.mjs`：15 项通过。覆盖 16 + 2 样式、几何与外观白名单、分组过滤和删除、原生/旧格式兼容、武器独立布局、错误时无修改、库存权限、CAS、JSON 持久化，以及修改布局时不覆盖另一端已消费的资源值。
- `node --experimental-strip-types tools/resource-presentation-217-selftest.mjs`：原有投影与写入回归通过。
- `node tools/resource-presentation-inventory-217-selftest.mjs`：原有库存样式/权限/CAS/重复请求回归通过。
- `node tools/workbench-177-transport-selftest.mjs`：12 项通过，包括真实本地 HTTP relay 的增量保存、旧版本冲突和凭证权限边界。
- `node node_modules/typescript/bin/tsc --noEmit`：完整 Suite 类型检查通过。

新增自测先前直接载入 TypeScript 时因 Node 22.17.1 未启用实验类型擦除而退出。现改用仓库已有 Rolldown 编译生产模块，标准 `node` 命令通过，不依赖实验标志。

最终新增用例记录：`workbench-test-output/resource220/results.json`。更早的测试材料保留在隔离目录同级 `suite-validation-evidence/`。真实枭熊房间、真实多人浏览器、Suite 生产构建与部署均不属于本子任务的已验证范围。
