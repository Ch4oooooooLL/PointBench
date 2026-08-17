# PointBench 离线安装与发布说明

## 发布产物

运行 `scripts\build-installers.bat` 后，`dist/` 中生成两个 Windows x64 EXE：

1. `PointBench-Dependencies-<版本>.exe`
2. `PointBench-Code-<版本>.exe`

安装顺序固定为“依赖 → 代码”。代码安装器检测不到依赖记录、依赖目录不完整或版本不匹配时会停止并提示先安装正确版本的依赖。

两个 EXE 的文件载荷是顺序写入的普通原始文件，并带逐文件 SHA-256 清单；不使用 ZIP、CAB、7z、wheel 或 tar 容器。构建依赖安装器前还会拒绝依赖树中残留的常见压缩归档。

## 权限和默认位置

安装器只写当前用户范围，不触发 UAC：

| 内容 | 默认位置 |
| ---- | ---- |
| 依赖 | `%LOCALAPPDATA%\PointBench\Dependencies\<依赖版本>` |
| 代码 | 自动使用依赖安装目录 |
| 数据库、附件和日志 | `%LOCALAPPDATA%\PointBench\Data` |
| 桌面入口 | `%USERPROFILE%\Desktop\PointBench.lnk` |
| 安装日志 | `%LOCALAPPDATA%\PointBench\install-logs` |

依赖安装界面允许用户选择安装位置；代码安装器不再询问路径，而是读取注册表中的 `DependenciesInstallDir` 并自动安装到同一目录。数据目录保持稳定，升级代码不会丢失数据库、附件或日志。

例如依赖安装到 `D:\PB` 后，代码必定安装到 `D:\PB`，并直接复用该目录中的 `frontend\node_modules`。

## 安装记录

安装器在 `HKEY_CURRENT_USER\Software\PointBench` 写入：

- `DependenciesInstallDir`、`DependenciesVersion`、`DependenciesInstalledAt`
- `CodeInstallDir`、`CodeVersion`、`CodeDependenciesVersion`、`CodeInstalledAt`
- `UserDataDir`、`DesktopShortcut`
- 代码和依赖各自的安装清单 SHA-256

代码目录的 `config\install-state.txt` 也保存本次代码/依赖组合和数据目录，方便离线排查。

## 安装进度

手动安装时会显示置顶进度窗口：

- 依赖安装：显示当前写入文件、完成百分比和版本记录阶段。
- 代码安装：先显示共享依赖逐文件 SHA-256 校核进度，再显示代码写入、共享依赖配置和桌面快捷方式阶段。
- `/S` 静默安装不显示进度窗口，但仍执行同样的完整校核，并将结果写入安装日志。

## 版本管理与校核

发布版本在 `config\version.json` 中维护：

```json
{
  "codeVersion": "1.0.2",
  "dependenciesVersion": "1.0.0-windows-x64",
  "minimumDependenciesVersion": "1.0.0-windows-x64"
}
```

- 仅代码变化：增加 `codeVersion`，依赖版本可以保持不变。
- Python/Node/npm 依赖变化：增加 `dependenciesVersion`，同步修改 `minimumDependenciesVersion`。
- 每次安装都会重新写入并校核安装包内文件长度和 SHA-256。
- 重复安装同一版本可用于修复被修改或损坏的文件。
- 不同代码版本安装在独立目录，桌面快捷方式始终指向最后成功安装的版本。

## 启动行为

桌面快捷方式调用 `scripts\run.vbs`，由 `scripts\launcher.ps1` 完成以下流程：

1. 检查 `127.0.0.1:8000/api/health` 和 `127.0.0.1:5173`。
2. 如果 PointBench 已运行，直接打开浏览器，不重启或结束后台。
3. 如果尚未运行，校核共享依赖，启动后端和前端，等待就绪后打开浏览器。
4. 并发双击由用户级互斥锁合并，避免重复启动。

## 静默安装

安装器支持自动验收使用的静默参数：

```bat
PointBench-Dependencies-1.0.0-windows-x64.exe /S /D=D:\Apps\PointBenchDeps
PointBench-Code-1.0.2.exe /S
```

`/S` 不显示对话框，进程退出码为 `0` 表示成功；错误详情写入安装日志。代码安装器不接受安装目录，始终跟随已记录的依赖目录。

## 离线电脑验收

1. 断开网络。
2. 安装依赖 EXE，确认注册表中的依赖版本和位置。
3. 安装代码 EXE，确认桌面快捷方式生成。
4. 双击两次快捷方式：第一次启动并打开，第二次只打开已有实例。
5. 验证 XLSX 和项目 ZIP 导入/导出。公司加密软件可能按文件内容识别 XLSX/ZIP，这部分必须在目标电脑实测。

未签名 EXE 可能触发 Windows SmartScreen 或公司终端安全软件告警。正式公司分发建议使用公司代码签名证书对两个最终 EXE 签名，并由安全部门加入白名单。
