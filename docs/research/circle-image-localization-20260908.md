# 图片处理页双语补齐及资源编辑页复核

## 范围与实际发现

- 资源编辑页本来已具备所查固定文案的中英支持：`resourceTracker/edit-page.ts:35–41` 应用现有词条；`:175,276` 使用本机语言的新建默认名；`:230` 使用双语图标说明；`:379–391` 原位更新标签并注销语言订阅。全局 `i18n.ts:501–539` 已有按钮、类型、占位、预设、删除确认和校验文案，`resourceTracker/icons.ts:253–262` 已有全部 25 个英文图标名。资源名及已存预设名原样显示。本批没有修改资源模块，也没有重复搭建验证；既有 `tools/resource-ui-selftest.mjs` 已包含真实编辑页姓名/数值草稿和焦点检查，本批未重新计入验收数量。
- `circleImage/popover-page.ts` 原来没有语言读取/订阅，文件验证、加载、初始化、生成/上传失败、上传三态及自动图片名全部固定中文；`circleimage.html` 的页标题、两种模式和控件也只有中文。对 HEAD 原页的实际 Edge iframe 复现确认：即使本机语言为 English，标题仍是「图片处理」，选入非图片文件仍弹中文。
- `transform-page.ts:18–26` 已有初始英语，但只读取一次语言；本批按明确缺口优先处理图片页，没有修改变身页。

## 改动

1. 新增仅供图片处理页使用的 `circleImage/text.ts`，不改全局 i18n/state/settings。`popover-page.ts:31–35,670–687` 读取和订阅本机语言，只修改固定标签、属性和当前上传状态文字，不重建控件、不调用图像读取/重置/上传。
2. 图片选择、10 MB 限制、读取/解码失败、OBR 未准备好、PNG 生成失败、上传失败及上传按钮三态均按当前语言显示。错误包装翻译，宿主返回的 detail 保持原值。图像算法、参数、上传字段/PROP 类型、关闭 ID 均沿用。
3. 新生成图片的默认名在英语下为 `Circle image-时间戳` 或 `Background removed-时间戳`，中文沿用。仅影响本次新产物，不重命名旧资源或翻译作者图片内容。
4. HTML 为固定文案加模块专用标识，为关闭及参数控件补双语可访问名称。放宽参数标签空间、允许滑条缩短，并去掉底部多余伸缩占位。上传按钮固定 40 px 高，容纳窄窗口的两行成功说明，防止语言/状态文字改变画布可用高度。

## 验证

- `node tools/circle-image-locale-selftest.mjs --baseline`：2 项确认旧页缺口。读取固定基线 44a53a4 页面和源码（需要仓库 Git 历史），不回写或覆盖工作树。工件：`C:\Users\admin\AppData\Local\Temp\circle-image-locale-MHvYaL`。
- `node tools/circle-image-locale-selftest.mjs`：29 项通过。工件：`C:\Users\admin\AppData\Local\Temp\circle-image-locale-sBoaj4`，含 `result.json`、420 px 裁剪中英图、320 px 去底及成功提示中英图。
- 使用实际页面、原生 Edge iframe、FileReader、Image、Canvas、PNG Blob 与已安装 SDK 的 AssetsApi/PopoverApi；仅替换语言事件与 OBR 宿主消息边界。测试图形为专用本机 SVG。
- 验证包含：英语固定界面无中文；类型/大小/解码失败；拖动裁剪和调整参数后切中英，Canvas 像素、参数和焦点完全相同；去底模式/颜色/容差/羽化保留；上传进行中切语言不恢复可点状态且不重复发送；真实 PNG 输出尺寸、透明角、原比例及默认命名；宿主中文错误详情不被翻译；失败仍可重试；未准备好/PNG 生成失败；关闭目标及 pagehide 注销。320 px 额外检查控件文字不覆盖相邻控件，成功文案切换不改变画布像素。
- 已由代理查看中英 320/420 px 截图；主代理另查看 320 px 英文去底和 420 px 中文裁剪图；初次视觉检查发现英文 Background 侵占按钮，已修正并加入相邻文字边界断言。`tsc --noEmit` 通过；限定文件 `git diff --check` 通过（仅现有 CRLF 配置提示）。

## 明确未覆盖

- 这是浏览器与 SDK 边界验证，没有向真实 Owlbear 房间上传文件，不能代表宿主资源库确认弹窗、账户容量、多人房间或真人验收完成。原生 FileReader 的 OS 读取失败提示已静态核对，未伪造为实际磁盘故障验收。
- `circleImage/index.ts:65` 原生工具标题仍固定中文；本批只改页面，不顺带重做工具注册生命周期。
- 资源工具 `resourceTracker/index.ts:206–213,231` 在语言变化时仍先 `tool.remove` 再 `tool.create`。这是后续独立生命周期待办，本批不修改，也未声称宿主工具焦点影响已实测。
- 变身页运行中语言切换、其它页面、作者文字及全部模板正文不在此批完成范围。

## 冻结文件

- `src/modules/circleImage/popover-page.ts`
- `src/modules/circleImage/text.ts`
- `circleimage.html`
- `tools/circle-image-locale-selftest.mjs`
- `tools/fixtures/circle-image-locale-sdk.ts`
- 本记录

未提交、推送或部署。资源编辑页和根代理拥有的角色卡页面、共享设置/词典均未修改。
