# 传送门图片库选择与默认恢复

日期：2026-09-08。规范目录 `U:\枭熊插件\obr-suite`。本范围完成可运行实现与独立浏览器验证，未提交、推送或部署。

## 平台核验与方案

官方 Assets API 的 `downloadImages(multiple, defaultSearch, typeHint)` 会打开当前用户的原生图片选择器，并返回 `ImageDownload[]`；`ImageDownload.image` 是可用于图片 Item 的 `ImageContent`。这正好满足用户要求，无须制作宿主图片库的替代列表。[官方 Assets 文档](https://docs.owlbear.rodeo/extensions/apis/assets/#downloadimages)

本地安装 SDK 3.1.0 的 `lib/api/AssetsApi.d.ts` 有该方法；`AssetsApi.js` 与官方源码均通过 `OBR_ASSETS_DOWNLOAD_IMAGES` 宿主消息返回用户选中的图片。本实现从点击路径直接调用 `OBR.assets.downloadImages(false)`，只选一张，不限制素材分类。调用取消返回空数组时不写入。[官方 SDK 源码](https://github.com/owlbear-rodeo/sdk/blob/main/src/api/AssetsApi.ts)

## 最终界面和持久行为

编辑传送门时增加小预览、**从图片库选择**、**恢复默认**。图片立即保存；提示与按钮有中英双语。初次角色/图片读取失败可在同页重新加载，避免禁用按钮却无法重试。沿用当前编辑 popover，不创建额外插件、外部图片服务、设置键或自制库面板。无需新增 manifest 权限或公共接线。

主代理根据官方 ImageContent 文档补充支持图库返回的 MP4/WebM 动画图片；编辑器只读取视频预览的元信息，不自动播放，关闭时停止并卸载预览来源。实际场景中的动画由 Owlbear 原生 Image 渲染，不另开动画循环。[官方 ImageContent](https://docs.owlbear.rodeo/extensions/reference/items/image/#imagecontent)

选择只写原生 Item 的 `image`、`grid`、`scale`。图片以自己的比例居中适配原传送门显示范围的最长边；不复制素材的名字、文字、旋转、显示/锁定、其他 metadata。原单位的位置、转送 tag、触发 radius、转场 effect、显示/锁定状态都保留。长方形图案不会被拉成正方形，触发区域仍是原来的圆形。恢复默认同样只替换图片和必要的显示几何，不创建新单位。

设置保存在场景 Item 中，重新打开编辑器读取现有图片，无需每次开场重设。本次还修正了旧迁移：原实现把所有非默认 URL/尺寸均当成旧图标，因此会抹掉自选图片；现在只迁移已知套件来源、已知默认图标路径，并在实际写入回调中再次核对，自选素材不被覆盖。

使用原生 SDK `updateItems` 的 Immer 回调处理图片更换，只产生图片/网格/缩放字段补丁。没有把整份旧 Item 或 metadata 写回。图片选择与写入期间的角色变化、场景卸载、关闭编辑器、删除或取消传送门标记会使旧请求失效。写入失败保留已有图片并显示重试提示。

## 文件范围

- 新增 `src/modules/portals/appearance.ts`：图片验证、尺寸适配及仅默认图标迁移。
- 新增 `src/modules/portals/appearance-control.ts`：原生库入口、预览、恢复默认与生命周期。
- 修改 `src/modules/portals/edit-page.ts`：挂载控件、语言更新、编辑器关闭/取消时撤销未完成选择。
- 修改 `src/modules/portals/index.ts`：迁移调用改为仅默认图标，其他传送/链接/转场逻辑未改。
- 修改 `portal-edit.html`：紧凑图片操作样式，正文允许纵向滚动，底部操作区保持可见。
- 新增 `tools/fixtures/portal-appearance-sdk.ts`、`tools/portal-appearance-selftest.mjs` 和本记录。

## 验证和实际边界

`node tools/portal-appearance-selftest.mjs --mutants`：初次交付 25 项；根复核补充初始读取失败重试与原生视频素材接收/预览不自动播放，实际编辑页、图片控件和原生 Immer 回调在 Edge 152.0.4191.66 中 **27 项断言通过**。3 个定点变异均被运行时断言捕获：重新放宽迁移覆盖自选图片、错误放大显示尺寸、删除迟到写入守卫。变异只存在于临时构建，不改产品文件。

断言覆盖原生选择调用参数、取消不写、持久图片重开、默认恢复、图片比例和最长边、Item 其余字段完全保留、实际 Immer patches 只涉及 image/grid/scale、默认/自选迁移区分、非法图片内容拒绝、降权/场景/关闭/删除后迟到选择、实际延迟 update 回调、写入失败后重试、早到角色事件、中英界面和监听清理。380×540 以及 320×540 面板无横向溢出，保存/取消按钮仍在可视范围。

测试工件：`C:\Users\admin\AppData\Local\Temp\portal-appearance-qWkDnZ`，包含构建、`portal-editor.png` 及变异日志；已实际查看 DOM 截图。测试图案为测试工具内自写 SVG。

`tsc --noEmit` 与本范围 `git diff --check` 通过。

原生库的实际宿主窗口、资产可用性及真实玩家客户端接收仍需要 Owlbear 房间验收。测试使用真实浏览器、实际产品编辑页和 Immer，但 SDK 宿主端点与图片库返回值为可控模拟，不能称为真人多人或原生库 UI 验收。图片素材保持原生资产 URL，能否持续加载遵守 Owlbear 对相应资产的可用性；本实现不另行复制或托管素材。
