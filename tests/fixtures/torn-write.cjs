// Kills one child process half way through its first write into a closure's snapshot folder,
// the way a Ctrl+C or a harness timeout would: the bytes that reached the disk stay there.
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const write = fs.writeFileSync;
fs.writeFileSync = function torn(file, data, ...rest) {
  if (typeof file === 'string' && /[\\/]\.spectree[\\/]closure[\\/][^\\/]+[\\/]/.test(file)) {
    const text = String(data);
    write.call(fs, file, text.slice(0, Math.floor(text.length / 2)), ...rest);
    process.exit(137);
  }
  return write.call(fs, file, data, ...rest);
};
syncBuiltinESMExports();
