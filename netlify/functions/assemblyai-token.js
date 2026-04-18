const https = require('https');

exports.handler = async (event, context) => {
  // Support both GET and POST
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ASSEMBLYAI_API_KEY is not configured.' })
    };
  }

  return new Promise((resolve, reject) => {
    // V3 Token Endpoint - this returns proper JSON errors when keys are invalid
    const queryParams = '?expires_in_seconds=600';
    
    const options = {
      hostname: 'streaming.assemblyai.com',
      path: '/v3/token' + queryParams,
      method: 'GET',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        // We MUST return JSON, even if AssemblyAI returns raw text like "Not found"
        // so the frontend doesn't crash on res.json()
        let safeBody = body;
        try {
          JSON.parse(body); // Check if it's already JSON
        } catch (e) {
          // If AssemblyAI returned weird HTML/text, wrap it in JSON!
          safeBody = JSON.stringify({ error: `AssemblyAI Error ${res.statusCode}`, raw_response: body.substring(0,200) });
        }

        resolve({
          statusCode: res.statusCode === 404 && body === 'Not found' ? 401 : res.statusCode, // Coerce weird 404s to 401 Unauthorized
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*' 
          },
          body: safeBody
        });
      });
    });

    req.on('error', (e) => {
      resolve({
        statusCode: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Token request network failed', detail: e.message })
      });
    });

    req.end(); // GET req doesn't need write()
  });
};
