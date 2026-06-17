const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const release = path.join(root, "发布");

fs.mkdirSync(dist, { recursive: true });

fs.writeFileSync(
  path.join(dist, "installer-config.json"),
  JSON.stringify(
    {
      main: path.join(root, "pack_exe", "installer_entry.js"),
      output: path.join(dist, "installer-prep.blob"),
      disableExperimentalSEAWarning: true,
      assets: {
        appExe: path.join(release, "LOF套利监控.exe"),
        fundConfig: path.join(root, "funds_config.json")
      }
    },
    null,
    2
  ),
  "utf8"
);

console.log("Installer config generated.");
