const https = require('https');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'OPENROUTER_API_KEY is not configured.' })
    };
  }

  return new Promise((resolve, reject) => {
    const requestData = event.body;
    
    const options = {
      hostname: 'openrouter.ai',
      path: '/api/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Interview Teleprompter'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        let safeBody = body;
        let isError = false;

        // Try to ensure the response is valid JSON. If not safely wrap it.
        try {
            JSON.parse(body);
        } catch (e) {
            safeBody = JSON.stringify({ 
                error: `OpenRouter returned invalid JSON`, 
                detail: body.substring(0, 200) 
            });
            isError = true;
        }

        // If OpenRouter returns 404 (e.g. model not found), ensure we pass it correctly
        if (res.statusCode >= 400 && !isError) {
            // Already JSON, just pass it through
        } else if (res.statusCode >= 400 && isError) {
            // Handled by the catch block above
        }

        resolve({
          statusCode: res.statusCode,
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
        body: JSON.stringify({ error: 'Proxy request failed', detail: e.message })
      });
    });

    req.write(requestData);
    req.end();
  });
};
