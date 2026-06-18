# LOF套利监控开发使用说明

## 1. 项目概览

这是一个本地 Web 应用，后端负责抓取和合并 LOF 基金数据，前端负责展示、排序、搜索、导出和触发刷新。

当前主线实现是 Node.js 版本：

```text
server.js
lof_viewer.html
funds_config.json
```

Python 版本仍保留在仓库中：

```text
server.py
requirements.txt
validate_offline.py
```

但发布 EXE 使用 Node.js SEA 单文件打包方案，不使用 Python 版本。

## 2. 运行环境

开发 Node 版本建议：

```text
Node.js 22 或更新版本
npm
Windows PowerShell 或 cmd
```

安装打包依赖：

```text
npm install
```

当前唯一 Node 开发依赖是：

```text
postject
```

Python 版本需要：

```text
Python 3.10 或更新版本
pip install -r requirements.txt
```

## 3. 项目结构

```text
.
├─ server.js                  Node 后端主程序
├─ lof_viewer.html            前端页面，内嵌 CSS 和 JavaScript
├─ funds_config.json          当前基金池和最近数据
├─ BUILD_EXE.bat              构建绿色版 EXE 和安装包
├─ START.bat                  开发启动脚本，优先 Node，兜底 Python
├─ INSTALL_AND_START.bat      依赖安装并启动脚本，优先 Node，兜底 Python
├─ pack_exe                   Node SEA 打包辅助脚本
├─ dist                       构建中间产物
├─ 发布                       对外交付目录
├─ server.py                  Python 旧版/备用实现
├─ requirements.txt           Python 依赖
└─ validate_offline.py        Python 版本离线校验脚本
```

发布目录：

```text
发布\LOF套利监控.exe
发布\LOF套利监控安装包.exe
发布\funds_config.json
发布\配置文件说明.txt
```

## 4. 本地开发启动

方式一，直接运行 Node 后端：

```text
node server.js
```

方式二，双击：

```text
START.bat
```

启动地址：

```text
http://127.0.0.1:8787
```

默认监听：

```text
HOST = 127.0.0.1
PORT = 8787
```

开发时如果不希望自动打开浏览器，可以设置：

```powershell
$env:LOF_NO_OPEN='1'
node server.js
```

## 5. 运行目录和配置文件

`server.js` 会区分源码运行和 EXE 运行：

- 源码运行时，运行目录是项目目录。
- EXE 运行时，运行目录是 EXE 所在目录。

配置文件路径：

```text
RUNTIME_DIR\funds_config.json
```

缓存文件路径：

```text
%LOCALAPPDATA%\LOF套利监控\cache\lof_data_node.json
```

注意：

- `funds_config.json` 是用户重要数据，保存基金池、最近价格、净值、申购赎回状态和用户手动添加的基金。
- 安装包遇到已存在的 `funds_config.json` 时不会覆盖，会把新默认配置写为 `funds_config_default.json`。
- 调试保存逻辑时不要随意删除用户真实安装目录下的配置。

## 6. 后端接口

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/` | GET | 返回前端页面。EXE 中页面会被内嵌到程序里。 |
| `/api/ping` | GET | 健康检查，用于判断已有服务是否运行。 |
| `/api/data` | GET | 返回当前基金数据。如果内存为空，会触发全量刷新。 |
| `/api/refresh` | GET | 异步启动全量刷新。 |
| `/api/refresh_fast` | GET | 执行快速刷新，只更新行情。 |
| `/api/search_add?q=...` | GET | 搜索并添加 LOF 基金。 |
| `/api/export.csv` | GET | 导出 CSV。 |
| `/api/shutdown` | GET | 退出本地服务。 |

## 7. 数据字段

核心基金记录字段：

| 字段 | 说明 |
| --- | --- |
| `code` | 基金代码。 |
| `name` | 基金名称。 |
| `group` | 内部分组：`stock`、`index`、`qdii_europe_us`、`qdii_asia`。 |
| `group_name` | 中文分组名。 |
| `market` | `SH` 或 `SZ`。 |
| `market_name` | 上海或深圳。 |
| `price_date` | 场内行情日期，优先来自东方财富行情字段 `f297`。 |
| `price` | 场内现价。 |
| `change_pct` | 场内涨跌幅。 |
| `volume` | 成交量。 |
| `amount` | 成交额，单位万元。 |
| `nav` | 单位净值。 |
| `nav_date` | 净值日期。 |
| `nav_source` | 最终采用的净值来源。净值按日期合并，旧日期不能覆盖新日期。 |
| `premium` | 溢价率。 |
| `apply_status` | 申购状态。 |
| `redeem_status` | 赎回状态。 |
| `apply_limit` | 日累计申购限额，能抓到时保存。 |
| `apply_fee` | 购买手续费，能抓到时保存。 |
| `redeem_fee` | 赎回费，当前保留字段。 |
| `trade_status_source` | 交易状态来源。 |
| `source` | 记录主要来源。 |
| `note` | 基金类型或备注。 |
| `user_added` | 是否用户手动添加。 |

保存配置时使用 `configRecord()` 统一输出字段。

## 8. 数据来源和刷新逻辑

### 基金池

主要来自天天基金代码库：

```text
https://fund.eastmoney.com/js/fundcode_search.js
```

筛选逻辑：

- 代码以 `16` 或 `50` 开头。
- 名称或类型含 LOF 标记。
- 少数名称里没有 LOF 但确认为场内 LOF 的代码放在 `KNOWN_LISTED_LOF_CODES` 中。

### 集思录补充

尝试访问集思录 LOF/QDII 列表，补充价格、净值和状态字段：

```text
https://www.jisilu.cn/data/lof/stock_lof_list/
https://www.jisilu.cn/data/lof/index_lof_list/
https://www.jisilu.cn/data/qdii/qdii_list/
```

集思录接口可能临时不可用，失败时不会中断刷新。

### 净值

全量刷新先读取天天基金 LOF 批量净值列表，并用集思录 LOF/QDII 列表交叉补充。只有批量来源仍缺少净值的基金，才逐只访问：

```text
https://fundgz.1234567.com.cn/js/{code}.js
https://fund.eastmoney.com/pingzhongdata/{code}.js
```

`fetchOneNav()` 会保留日期更新的净值。`mergeRecord()` 对净值采用按日期合并，旧配置和旧来源不能覆盖更新日期的净值。

### 场内行情

优先东方财富行情：

```text
https://push2.eastmoney.com/api/qt/ulist.np/get
```

使用字段：

```text
f12 代码
f13 市场
f14 名称
f2  现价
f3  涨跌幅
f5  成交量
f6  成交额
f124 时间戳
f297 交易日期，格式 YYYYMMDD
```

`price_date` 优先使用 `f297`，如果没有则用 `f124` 转日期。

东方财富未返回的代码会尝试新浪行情：

```text
https://hq.sinajs.cn/list=...
```

新浪返回数组中：

```text
p[30] 交易日期
p[3]  当前价
p[2]  昨收
p[8]  成交量
p[9]  成交额
```

### 申购赎回状态

全量刷新会逐只访问天天基金基金档案费率页：

```text
https://fundf10.eastmoney.com/jjfl_{code}.html
```

解析内容：

- 申购状态
- 赎回状态
- 日累计申购限额
- 购买手续费

为了减少漏抓和被数据源限流，`enrichTradeStatus()` 使用低并发和重试：

```text
并发数：4
每只基金后短暂等待
失败最多重试 3 次
```

### 刷新流程

全量刷新 `fullRefresh()`：

1. 抓完整 LOF 基金池。
2. 尝试集思录补充。
3. 合并本地配置中的用户基金和已有字段。
4. 补齐单位净值。
5. 补齐申购赎回状态。
6. 抓场内行情。
7. 计算溢价率。
8. 分类 QDII 区域。
9. 保存缓存和 `funds_config.json`。

快速刷新 `fastRefresh()`：

1. 只抓场内行情。
2. 更新现价、现价日期、涨跌幅、成交额和成交量。
3. 重新计算溢价率。
4. 保存缓存和配置。

## 9. 前端结构

前端全部在：

```text
lof_viewer.html
```

主要职责：

- 渲染表格和顶部统计。
- 处理分类标签。
- 搜索和添加基金。
- 表头排序。
- 快速刷新、全量刷新、自动刷新。
- 导出 CSV。
- 退出程序。

关键函数：

| 函数 | 说明 |
| --- | --- |
| `loadData()` | 调用 `/api/data` 并渲染。 |
| `refresh()` | 调用刷新接口并轮询状态。 |
| `render()` | 渲染表格。 |
| `sortedRows()` | 表格排序。 |
| `statusCell()` | 渲染申购/赎回状态样式和限额。 |
| `updateStats()` | 更新顶部统计。 |
| `searchOrAdd()` | 搜索或添加基金。 |

表格新增列时，需要同步：

- `<thead>` 表头。
- `render()` 中每行 `<td>`。
- 空状态 `colspan`。
- 后端 CSV 字段。
- 如字段要落盘，还要同步 `configRecord()` 和 `baseRecord()`。

## 10. 构建和发布

推荐直接运行：

```text
BUILD_EXE.bat
```

构建流程：

1. 检查 Node.js。
2. 检查/安装 `postject`。
3. `pack_exe\generate_sea_entry.js` 把 `server.js` 和 `lof_viewer.html` 合成为 `dist\sea_entry.js`。
4. `node --experimental-sea-config dist\sea-config.json` 生成 SEA blob。
5. 复制当前 Node.exe 为 `dist\LOF_Arbitrage_Monitor.exe`。
6. 用 `postject` 注入 SEA blob。
7. `pack_exe\patch_windows_subsystem.js` 改为 Windows GUI 程序，减少黑窗口。
8. 复制为 `发布\LOF套利监控.exe`。
9. `pack_exe\generate_installer_embedded.js` 把发布 EXE 和默认配置 gzip 后嵌入安装器源码。
10. 构建 `发布\LOF套利监控安装包.exe`。

构建输出：

```text
发布\LOF套利监控.exe
发布\LOF套利监控安装包.exe
发布\funds_config.json
```

注意：

- 构建前请确认 `funds_config.json` 是你希望发布的默认配置。
- 如果 `发布\LOF套利监控.exe` 正在运行，复制覆盖会失败。先退出程序或结束占用 8787 端口的旧进程。
- 构建时看到 `warning: The signature seems corrupted!` 是对复制出来的 Node 可执行文件注入 SEA blob 后的签名警告，不等同于构建失败。以脚本退出码和输出文件为准。

## 11. 发布前检查

建议每次发布前做这些检查：

```text
node --check server.js
```

启动源码版：

```text
$env:LOF_NO_OPEN='1'
node server.js
```

检查接口：

```text
http://127.0.0.1:8787/api/ping
http://127.0.0.1:8787/api/data
```

检查项目：

- 页面能打开。
- 表格有数据。
- `现价日期` 列存在。
- `申购`、`赎回` 大部分或全部有值。
- `快速刷新` 能更新行情。
- `全量刷新` 能完成。
- `导出CSV` 能下载。
- `退出程序` 能关闭服务。

发布 EXE 验证建议：

1. 确认没有旧程序占用 8787 端口。
2. 启动 `发布\LOF套利监控.exe`。
3. 打开 `http://127.0.0.1:8787`。
4. 调用 `/api/data` 检查字段完整性。
5. 点击 `退出程序` 关闭。

## 12. 常见维护任务

### 更新基金池和状态

运行源码版后点击页面 `全量刷新`，或等待后端定时全量刷新。

全量刷新会保存新的 `funds_config.json`。如果准备发布，请确认根目录的 `funds_config.json` 是最新且正确的，再运行 `BUILD_EXE.bat`。

### 添加字段

以新增后端字段为例：

1. 在 `baseRecord()` 增加默认值。
2. 在抓取逻辑里赋值。
3. 如需要覆盖旧值，在 `mergeRecord()` 的 `alwaysUpdate` 增加字段名。
4. 在 `configRecord()` 增加落盘字段。
5. 在前端表格增加表头和单元格。
6. 在 `sendCsv()` 增加导出字段。
7. 启动验证 `/api/data` 和页面展示。
8. 重新打包发布。

### 调整申购状态解析

相关函数：

```text
htmlToText()
cleanStatus()
parseTradeStatusHtml()
fetchOneTradeStatus()
enrichTradeStatus()
```

如果天天基金页面结构变化，优先用单只基金页面样本验证 `parseTradeStatusHtml()`，再调整正则。

### 调整行情字段

相关函数：

```text
fetchQuotes()
fetchSinaQuotes()
formatQuoteDate()
timestampDate()
```

东方财富字段变化时，先抓一只基金的原始接口返回，确认字段名和含义后再改。

### 清理构建产物

可以删除后重新生成的内容：

```text
dist
.npm-cache
.config-gen-cache
.local4
```

不要随意删除：

```text
server.js
lof_viewer.html
funds_config.json
pack_exe
package.json
package-lock.json
node_modules
发布
```

如果删除 `node_modules`，下次构建前需要重新 `npm install`。

## 13. 故障排查

### 端口被占用

查看 8787 端口占用：

```powershell
Get-NetTCPConnection -LocalPort 8787
```

如果占用进程是旧的 `LOF套利监控.exe`，先用页面 `退出程序`，或结束该进程后再启动/构建。

### 发布目录 EXE 无法覆盖

通常是旧 EXE 正在运行。关闭页面不一定会退出后台服务，需要点击 `退出程序`。

### 页面无数据

检查：

- `funds_config.json` 是否存在。
- `/api/data` 是否返回错误。
- 网络是否能访问东方财富、天天基金、集思录等公开数据源。
- 全量刷新是否仍在进行。

### 申购状态为空或少量缺失

全量刷新会逐只访问基金档案页。短时间大量请求可能被数据源限制。当前代码已降低并发并重试；如果仍有缺失，可以稍后再次全量刷新。

### 现价日期为空

表示行情源没有返回该代码的场内行情日期。不要用当前日期强行填充，否则会误导用户。

### README 显示乱码

所有新文档使用 UTF-8 编码。Windows 旧工具如果按 ANSI 打开，可能显示乱码。请使用 VS Code、现代记事本或其他支持 UTF-8 的编辑器。

## 14. 代码风格约定

- 保持单文件后端和单文件前端结构，除非功能明显复杂到需要拆分。
- 新字段要同时考虑：内存记录、配置落盘、CSV、前端展示和旧配置兼容。
- 网络抓取失败不能让整个刷新流程崩掉，尽量记录来源状态并继续使用已有数据。
- 不要把无法确认的数据写成看似准确的值。例如没有行情日期时保持空值。
- 用户配置优先，安装包不应覆盖已有 `funds_config.json`。

## 15. 投资和数据风险说明

开发维护时不要把本工具描述为交易建议工具。它只是公开数据整理和本地展示工具。申购赎回状态、净值、价格、限额和成交数据都可能延迟或与不同渠道存在差异。任何对外发布说明都应保留风险提示。
