# v0.1.1 安装包修复记录

## 证据与结论

旧试装包由 `build-test-fpk.sh` 手工生成双层 tar，未运行官方 fnpack。脚本仅包含 `cmd/main`，没有官方模板的安装、升级、卸载和配置回调；`tar -C ... .` 还会产生 `./` 前缀路径，与官方 fnpack 输出的根层路径不同。两者是已确认的结构差异，尚无 NAS 安装日志证明哪项触发了系统报错。

仓库原 manifest 的 `platform=all`、`source=thirdparty`、`install_dep_apps=nodejs_v22`、包账户权限、统一网关入口和 `os_min_version=1.1.3100` 与官方 Native 示例一致。用户的 1.2.1010 高于最低要求，因此没有以盲目降低版本号的方式规避校验。项目不含架构专用二进制，因此保留 all；Node.js 由系统依赖提供。

旧官方构建脚本复用 `fnpack create` 目录，可能残留模板数据共享声明和示例文件。新流程每次在独立临时目录组装自己的完整内容，不依赖模板隐式补齐。

## 修复

- 将全部测试包统一交给官方 fnpack；移除手工 FPK 生成路径。
- 补齐 8 个无额外操作的生命周期回调，保持用户媒体不受安装/卸载脚本操作。
- 提交 64/256 PNG 包图标和入口图标；增加 LF 配置及 Linux 构建时 0755/0644 权限规范。
- 验证 staging 和最终 FPK 的结构、源码、manifest、图标、权限、JSON、入口、checksum；生成 SHA-256 和审计记录。
- 启动脚本等待实际 Socket 就绪；服务启动退出/超时会返回失败，写入系统临时日志。
- CI 使用官方 Linux fnpack 1.3.3（2026-11-19 发布的版本），固定下载哈希，运行包回归和真实包启停烟测。

## 限制

没有取得用户之前安装的 FPK 字节内容或设备安装日志，不能宣称已锁定唯一根因。当前提供的是显式 `--nosign` 本地试装包，不含开发者签名，不作为正式 Release；若系统要求签名，需使用开发者自己的证书。包结构检查和普通 Linux 服务测试不能证明 fnOS 安装、网关或 ACL 已通过。

官方文档核对日期：2026-11-20。

- https://developer.fnnas.com/docs/cli/fnpack
- https://developer.fnnas.com/docs/core-concepts/manifest
- https://developer.fnnas.com/docs/core-concepts/icon
- https://developer.fnnas.com/docs/core-concepts/app-structure
- https://developer.fnnas.com/docs/examples/native
- https://developer.fnnas.com/llms-full.txt
