const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const release = path.join(root, "发布");

const appGz = zlib.gzipSync(fs.readFileSync(path.join(release, "LOF套利监控.exe")), { level: 9 });
const configGz = zlib.gzipSync(fs.readFileSync(path.join(root, "funds_config.json")), { level: 9 });

const source = `const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { spawnSync } = require("child_process");

const APP_GZ_B64 = ${JSON.stringify(appGz.toString("base64"))};
const CONFIG_GZ_B64 = ${JSON.stringify(configGz.toString("base64"))};

const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const installDir = path.join(localAppData, "Programs", "LOF套利监控");
const appExe = path.join(installDir, "LOF套利监控.exe");
const configFile = path.join(installDir, "funds_config.json");
const defaultConfigFile = path.join(installDir, "funds_config_default.json");

function unpack(b64) {
  return zlib.gunzipSync(Buffer.from(b64, "base64"));
}

function psQuote(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}

function createShortcut(linkPath, targetPath) {
  const command = [
    "$ws=New-Object -ComObject WScript.Shell",
    \`$s=$ws.CreateShortcut(\${psQuote(linkPath)})\`,
    \`$s.TargetPath=\${psQuote(targetPath)}\`,
    \`$s.WorkingDirectory=\${psQuote(installDir)}\`,
    \`$s.IconLocation=\${psQuote(targetPath)}\`,
    "$s.Save()"
  ].join("; ");
  spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command], {
    windowsHide: true,
    stdio: "ignore"
  });
}

fs.mkdirSync(installDir, { recursive: true });
fs.writeFileSync(appExe, unpack(APP_GZ_B64));

const config = unpack(CONFIG_GZ_B64);
if (!fs.existsSync(configFile)) {
  fs.writeFileSync(configFile, config);
} else {
  fs.writeFileSync(defaultConfigFile, config);
}

fs.writeFileSync(
  path.join(installDir, "配置文件说明.txt"),
  [
    "LOF套利监控基金配置文件说明",
    "",
    "当前配置文件：funds_config.json",
    "这个文件保存原始基金池和用户手动添加的基金。",
    "换电脑时，把 funds_config.json 复制到新电脑安装目录，覆盖同名文件即可。",
    "",
    \`安装目录：\${installDir}\`
  ].join("\\r\\n"),
  "utf8"
);

if (!process.env.LOF_INSTALLER_NO_SHORTCUT) {
  createShortcut(path.join(os.homedir(), "Desktop", "LOF套利监控.lnk"), appExe);
  if (process.env.APPDATA) {
    const startMenuDir = path.join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs");
    fs.mkdirSync(startMenuDir, { recursive: true });
    createShortcut(path.join(startMenuDir, "LOF套利监控.lnk"), appExe);
  }
}

if (!process.env.LOF_INSTALLER_NO_LAUNCH) {
  spawnSync(appExe, { detached: true, stdio: "ignore", windowsHide: true });
}
`;

fs.mkdirSync(dist, { recursive: true });
fs.writeFileSync(path.join(dist, "installer_entry_embedded.js"), source, "utf8");
fs.writeFileSync(
  path.join(dist, "installer-embedded-config.json"),
  JSON.stringify(
    {
      main: path.join(dist, "installer_entry_embedded.js"),
      output: path.join(dist, "installer-embedded-prep.blob"),
      disableExperimentalSEAWarning: true
    },
    null,
    2
  ),
  "utf8"
);

console.log("Embedded installer entry generated.");
