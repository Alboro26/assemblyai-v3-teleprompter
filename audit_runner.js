const fs = require('fs');
const https = require('https');

// Load API Key
const env = fs.readFileSync('.env', 'utf8');
const key = env.match(/DEEPSEEK_API_KEY=(.*)/)[1].trim();

// Load Context Files
const storageService = fs.readFileSync('js/services/StorageService.js', 'utf8');
const aiJs = fs.readFileSync('js/ai.js', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');

const prompt = `You are a senior software architect. Audit the following project files for bugs, security issues, and performance bottlenecks after our recent migration to a JSON-based StorageService.

Key areas to check:
1. Is the type coercion in StorageService.get robust enough for all edge cases (nulls, empty strings, legacy data)?
2. Are there race conditions in ai.js during the syncModels() process now that it uses StorageService?
3. Is the Content Security Policy (CSP) in index.html too restrictive or too loose for a PWA?

Files:
--- StorageService.js ---
${storageService}

--- ai.js (Partial) ---
${aiJs.substring(0, 5000)}

--- index.html ---
${indexHtml}
`;

const data = JSON.stringify({
    model: "deepseek-reasoner",
    messages: [{ role: "user", content: prompt }],
    stream: false
});

const options = {
    hostname: 'api.deepseek.com',
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(data)
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log(body);
        process.exit(0);
    });
});

req.on('error', (e) => {
    console.error(e);
    process.exit(1);
});

req.write(data);
req.end();
