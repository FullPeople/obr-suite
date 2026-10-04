# 已销毁骰子控制器的异步取消边界

真实浏览器首次资源专验 `37231465271` 在第二次模块重启捕获 `BroadcastChannel: Channel is closed`。此前21轮投掷、上下文暂停/恢复、最新20条回放归档和65秒空闲窗口已通过，仍不能把重启错误忽略为日志噪声。

## 原因与修复

原 dispose 只撤销未来定时器并关闭通道/Worker，已进入 await 的 tick、网络/渲染消息、密钥和物理结果续链仍可能恢复。失败分支再次 fail→log 向关闭的通道写；成功分支还可能发布旧结果、操作已终止Worker或继续旧发送。

本修复把 disposed 作为该实例的生命周期边界：

- 本地发布和 Worker 投递统一经过存活保护。
- 网络发送入口、实际 dispatch/stamp 前、ACK 返回后都检查存活。
- 消息入口及密钥、角色、加解密/编码、轨迹验证之后取消旧续链。
- 迟到开播回调、retirement、secret-grant后续和压力定时器续链均不能越过销毁。
- 只对已销毁实例停止错误报告；存活实例的真实异常仍以原原因发布，不按错误文字宽泛吞错。
- dispose 幂等；没有更改可见性暂停/恢复、权威结果、私投权限或正常运行的发送速率。

## 复现与边界

`node tools/dice-controller-dispose-selftest.mjs` 使用真实 Controller 构造器和生产方法，可控 transport/worker/channel 边界及实际 gzip。

12种等待路径 × resolve/reject × disposed/live，共48项。修复版48通过；同一测试注入 `f735e608288ad12451b046645cffc3d9a4f394ef` 为24通过/24失败。所有24个live正负控保持正确行为；disposed两种结束均无旧channel/worker/network写，无外层二次未处理拒绝。每个测试独立重置模拟计时器，避免一个预期泄漏污染下个正控。

此前40项独立审阅也全部通过，之后增加hello等待和压力模式的8项。全组合回归增加此组后为44组。最终验收仍要求重新跑真实浏览器重启；Node绿不能替代该验收。

## 首轮浏览器测量留痕

三种同runner ABA、严格纹理像素/视口任务通过；capture失败是未设hidden的群体请求被夹具误当私投，改为明确公开A/hidden B；lifecycle失败为上述产品问题。首轮所有结果保留。

第一轮ABA没有观测上一投物理退休，且软件GL结果混合，不能宣称9枚净提速。后续独立计时case在计时前等待两端真实Controller和Worker空场，保留内部并发测试及严格权威结果一致断言；GPU读回证据轮继续与无捕获计时轮分离。
