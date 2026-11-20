# 测试及验收

v0.1.1 的 Linux CI 会运行以下检查。请以对应提交的 GitHub Actions 实际结论为准。

- 原有 8 项 Node.js 测试：分类、日历日期、JPEG EXIF、QuickTime 时间、RAF/JPG 导入与持久索引、同名冲突、未稳定文件延迟、内部目标目录限制。
- JavaScript 语法检查。
- 下载官方 fnpack 1.3.3，验证固定 SHA-256，执行真实 `fnpack build --nosign`。
- 构建前后校验：manifest/版本/依赖、JSON、9 个生命周期脚本、0755 执行权限、LF shebang、外层规范路径、内层源码完整性、app.tgz MD5、两种尺寸 PNG 和桌面入口。
- 5 项包回归测试：真实包通过；缺安装脚本、执行权限损坏、checksum 错误、旧式 `./` 外层路径均被拦截。
- 从真实 FPK 解出服务的 Linux 启停测试：初始状态 3、启动、重复启动不产生新 PID、管理员请求 200、未认证请求 403、页面、停止清理、模拟崩溃时启动返回 1 并输出错误。

本次 Windows Node.js 24 环境原有业务测试结果为 5 通过、3 失败：两项涉及 Windows 上只读句柄 fsync 的 EPERM，一项使用了 Linux 路径语义。这些不作为 fnOS Linux 运行结果；以 Linux Node.js 22 CI 为验收环境，未修改业务逻辑掩盖平台差异。

仍需实机验证：应用中心安装、未签名测试包策略、Node.js v22 依赖、专用应用账户的目录 ACL、统一网关、USB 挂载发现、真实元数据日期、断电/拔卡/空间不足、相册索引。用户报告系统为 1.2.1010，未连接该设备，不能宣称已验证兼容。

修复背景和边界见 [PACKAGING.md](PACKAGING.md)，安装步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。
