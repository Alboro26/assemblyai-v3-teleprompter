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
      body: JSON.stringify({ error: 'ASSEMBLYAI_API_KEY is not configured.' })
    };
  }

  return new Promise((resolve, reject) => {
    // Verified V2 token endpoint (works for v3 websockets)
    const postData = JSON.stringify({ expires_in: 3600 });
    
    const options = {
      hostname: 'api.assemblyai.com',
      path: '/v2/realtime/token',
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        // Log status for internal Netlify debugging
        console.log(`[Token] AssemblyAI response status: ${res.statusCode}`);
        
        resolve({
          statusCode: res.statusCode,
          headers: { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*' 
          },
          body: body
        });
      });
    });

    req.on('error', (e) => {
      console.error('[Token] Network error:', e.message);
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: 'Token request failed', detail: e.message })
      });
    });

    req.write(postData);
    req.end();
  });
};
