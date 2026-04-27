/**
 * scripts/deepseek-audit.js
 * Automates codebase auditing using NVIDIA's DeepSeek API.
 * Uses native 'https' to avoid fetch/stream issues on Windows.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let value = parts.slice(1).join('=').trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        process.env[key] = value;
      }
    });
  }
}

loadEnv();

const API_KEY = process.env.NVIDIA_API_KEY;
const DEFAULT_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-ai/deepseek-v4-pro';
const API_URL = 'integrate.api.nvidia.com';
const API_PATH = '/v1/chat/completions';

const IGNORE_LIST = ['.env', '.git', 'node_modules', 'models.json', 'package-lock.json', '.netlify'];
const ALLOWED_EXTENSIONS = ['.js', '.css', '.html', '.md'];

const GROUPS = {
  frontend: ['index.html', 'css/app.css', 'js/ui.js'],
  services: ['js/ai.js', 'js/audio.js', 'js/camera.js', 'js/services/Constants.js', 'js/audio-worklet-processor.js'],
  infra: ['service-worker.js', 'netlify.toml', 'manifest.json', 'offline.html']
};

async function performAudit() {
  const args = process.argv.slice(2);
  const isBundle = args.includes('--bundle');
  
  const modelIdx = args.indexOf('--model');
  let modelOverride = null;
  if (modelIdx !== -1 && args[modelIdx + 1]) {
    const requested = args[modelIdx + 1];
    if (requested.toLowerCase() === 'flash') modelOverride = 'deepseek-ai/deepseek-v4-flash';
    else if (requested.toLowerCase() === 'pro') modelOverride = 'deepseek-ai/deepseek-v4-pro';
    else modelOverride = requested;
  }

  const groupIdx = args.indexOf('--group');
  let groupName = null;
  if (groupIdx !== -1 && args[groupIdx + 1]) {
    groupName = args[groupIdx + 1].toLowerCase();
  }

  const MODEL = modelOverride || DEFAULT_MODEL;
  let contentToAnalyze = '';
  let sourceLabel = '';

  if (groupName && GROUPS[groupName]) {
    console.log(`[DeepSeek-Audit] 📂 Group Mode: ${groupName}`);
    contentToAnalyze = GROUPS[groupName]
      .filter(f => fs.existsSync(path.join(process.cwd(), f)))
      .map(f => `--- FILE: ${f} ---\n${fs.readFileSync(path.join(process.cwd(), f), 'utf8')}\n`)
      .join('\n');
    sourceLabel = `Group: ${groupName}`;
  } else if (isBundle) {
    const files = getAllFiles(process.cwd());
    contentToAnalyze = files.map(f => `--- FILE: ${f.relative} ---\n${f.content}\n`).join('\n');
    sourceLabel = 'Full Codebase Bundle';
  } else {
    const targetFile = args.find((arg, i) => {
      if (arg.startsWith('--')) return false;
      if (modelIdx !== -1 && (i === modelIdx || i === modelIdx + 1)) return false;
      if (groupIdx !== -1 && (i === groupIdx || i === groupIdx + 1)) return false;
      return true;
    }) || 'bug_report.md';
    contentToAnalyze = fs.readFileSync(path.join(process.cwd(), targetFile), 'utf8');
    sourceLabel = targetFile;
  }

  console.log(`[DeepSeek-Audit] 📡 Sending ${sourceLabel} to NVIDIA (${MODEL})...`);

  const postData = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: 'You are a Senior Software Engineer and Security Auditor. Analyze the provided codebase. Provide a structured report in Markdown.' },
      { role: 'user', content: `Please audit the following ${sourceLabel}:\n\n${contentToAnalyze}` }
    ],
    temperature: 0.2,
    top_p: 0.7,
    max_tokens: 16384,
    stream: true,
    chat_template_kwargs: { thinking: false }
  });

  let reportFilename = 'DEEPSEEK_AUDIT_REPORT';
  if (groupName) reportFilename = `AUDIT_${groupName.toUpperCase()}`;
  const modelTag = MODEL.includes('flash') ? '_FLASH' : '_PRO';
  reportFilename += `${modelTag}.md`;
  const reportPath = path.join(process.cwd(), reportFilename);
  const fileStream = fs.createWriteStream(reportPath);

  const options = {
    hostname: API_URL,
    path: API_PATH,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Length': Buffer.byteLength(postData),
      'User-Agent': 'curl/8.18.0' // Mimic curl
    },
    rejectUnauthorized: false // Bypass cert issues if any
  };

  const req = https.request(options, (res) => {
    console.log(`[DeepSeek-Audit] Status: ${res.statusCode}`);
    console.log(`[DeepSeek-Audit] Headers: ${JSON.stringify(res.headers)}`);
    res.on('data', (chunk) => {
      console.log(`[DeepSeek-Audit] Chunk: ${chunk.length} bytes`);
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.replace('data: ', '').trim();
          if (data === '[DONE]') continue;
          try {
            const json = JSON.parse(data);
            const content = json.choices[0]?.delta?.content || '';
            if (content) {
              fileStream.write(content);
              process.stdout.write(content);
            }
          } catch (e) {}
        }
      }
    });
    res.on('end', () => {
      fileStream.end();
      console.log(`\n[DeepSeek-Audit] ✅ Done: ${reportFilename}`);
    });
  });

  req.on('error', (e) => console.error(`[DeepSeek-Audit] ❌ Error: ${e.message}`));
  req.write(postData);
  req.end();
}

function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);
  files.forEach(file => {
    const fullPath = path.join(dirPath, file);
    const relativePath = path.relative(process.cwd(), fullPath);
    if (IGNORE_LIST.some(ignore => relativePath.includes(ignore))) return;
    if (file.startsWith('.')) return; 
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      const ext = path.extname(file);
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        arrayOfFiles.push({ relative: relativePath, content: fs.readFileSync(fullPath, 'utf8') });
      }
    }
  });
  return arrayOfFiles;
}

performAudit();
