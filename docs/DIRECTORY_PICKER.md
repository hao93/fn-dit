# 归档目标目录选择

v0.1.2 将目标目录输入框替换为「选择文件夹」按钮。

## 用户操作

管理员打开应用 → 点击「选择文件夹」→ 在飞牛原生目录弹窗中逐层点选文件夹 → 确认选择与授权 → 点击「保存配置」。修改已有目标时点击「更换文件夹」。无需复制或填写目标路径。

应用先检查所选目录是否位于 NAS 内部存储、是否存在和可写，通过后才替换界面中的待保存目标。取消、关闭或授权失败均保留原配置。文件夹显示名称及只读位置，升级保留之前保存的目标。

飞牛客户端内调用官方 `TrimApp.pickSharedFile`。独立浏览器访问则通过官方 `buildAppAuthUrl('pickSharedFile', ...)` 在弹窗打开 `/app-auth/pick-shared-file`，使用同源回调接收结果。弹窗被浏览器拦截时会提示允许弹窗，不会回退为输入路径。新窗口失去 opener 时，可通过同源存储恢复，或点击「刷新选择结果」。回调验证来源窗口、同源、随机 state、方法、应用标识及十分钟有效期，并仅使用一次。

## 集成配置

- `manifest`: `micro_app=true`，最低 fnOS `1.2.0401`；用户的 `1.2.1010` 满足声明要求。
- 飞牛移动 App 客户端至少 `1.34.0`。
- `config/resource`: 仅声明 `trim.file.sharedAccess`，不扩大为 root，不默认枚举 NAS 全盘。
- 官方 SDK `@trimjs/web-app@0.6.0` 随应用本地分发，校验固定哈希，不在运行时从 CDN 获取。
- 后台 `/api/destination/check` 仅允许管理员，要求请求标识，复用原有内部路径/真实路径/读写校验。保存配置时会再校验一次。
- 不改变手动来源目录输入；该项用于 USB 自动识别失败时指定额外来源，本次只替换归档目标选择。

## 参考

- [飞牛官方调用方式](https://developer.fnnas.com/api/calling)
- [飞牛官方共享目录选择与授权](https://developer.fnnas.com/api/authorization/shared-access)
- [RAWArchiver 项目](https://github.com/st1341815/RAWArchiver)：其版本说明也采用统一网关微应用与 `pickSharedFile` 系统内弹窗。本项目使用官方 SDK 自行实现集成。

当前完成本地界面检查、模拟选择流程测试及 Linux CI 包构建/服务测试；真实 NAS 的目录层级显示、授权弹窗与目录写入仍需实机验收。
