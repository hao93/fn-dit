# 飞牛 DIT (fn-dit)

**fnOS 原生照片 / 视频自动归档应用（测试版 v0.1.2）**

本项目用于家庭摄影爱好者：在飞牛 NAS 上定期识别已挂载的 USB 读卡器和 U 盘，将照片、视频按拍摄时间分类导入指定目录，通过 SHA-256 内容哈希去重和复制后校验确保文件完整。

> ⚠️ **测试版：改用官方 fnpack 1.3.3 在 Linux 构建与审计；仍未在真实 fnOS NAS 上完成安装、USB 权限和网关测试。试装包未签名，仅供本地调试，不是正式 Release。** 请仅使用少量测试照片试装。系统不会删除、格式化存储卡；自动导入默认关闭。

## 功能状态

| 功能 | v0.1.2 |
| --- | --- |
| 定时发现已挂载 USB / SD 存储及 DCIM 目录 | 已实现，待 fnOS 实机验证 |
| 原生弹窗选择目标目录与额外来源路径 | 已实现，需授予应用读取/写入权限 |
| 支持 JPG/JPEG、RAF、HEIC、DNG、PNG、TIF、MOV、MP4、M4V、AVI | 已实现，元数据解析覆盖范围依赖格式和 ExifTool |
| 按拍摄日期归档 | 已实现 |
| SHA-256 文件内容去重 | 已实现 |
| 临时拷贝、复制后 SHA-256 校验、冲突保护 | 已实现 |
| 保存索引、日志与失败后再次扫描 | 已实现 |
| 管理网页：开关、路径、扫描、状态、日志 | 已实现 |
| 飞牛实体设备 USB 识别、权限和网关验证 | 未完成 |
| 相似照片识别/亮灯画面筛选 | **未实现** |

## 目录格式

```text
Photos/
└── 2026/
    └── 2026-11-20/
        ├── RAW/DSCF1234.RAF
        ├── JPG/DSCF1234.JPG
        └── VIDEO/DSCF1235.MOV
```

不会将 RAF 与同名 JPG 判定为同一个文件；目标同名但内容不同的素材不会被覆盖。

## 安装和部署

详见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

1. 在 Linux 开发环境准备 Node.js 22+、Python 3.12+ 及官方 `fnpack` 1.3.3，或直接下载成功的 GitHub Actions 构建产物。
2. 执行 `npm test`，通过后运行 `bash scripts/build-test-fpk.sh` 使用官方 fnpack 构建。
3. 在飞牛应用中心手动安装生成的 FPK，确认 `Node.js v22` 依赖与权限。
4. 在应用中点击「选择文件夹」，逐层点选 NAS 内部目录并确认授权。
5. 选好归档文件夹后点击「保存配置」，先**手动扫描测试**。
6. 校验导入结果后，再开启自动导入。

> 随项目提供的试装 FPK 是实验性包体，仅用于少量测试数据；不建议当成正式发行版使用。

## 开发与测试

```bash
npm test
DIT_DEV=1 DIT_DATA_DIR=/tmp/fn-dit-test node app/server.js
```

管理页面（本机开发模式）：http://127.0.0.1:17681/app/fn-dit/ 。

2026-11-20：Node.js v22.16.0 环境运行 `npm test`，8 项测试通过；GitHub Actions 也会在每次推送时进行测试。**单元/集成测试不等于 fnOS 安装验收。**

## 构建产物

[GitHub Actions](https://github.com/hao93/fn-dit/actions) 的成功运行提供 `fn-dit-0.1.2-unsigned-test` ZIP，其中包含 FPK、SHA-256 和审计报告。图标 PNG 已提交；无需构建时安装图片依赖。安装包不是 APK，下载后先解压 ZIP。

系统要求：fnOS 1.2.0401+、Node.js v22。用户的 1.2.1010 满足声明的最低要求，但尚未实机验收。详见 [打包修复记录](docs/PACKAGING.md)。

## 设计与限制

- 不修改系统级 USB 规则、不自行挂载磁盘；fnOS 必须先识别并挂载设备。
- 常驻 Node.js 后台服务以轮询识别存储卡，不是硬件插入事件直接通知。
- 文件时间优先读取照片 EXIF 与视频媒体元数据，无法解析时回退 mtime；部分 RAW/HEIC/视频场景推荐安装 ExifTool 并抽样核对日期。
- 索引是增量导入依据；NAS 上的数据仍需独立备份。
- 原卡只读，不自动清空、删除或格式化。
- 目前不具备基于图像画面内容判断“亮灯照片”的功能。

[项目架构](docs/ARCHITECTURE.md) · [部署文档](docs/DEPLOYMENT.md) · [测试指南](docs/TESTING.md)
