from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
errors: list[str] = []

required_files = ["server.py", "server.js", "lof_viewer.html", "requirements.txt", "START.bat", "INSTALL_AND_START.bat"]
for name in required_files:
    if not (ROOT / name).exists():
        errors.append(f"缺少文件: {name}")

server = (ROOT / "server.py").read_text(encoding="utf-8")
server_js = (ROOT / "server.js").read_text(encoding="utf-8")
html = (ROOT / "lof_viewer.html").read_text(encoding="utf-8")

for endpoint in ["/api/data", "/api/refresh", "/api/refresh_fast", "/api/export.csv"]:
    if endpoint not in server:
        errors.append(f"后端缺少接口: {endpoint}")
    if endpoint not in server_js:
        errors.append(f"Node 后端缺少接口: {endpoint}")
    if endpoint not in html:
        errors.append(f"前端缺少接口引用: {endpoint}")

for label in ["股票LOF", "指数LOF", "欧美市场", "亚洲市场", "自动刷新", "全量刷新", "快速刷新"]:
    if label not in html:
        errors.append(f"页面缺少文案: {label}")

for field in ["code", "name", "price", "change_pct", "nav", "premium", "apply_status", "redeem_status"]:
    if field not in server:
        errors.append(f"后端缺少字段: {field}")
    if field not in server_js:
        errors.append(f"Node 后端缺少字段: {field}")
    if field not in html:
        errors.append(f"前端缺少字段: {field}")

try:
    compile(server, str(ROOT / "server.py"), "exec")
except Exception as exc:
    errors.append(f"server.py 语法错误: {exc}")

report = {
    "passed": not errors,
    "checked_files": required_files,
    "errors": errors,
}
print(json.dumps(report, ensure_ascii=False, indent=2))

(ROOT / "reports").mkdir(exist_ok=True)
(ROOT / "reports" / "offline_contract_validation.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

sys.exit(0 if not errors else 1)
