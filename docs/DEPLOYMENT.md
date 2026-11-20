# 飞牛 fnOS 部署说明

当前为 **v0.1.1 试装版**。使用官方 fnpack 1.3.3 在 Linux 构建并检查 FPK；未完成 fnOS 实机验收。

## 安装试装包

1. 从仓库 Actions 中最近一次成功的 Tests 运行下载 `fn-dit-0.1.1-unsigned-test` 构建产物，解压 ZIP，选择其中的 `.fpk`。不要上传 ZIP 或 APK。
2. 需要 fnOS **1.1.3100 或以上**，以及应用中心的 **Node.js v22**。用户报告的 1.2.1010 满足声明的系统版本要求，但尚未实测。
3. 应用中心 → 手动安装 → 上传 FPK。此包使用官方 `--nosign`，仅供本地调试，未签名，不是正式 Release。如果设备策略拒绝未签名包，需要飞牛开发者证书构建；不要关闭系统安全检查来绕过。
4. 在应用设置中为 `fn_dit` 应用账户授权：外接卡来源只读，NAS 内部目标目录读写。软件不会自动申请 root 或向所有目录授予权限。
5. 管理员打开应用，填写实际内部路径，例如 `/vol1/1000/Photos`。手动来源填写设备实际外接挂载目录；应用不会自行挂载 USB。
6. 自动导入默认关闭。先用少量测试卡文件手动扫描，核对内容、日期、同名冲突、重复导入和拔插后重扫，再决定开启自动导入。

## Linux 源码构建

需要 Node.js 22+、Python 3.12+、bash、官方 fnpack 1.3.3。图标 PNG 已提交，无需构建时下载 Python 图片依赖。

```bash
# 官方工具下载地址与本次核验 SHA-256 见 .github/workflows/tests.yml
export FNPACK=/absolute/path/to/fnpack
bash scripts/build-test-fpk.sh
# 产物：dist/fn-dit-0.1.1-unsigned-test.fpk、.sha256、.audit.json
python3 tests/fpk_test.py dist/fn-dit-0.1.1-unsigned-test.fpk
python3 tests/lifecycle-smoke.py dist/fn-dit-0.1.1-unsigned-test.fpk
```

正式签名构建：在构建主机按官方 `fnpack cert import --help` 导入自己的开发者证书，然后执行 `bash scripts/build-fpk.sh`。不要把私钥、证书或密码提交到仓库。本项目不会生成或伪造开发者身份。

构建必须使用 Linux。Windows fnpack 1.3.3 在本次环境构建时报文件同步 Access is denied；1.2.3 虽能输出 FPK，但脚本模式为 0666，不能作为本项目安装产物交付。不要重新压缩已生成的 FPK。

## 安装仍失败时

“应用包不符合系统要求”是通用错误，仅凭截图无法断定系统内的具体校验分支。当前修复移除了手工打包流程，并校验官方包的结构、权限、图标、配置与 app.tgz MD5；这不能替代应用中心实际安装。

若新包仍被拒绝，记录完整 fnOS 版本、所选 FPK 文件名、文件 SHA-256 和应用中心/安装日志，重点检查未签名包策略及 Node.js 依赖。设备有 SSH 且管理员自愿使用命令行时，可参考官方 `appcenter-cli install-fpk <完整FPK路径>`；本任务未连接 NAS 或执行安装。

启动失败时查看应用数据目录中的 `service.log`。启动脚本会在服务退出或 Socket 未就绪时返回失败，并通过系统临时日志给出错误。

## 运行限制

- 统一网关、外接卡挂载结构与 ACL 授权必须在真机核验。
- 服务以专用包账户运行，默认不暴露 TCP 管理端口，仅允许 NAS 管理员使用。
- 原卡不删除、不格式化；目标同名不同内容不覆盖。索引和日志存储于 `TRIM_PKGVAR`。
- 拍摄日期解析不到时回退 mtime；部分 RAW/HEIC/视频格式需要 ExifTool，并应抽样核对。
- 不提供“亮灯画面”识别功能，不替代独立备份。

依据：[官方 fnpack](https://developer.fnnas.com/docs/cli/fnpack)、[Native 案例](https://developer.fnnas.com/docs/examples/native)、[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest)、[应用权限](https://developer.fnnas.com/docs/core-concepts/privilege)。
