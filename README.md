# Full Suite 开发版

角色卡与 Wiki、总览、资源与公共仓库、投骰、音乐及三龙牌的枭熊集成版。当前发布 **1.0.191-dev**。稳定版仓库与部署保持独立。

- [安装开发版](https://obr.dnd.center/suite-dev/manifest-dev.json)
- [角色卡与单机版源码](https://github.com/FullPeople/DND-card-web)
- [单机角色卡与 Wiki](https://fullpeople.github.io/DND-card-web/)
- [最终发布记录](docs/WORKBENCH_RELEASE_191.md)
- [连续修改资源的183修复与验证边界](docs/WORKBENCH_RESOURCE_183.md)

## 构建

使用兼容 Node.js 22 的环境。在本项目和 DND-card-web 分别运行 `npm ci`，将 `DND_CARD_WEB_ROOT` 设为网页源码绝对路径，再运行 `npm run build:workbench-dev`。产物为 `dist-workbench-dev`。房间权限与数据持久化仍由 Suite 和服务端校验，前端缓存不能绕过冲突保护。

## 验证

183：10项真实 SDK / 双 iframe 受控测试、13项运行状态回归、32项通知回归通过。网页源项目另有117项核心测试、36项维护中的浏览器发布验收和单机离线测试。真实多人房间网络延迟仍需实测。

## 许可

本仓库既有 Suite 源码保持 [GPL-3.0](LICENSE)。分离的 DND-card-web 使用其仓库内的项目专用非商用共享源码许可，不能将两者的许可混为一谈。依赖与资源保留各自许可。
