# dsh-desktop-shell

DeepSeek Harness 的桌面外壳插件:安装到 web profile 后,`dsh web` 启动会自动弹出 Electron 桌面窗口(带系统托盘、最小化到托盘、窗口状态记忆),托盘「退出」时优雅关闭整个 dsh 进程;卸载后完全恢复浏览器模式。**dsh 引擎零改动**。

## 功能

- `dsh web` 启动 → 自动弹出 Electron 窗口,加载 `http://127.0.0.1:<port>`(dsh 现有 HTTP 服务原封不动)
- 关闭窗口(X)→ 隐藏到系统托盘,进程继续
- 托盘菜单:「打开主窗口」恢复窗口;「退出」关闭窗口并退出 dsh 进程
- 单实例锁:重复运行 `dsh web` 不弹新窗,聚焦已有窗口
- 窗口位置/大小记忆(退出后重开保持)
- 降级设计:任何 electron 缺失 / spawn 失败 / 加载失败,自动回到纯浏览器模式(warn + 打印 URL),绝不阻断 `dsh web`

## 安装

### 1. 构建插件

```bash
cd dsh-desktop-shell
npm install            # 沙箱环境需 --cache <本地缓存路径>
npm run build          # 生成 lib/index.js + lib/index.d.ts + lib/electron-main.cjs
npm test               # vitest 单元测试
```

> Electron 二进制下载较慢,可设置镜像:`$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"`(npm install 前设置)。

### 2. 接入 web profile

在 profile 的 `package.json` 中:

```json
{
  "dependencies": {
    "dsh-desktop-shell": "file:E:/<path-to>/dsh-desktop-shell"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-desktop-shell"
      ]
    }
  }
}
```

```bash
npm install   # 在 profile 目录执行,建立本地链接
```

插件自带的 `cordis.patch.yml`(通过 `dsh.bundle.patch` 声明)会向组合树插入一行 host 插件:

```yaml
- insert:
    - id: desktop-shell
      name: 'dsh-desktop-shell'
      inject: [webServer]
      config:
        enabled: true
        exitOnClose: true
```

## 使用

```bash
dsh web
# 控制台打印 http://127.0.0.1:<port> 后自动弹出桌面窗口
```

开关与降级:

| 场景 | 行为 |
| --- | --- |
| `dsh web --no-desktop` | 不弹窗,浏览器模式 |
| `$env:DSH_DESKTOP="0"; dsh web` | 同上 |
| profile 配置 `enabled: false` | 同上 |
| electron 未安装 / 路径失效 | warn + 浏览器模式 |
| 窗口加载失败 | 弹错误框,electron 退出(exit≠0),dsh 保持浏览器模式 |

托盘「退出」:electron 以 exit 0 退出 → 插件调用 launcher 提供的 `ctx.appExit(0)`(有界树销毁 + 进程退出),整个 `dsh web` 命令结束。

## 桌面快捷方式(可选)

想双击桌面图标直接打开,而不是在终端输入 `dsh web`:

- `scripts/launch-dsh-web.ps1` + `scripts/launch-dsh-web.cmd`:双击启动器(隐藏控制台运行 `dsh web`;若已在运行则唤起已有 Electron 窗口,不重复启动)
- `assets/icon.png`(黑底白鲸,窗口/任务栏图标)、`assets/icon-tray.png`(透明底白鲸,托盘图标)、`assets/icon.ico` + `assets/deepseek-whale.ico`(多尺寸 BMP 格式,快捷方式图标 —— 桌面快捷方式指向独立文件名 `deepseek-whale.ico`,以绕过资源管理器按路径的图标缓存):由官方 DeepSeek 鲸鱼 logo(dsh 前端 favicon.svg)渲染,重生成用 `scripts/render-icon.cjs`(需在无文件沙箱的后台环境运行 —— Chromium 的 mojo IPC 依赖命名管道)
- 桌面快捷方式「DeepSeek Harness」已生成,指向:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File <项目>\scripts\launch-dsh-web.ps1
```

行为:双击 → dsh 启动 + Electron 窗口弹出;再双击 → 唤起已有窗口;托盘「退出」→ dsh 一并退出。日志:`%USERPROFILE%\.dsh\desktop-shell-launcher.log`(启动器)与 `desktop-shell-web.log`(dsh web 输出)。若项目/主目录移动,需同步修改两个脚本里的路径。

> 注:`launch-dsh-web.cmd` 必须保持纯 ASCII 内容 —— cmd.exe 按系统 ANSI 代码页读取批处理文件,内嵌中文路径会在 GBK 系统上乱码(文件路径本身含中文没问题,内容不能有)。

## 卸载

1. 从 profile `package.json` 的 `dependencies` 与 `dsh.profile.bundles` 移除 `dsh-desktop-shell`
2. `npm install`(profile 目录)清理链接
3. 重启 `dsh web`,完全恢复浏览器模式,无残留进程

## 故障排查

- **桌面窗口没弹出,只打印 URL**:看 dsh 日志是否有 `desktop-shell: electron not found` 或 `failed to start electron` warn;确认插件包内 `node_modules/electron/dist/electron.exe` 存在,或配置 `electronPath` 显式指定
- **托盘图标消失 / 不显示**:Electron 应用日志在 `%APPDATA%/Electron/desktop.log`(窗口状态在 `window-state.json`)
- **退出后 dsh 没退出**:确认 `exitOnClose: true`(默认);手动 Ctrl+C 兜底

## 结构

```
src/index.ts             host 插件(决议 electron 路径、spawn、降级、退出联动)
src/electron-main.cjs    Electron 主进程(窗口、托盘、单实例锁、状态记忆)
src/invariant.ts         错误类型(始终降级、绝不致命)
cordis.patch.yml         bundle 补丁(插入 desktop-shell 行)
scripts/copy-electron-main.mjs  构建时把主进程脚本原样复制到 lib/
test/index.test.js       vitest 单元测试
```

## License

MIT
