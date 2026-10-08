const fs = require('fs');
const readline = require('readline');
const path = require('path');

const logFile = 'C:\\Users\\bexte\\.gemini\\antigravity-ide\\brain\\abee69a6-d031-47c4-b335-9f19d57c31e0\\.system_generated\\logs\\transcript.jsonl';
const rl = readline.createInterface({
  input: fs.createReadStream(logFile)
});

rl.on('line', (line) => {
  try {
    const d = JSON.parse(line);
    if (d.tool_calls) {
      for (const tc of d.tool_calls) {
        if (tc.args && tc.args.TargetFile && tc.args.TargetFile.includes('services')) {
          let target = tc.args.TargetFile.trim().replace(/^["']|["']$/g, '');
          const dir = path.dirname(target);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          let raw = tc.args.CodeContent;
          while (typeof raw === 'string' && (raw.startsWith('"') || raw.startsWith("'"))) {
            try {
              raw = JSON.parse(raw);
            } catch(e) {
              break;
            }
          }
          fs.writeFileSync(target, raw, 'utf8');
          console.log('Restored cleanly:', target);
        }
      }
    }
  } catch (err) {}
});
