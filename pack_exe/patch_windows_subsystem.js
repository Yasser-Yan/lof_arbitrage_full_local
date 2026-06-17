const fs = require("fs");

const exe = process.argv[2];
if (!exe) {
  console.error("Usage: node patch_windows_subsystem.js <exe>");
  process.exit(1);
}

const buf = fs.readFileSync(exe);
if (buf.readUInt16LE(0) !== 0x5a4d) {
  throw new Error("Not an MZ executable");
}

const peOffset = buf.readUInt32LE(0x3c);
if (buf.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
  throw new Error("Not a PE executable");
}

const optionalHeaderOffset = peOffset + 24;
const magic = buf.readUInt16LE(optionalHeaderOffset);
if (magic !== 0x10b && magic !== 0x20b) {
  throw new Error("Unsupported PE optional header");
}

// IMAGE_OPTIONAL_HEADER.Subsystem: 2 = Windows GUI, 3 = Windows CUI.
const subsystemOffset = optionalHeaderOffset + 68;
buf.writeUInt16LE(2, subsystemOffset);
fs.writeFileSync(exe, buf);

console.log("Patched executable subsystem to Windows GUI.");
