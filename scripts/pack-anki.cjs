const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root, 'plugins/anki-japanese/software-plugin.json'), 'utf8')).version;
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
const output = path.join(root, 'release', `DaFeiYu-Anki-Japanese-${version}.zip`);
// 固定仓库路径，并用 PowerShell 单引号转义；不拼接用户输入。
const quote = s => "'" + s.replaceAll("'", "''") + "'";
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -LiteralPath ${quote(path.join(root, 'plugins/anki-japanese'))} -DestinationPath ${quote(output)} -Force`]);
const sum = crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
fs.writeFileSync(`${output}.sha256`, `${sum}  ${path.basename(output)}\n`); console.log(output, sum);
