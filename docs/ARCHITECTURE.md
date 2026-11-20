# 架构与模块

## 数据流

```text
飞牛挂载外接存储 → 发现或手动选择授权 → 找到 DCIM
→ 观察文件稳定 → 读取日期和计算 SHA-256 → 去重
→ 临时复制 → 目标 SHA-256 校验 → 提交归档及索引
→ 保存每轮数量和文件日志 → 安排下一次扫描
```

## 模块

| 路径 | 职责 |
| --- | --- |
| `app/server.js` | 网关管理员鉴权、配置、状态、扫描与历史接口 |
| `app/lib/discovery.js` | 外接命名空间、挂载、读取检查及诊断 |
| `app/lib/stability.js` | 单调时间的文件无变化观察 |
| `app/lib/importer.js` | 内容哈希、去重索引、复制校验与冲突保护 |
| `app/lib/metadata.js` | 扩展名分类、JPEG EXIF、QuickTime、日期回退 |
| `app/lib/schedule.js` | 真实的一次性扫描计划及下次时间 |
| `app/lib/history.js` | 每轮元数据、数量检查点、日志分页与重启恢复 |
| `app/lib/time.js` | 东八区运行记录格式化 |
| `app/ui/` | 设置、设备、工作状态、历史与原生目录弹窗集成 |
| `fnos/` | manifest、专用包账户、API scope、生命周期和桌面入口 |
| `scripts/` | 图标渲染、官方构建、包审计和发布资产验证 |
| `.release/request.json` | 显式版本发布请求 |
| `.github/workflows/` | 普通检查及公开 Release 工作流 |

## 运行与数据

Node.js v22 由系统依赖提供，包内不携带架构专用运行时，因此 platform=all。服务通过 fnOS 网关 Unix Socket 访问，不开放生产 TCP 管理端口。目录选择使用官方 SDK 与共享授权 scope，服务以专用包账户运行。

配置、索引、总日志和 history 存储在 TRIM_PKGVAR；媒体写入用户选择的独立目标目录。来源只读，不自行挂载、不调用 root、不删除或格式化卡。

去重依赖持久索引和目标文件内容校验；目标同名不同内容不覆盖。复制校验和索引不是独立备份系统。真实设备文件系统、权限、网关和错误恢复仍需验收。
