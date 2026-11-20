# 架构与功能

## 数据流

```text
USB / SD 卡 → fnOS 挂载 → 后台扫描发现 DCIM
    → 列出支持格式文件
    → 拍摄时间解析（EXIF/视频元数据，必要时回退 mtime）
    → SHA-256 内容去重
    → 目标临时复制 → 目标 SHA-256 校验
    → 正式归档 → 持久索引/日志
    → 飞牛相册等应用可按目录访问
```

## 模块说明

- `app/server.js`：Node.js 后端，配置、状态、日志 API；fnOS 网关集成。
- `app/lib/discovery.js`：枚举已挂载外部存储及可信来源。
- `app/lib/metadata.js`：EXIF/QuickTime/文件日期与扩展名分类。
- `app/lib/importer.js`：复制校验、SHA-256、去重索引与冲突保护。
- `app/ui/`：fnOS 桌面管理页面。
- `fnos/`：manifest、生命周期、资源与桌面入口。
- `scripts/`：官方 fnpack 构建及实验测试打包辅助。
- `tests/`：数据导入、时间解析、目录权限单元测试。

## 配置、安全与限制

- 默认关闭自动导入，用户显式指定目标目录。
- 不自行挂载 USB、不修改 udev、不使用 root、不删除/清空源卡。
- 归档到 `YYYY/YYYY-MM-DD/{RAW,JPG,VIDEO,OTHER}`。
- 重复判断使用内容哈希，而非仅文件名；不同内容同名不能覆盖。
- 扫描以轮询方式运行；依赖 fnOS 挂载能力与应用授权。
- 尚未做相似照片 AI 聚类、画面灯亮筛选、相机直连。
- 高可用、海量索引性能与系统升级兼容性还需要实体 NAS 测试。
