const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

fs.mkdirSync(dist, { recursive: true });

let server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const html = JSON.stringify(fs.readFileSync(path.join(root, "lof_viewer.html"), "utf8"));

server = server.replace(
  "const state = {",
  `const VIEWER_HTML = ${html};\n\nconst state = {`
);
server = server.replace(
  'res.end(fs.readFileSync(path.join(APP_DIR, "lof_viewer.html"), "utf8"));',
  "res.end(VIEWER_HTML);"
);

fs.writeFileSync(path.join(dist, "sea_entry.js"), server, "utf8");
fs.writeFileSync(
  path.join(dist, "sea-config.json"),
  JSON.stringify(
    {
      main: path.join(dist, "sea_entry.js"),
      output: path.join(dist, "sea-prep.blob"),
      disableExperimentalSEAWarning: true
    },
    null,
    2
  ),
  "utf8"
);

console.log("SEA entry generated.");
