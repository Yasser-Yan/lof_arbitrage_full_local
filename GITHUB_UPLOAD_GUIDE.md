# GitHub 上传方法说明

本文档记录本项目这次成功上传到 GitHub 的实际流程，以及过程中遇到的问题和可复用的解决办法。

## 1. 最终结果

GitHub 仓库：

```text
https://github.com/Yasser-Yan/lof_arbitrage_full_local
```

Release 页面：

```text
https://github.com/Yasser-Yan/lof_arbitrage_full_local/releases/tag/v2026.06.17
```

本次上传结果：

- 代码已推送到 `main` 分支。
- 仓库为私有仓库。
- 普通源码、配置和说明文档放在 Git 仓库里。
- 大的 EXE 文件没有直接提交到仓库，而是作为 GitHub Release 附件上传。

## 2. 为什么 EXE 不直接提交到仓库

GitHub 普通 Git 仓库对单个文件大小有限制：

- 建议单文件小于 50MB。
- 普通 Git 推送单文件上限约 100MB。

本项目发布文件中：

```text
发布\LOF套利监控.exe              约 83MB
发布\LOF套利监控安装包.exe        约 127MB
```

其中安装包超过普通仓库单文件限制，所以不能直接提交到 Git 仓库。

正确做法：

- 源码、脚本、配置、说明文档提交到 Git 仓库。
- EXE、安装包等二进制交付物上传到 GitHub Release。

## 3. 本地准备

项目目录：

```text
D:\codex\lof_arbitrage_full_local
```

先确认 Git 可用：

```powershell
git --version
```

如果项目还不是 Git 仓库，初始化：

```powershell
git init
```

设置当前仓库提交身份：

```powershell
git config user.name "Codex"
git config user.email "codex@local.invalid"
```

这里设置的是本地提交身份，不影响 GitHub 账号登录。

## 4. 添加 .gitignore

本项目使用的 `.gitignore` 重点是排除依赖、构建产物和大 EXE 文件：

```gitignore
# Dependencies
node_modules/
.npm-cache/

# Build outputs and generated bundles
dist/

# Local runtime caches
.local*/
.config-gen-cache/
*.log

# OS/editor files
.DS_Store
Thumbs.db
.vscode/
.idea/

# Keep release documentation and small runtime config in the repository, but do not
# commit large generated executables. Upload installers as GitHub Release assets.
发布/*.exe
```

说明：

- `node_modules/` 可以通过 `npm install` 重新生成，不应提交。
- `dist/` 是打包中间产物，不应提交。
- `发布/*.exe` 是二进制交付物，尤其安装包超过 100MB，应走 Release。
- `发布/funds_config.json`、说明文档可以提交，因为体积小，便于用户查看默认配置和说明。

## 5. 创建初始提交

查看待提交文件：

```powershell
git status -sb
```

添加文件：

```powershell
git add .
```

提交：

```powershell
git commit -m "Initial LOF arbitrage monitor release"
```

本次实际初始提交：

```text
e888320 Initial LOF arbitrage monitor release
```

后续因为发布目录配置文件有自动刷新重排，又补了一个提交：

```text
4f80c26 Update release fund config snapshot
```

## 6. 创建 GitHub 仓库

本次自动创建仓库遇到权限问题：

```text
Yasser-Yan does not have the correct permissions to execute CreateRepository
```

原因：

- GitHub 设备授权拿到的临时权限不足。
- 可以识别账号，但不能创建新仓库。

最终采用手动创建仓库：

1. 打开：

```text
https://github.com/new
```

2. 仓库名填写：

```text
lof_arbitrage_full_local
```

3. 选择：

```text
Private
```

4. 不勾选：

```text
README
.gitignore
License
```

因为本地已经有这些文件和提交，GitHub 上保持空仓库最干净。

## 7. 设置远程仓库

把本地分支改为 `main`：

```powershell
git branch -M main
```

添加远程地址：

```powershell
git remote add origin https://github.com/Yasser-Yan/lof_arbitrage_full_local.git
```

如果已经存在 `origin`，改用：

```powershell
git remote set-url origin https://github.com/Yasser-Yan/lof_arbitrage_full_local.git
```

检查远程地址：

```powershell
git remote -v
```

## 8. GitHub 登录和推送

本次尝试过几种方式。

### 方式一：GitHub CLI

先安装 GitHub CLI：

```powershell
winget install --id GitHub.cli -e --silent --accept-package-agreements --accept-source-agreements
```

但本机安装版 `gh.exe` 出现过无法运行的问题：

```text
The specified executable is not a valid application for this OS platform.
```

后来下载 GitHub CLI zip 版可以运行：

```text
gh version 2.94.0
```

不过 CLI 的浏览器设备授权多次遇到网络超时，且早期设备令牌没有仓库写权限，因此没有作为主要推送方式。

### 方式二：Git Credential Manager，最终成功

本机 Git 自带 Git Credential Manager。

检查：

```powershell
git config --show-origin --get credential.helper
```

触发 GitHub 登录：

```powershell
git credential-manager github login
```

这个命令会通过浏览器完成 GitHub 登录授权。

登录后检查账号：

```powershell
git credential-manager github list
```

本次成功显示：

```text
Yasser-Yan
```

然后推送：

```powershell
git push -u origin main
```

本次最终成功：

```text
branch 'main' set up to track 'origin/main'.
To https://github.com/Yasser-Yan/lof_arbitrage_full_local.git
 * [new branch]      main -> main
```

## 9. 网络问题处理

推送过程中遇到过：

```text
Recv failure: Connection was reset
Failed to connect to github.com port 443
```

尝试过以下 Git 设置：

```powershell
git config http.version HTTP/1.1
git config http.postBuffer 524288000
```

这些设置不一定能解决所有网络问题，但可以保留：

- `HTTP/1.1` 有时比 HTTP/2 更稳定。
- `http.postBuffer` 对大推送有时有帮助。

真正成功的关键是：

- 使用 Git Credential Manager 完成浏览器授权。
- 使用 HTTPS 远程地址推送。

## 10. SSH 方式为什么没有继续用

曾尝试生成 SSH key：

```text
id_ed25519_github_lof_codex
```

并要求把公钥添加到 GitHub。

但 SSH 测试一直返回：

```text
git@github.com: Permission denied (publickey).
```

说明 GitHub 没有接受该 key，可能原因：

- key 没有正确添加到当前 GitHub 账号。
- 添加页面没有保存成功。
- 添加到了别的账号。

因为 Git Credential Manager 已经成功，所以不再继续折腾 SSH。

后续建议：

- 普通上传优先用 HTTPS + Git Credential Manager。
- 只有在 HTTPS 长期不可用时，再考虑 SSH。

## 11. 创建 GitHub Release

代码推上去后，发布 EXE 和安装包需要放到 Release。

Release 标签：

```text
v2026.06.17
```

Release 标题：

```text
LOF套利监控 2026-06-17
```

Release 说明：

```text
首次发布：包含源码、用户说明、开发说明、绿色版 EXE、安装包和默认基金配置。安装包超过 100MB，作为 Release 附件提供。
```

## 12. Release 附件

本次上传了 6 个附件：

```text
LOF-Arbitrage-Monitor.exe
LOF-Arbitrage-Monitor-Installer.exe
funds_config.json
USER_GUIDE.md
DEVELOPER_GUIDE.md
CONFIG_README.txt
```

注意：

原始中文文件名附件在 GitHub 上传接口中出现过问题，所以 Release 附件改用英文文件名。

对应关系：

| Release 附件 | 本地源文件 |
| --- | --- |
| `LOF-Arbitrage-Monitor.exe` | `发布\LOF套利监控.exe` |
| `LOF-Arbitrage-Monitor-Installer.exe` | `发布\LOF套利监控安装包.exe` |
| `funds_config.json` | `发布\funds_config.json` |
| `USER_GUIDE.md` | `发布\用户使用说明.md` |
| `DEVELOPER_GUIDE.md` | `发布\开发使用说明.md` |
| `CONFIG_README.txt` | `发布\配置文件说明.txt` |

## 13. 用 API 上传 Release 附件

因为 `gh release create` 使用的早期令牌权限不稳定，最终使用 Git Credential Manager 中的 GitHub 凭据，通过 GitHub REST API 创建 Release 和上传附件。

核心思路：

1. 从 Git Credential Manager 取 GitHub 凭据。
2. 调用 GitHub API 创建 Release。
3. 调用 uploads.github.com 上传附件。

取凭据：

```powershell
$credInput = "protocol=https`nhost=github.com`n`n"
$cred = $credInput | git credential fill
$token = (($cred | Select-String '^password=').Line -replace '^password=','')
```

检查仓库：

```powershell
$headers = @{
  Authorization = "Bearer $token"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
}

Invoke-RestMethod `
  -Uri 'https://api.github.com/repos/Yasser-Yan/lof_arbitrage_full_local' `
  -Headers $headers
```

创建 Release：

```powershell
$releaseBody = @{
  tag_name = 'v2026.06.17'
  target_commitish = 'main'
  name = 'LOF套利监控 2026-06-17'
  body = '首次发布：包含源码、用户说明、开发说明、绿色版 EXE、安装包和默认基金配置。安装包超过 100MB，作为 Release 附件提供。'
  draft = $false
  prerelease = $false
} | ConvertTo-Json

$release = Invoke-RestMethod `
  -Uri 'https://api.github.com/repos/Yasser-Yan/lof_arbitrage_full_local/releases' `
  -Method Post `
  -Headers $headers `
  -Body $releaseBody `
  -ContentType 'application/json; charset=utf-8'
```

上传附件的关键点：

```powershell
$uploadBase = ($release.upload_url -replace '\{.*$','')
$uri = $uploadBase + '?name=' + [uri]::EscapeDataString($assetName)
$bytes = [System.IO.File]::ReadAllBytes($filePath)

Invoke-RestMethod `
  -Uri $uri `
  -Method Post `
  -Headers $headers `
  -Body $bytes `
  -ContentType 'application/octet-stream'
```

## 14. 上传后检查

检查本地是否干净：

```powershell
git status -sb
```

正常结果：

```text
## main...origin/main
```

检查最近提交：

```powershell
git log --oneline -2
```

本次结果：

```text
4f80c26 Update release fund config snapshot
e888320 Initial LOF arbitrage monitor release
```

检查 Release：

```powershell
gh release view v2026.06.17 `
  --repo Yasser-Yan/lof_arbitrage_full_local `
  --json url,assets,tagName,name
```

最终确认：

- 仓库地址可访问。
- 仓库是私有仓库。
- Release 地址可访问。
- Release 附件数量为 6。

## 15. 后续更新代码的推荐流程

修改代码后：

```powershell
git status -sb
git add .
git commit -m "简短说明本次修改"
git push
```

如果只修改了源码、文档、配置，普通 `git push` 即可。

如果重新打包了 EXE 或安装包：

1. 不要把 EXE 提交到 Git。
2. 新建一个 Release 标签，例如：

```text
v2026.06.18
```

3. 把新的 EXE、安装包和配置上传到 Release 附件。

## 16. 后续发布版本命名建议

按日期命名：

```text
vYYYY.MM.DD
```

例如：

```text
v2026.06.17
v2026.06.18
```

如果一天发布多次，可以加后缀：

```text
v2026.06.17-1
v2026.06.17-2
```

## 17. 简化版操作清单

第一次上传：

```powershell
git init
git add .
git commit -m "Initial LOF arbitrage monitor release"
git branch -M main
git remote add origin https://github.com/Yasser-Yan/lof_arbitrage_full_local.git
git credential-manager github login
git push -u origin main
```

后续普通更新：

```powershell
git add .
git commit -m "Update ..."
git push
```

后续带 EXE 的发布：

```text
1. 重新打包。
2. 提交源码和配置。
3. 推送 main。
4. 新建 GitHub Release。
5. 上传 EXE、安装包和说明文档到 Release 附件。
```

## 18. 本次踩坑总结

| 问题 | 处理方式 |
| --- | --- |
| 自动创建 GitHub 仓库权限不足 | 手动在网页创建空私有仓库。 |
| GitHub CLI 安装版无法运行 | 下载 zip 版 `gh.exe` 临时使用。 |
| GitHub CLI 设备授权超时 | 改用 Git Credential Manager 登录。 |
| 设备授权令牌没有仓库写权限 | 不用该令牌写仓库，只用 Git Credential Manager 凭据。 |
| HTTPS 推送连接重置 | 重试后通过 Git Credential Manager 成功。 |
| 安装包超过 100MB | 不提交 Git，改为 Release 附件。 |
| 中文附件名上传异常 | Release 附件改用英文文件名。 |
| SSH key 不被 GitHub 接受 | 放弃 SSH，使用 HTTPS + Git Credential Manager。 |

