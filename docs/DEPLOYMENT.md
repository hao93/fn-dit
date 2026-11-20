# Linux 源码构建与部署

普通用户优先使用 [Releases](https://github.com/hao93/fn-dit/releases/latest) 的 FPK；安装步骤见 [快速上手](QUICKSTART.md)。

## 构建环境

- Linux，Node.js 22+，Python 3.12+，bash 与常用文件工具。
- 官方 fnpack 1.3.3。下载地址与固定 SHA-256 记录在工作流中。
- PNG 图标已提交，构建不依赖 Pillow；只有重新渲染图标时需要 Pillow。

```bash
curl --fail --location https://static2.fnnas.com/fnpack/fnpack-1.3.3-linux-amd64 -o fnpack
printf '%s  %s\n' '1464d6aa9b995ebecb263c5ec60f0f4a7cbf45e0ce887836755fd65abd647d1e' fnpack | sha256sum --check
chmod 755 fnpack
export FNPACK="$(pwd)/fnpack"
```

不要把下载的二进制或开发者私钥提交到仓库。Windows 本次测试中遇到同步错误/执行位问题，本项目选择 Linux 作为交付构建环境。

## 未签名手动安装发行包

```bash
FPK_UNSIGNED=1 bash scripts/build-fpk.sh
python3 tests/fpk_test.py dist/fn-dit-0.1.6-unsigned.fpk
python3 tests/lifecycle-smoke.py dist/fn-dit-0.1.6-unsigned.fpk
```

输出：FPK、对应 `.sha256` 和 `.audit.json`。仍使用官方 `fnpack build --nosign`，没有签名或商店认证，发行说明必须保留此状态。

仅用于开发的命名也保留：`bash scripts/build-test-fpk.sh` 输出 `-unsigned-test.fpk`。两个模式都不能声称是签名包。

## 使用真实开发者证书

按 `fnpack cert import --help` 在受控构建主机导入自己的证书和私钥，然后运行：

```bash
bash scripts/build-fpk.sh
```

不设置两个 unsigned 环境变量时，脚本调用默认签名构建。不要上传私钥到聊天、仓库或 Release。当前公开 Release 的流程显式为未签名模式；将来切换签名发行需要单独核对证书、构建和验证流程。

## 构建检查

构建在独立临时目录组装完整文件，规范 0755/0644 权限、LF 文本、图标尺寸与入口，并在构建前后审计 manifest、依赖、SDK 哈希、生命周期、源码、app.tgz MD5 和 FPK SHA-256。构建产物不手工重压缩。

安装到设备后仍需核验：依赖启动、目录授权、统一网关、SD 卡读取、真实媒体日期、目标写入及错误恢复。CI 的普通 Linux 服务测试不能代替 fnOS 实机安装。
