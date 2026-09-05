const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;

// Load variables from a local .env file (if present) into process.env,
// without needing the 'dotenv' package or a manual `export` each time.
// Lines already set in the real environment always win (so hosting-panel
// secrets on a real domain still take priority over a committed .env).
(function loadDotEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
})();

const PORT = Number(process.env.PORT) || 3000;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

function sendJson(response, status, body) {
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'});
  response.end(JSON.stringify(body));
}

function parseModelJson(raw) {
  const text = String(raw || '')
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Groq returned no JSON');
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeResult(result) {
  const limits = [40, 30, 20, 10];
  const values = ['knowledge', 'analysis', 'structure', 'language'].map((key, index) => {
    const value = Number(result?.[key]);
    return Math.max(0, Math.min(limits[index], Number.isFinite(value) ? Math.round(value) : 0));
  });
  return {
    score: values.reduce((sum, value) => sum + value, 0),
    knowledge: values[0],
    analysis: values[1],
    structure: values[2],
    language: values[3],
    feedback: String(result?.feedback || '').slice(0, 1200),
    strengths: Array.isArray(result?.strengths) ? result.strengths.slice(0, 4).map(String) : [],
    improvements: Array.isArray(result?.improvements) ? result.improvements.slice(0, 4).map(String) : []
  };
}

async function callGroq(model, prompt) {
  const apiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 2048,
      response_format: {type: 'json_object'},
      messages: [{role: 'user', content: prompt}]
    })
  });

  if (!apiResponse.ok) {
    let providerMessage = '';
    try {
      const errorBody = await apiResponse.json();
      providerMessage = String(errorBody?.error?.message || '');
    } catch {}
    const error = new Error(`Groq API returned ${apiResponse.status}`);
    error.status = apiResponse.status;
    error.providerMessage = providerMessage;
    throw error;
  }

  const body = await apiResponse.json();
  return body.choices?.[0]?.message?.content || '';
}

async function evaluateAnswer(payload) {
  if (!GROQ_API_KEY) {
    const error = new Error('GROQ_API_KEY is not configured on the server');
    error.status = 503;
    throw error;
  }

  const question = String(payload.question || '').slice(0, 2000);
  const answer = String(payload.answer || '').slice(0, 12000);
  const topic = payload.topic || {};
  const prompt = `You are a careful History of Kazakhstan oral-exam assessor. Evaluate the student's answer to the question using only the supplied syllabus context. Do not invent facts. The score is educational, not an official exam grade.

Question: ${question}
Syllabus topic: ${String(topic.title || '').slice(0, 500)}
Reference period: ${String(topic.period || '').slice(0, 300)}
Key facts: ${(Array.isArray(topic.facts) ? topic.facts : []).join('; ')}
Key dates: ${(Array.isArray(topic.dates) ? topic.dates : []).join('; ')}
Key people/groups: ${(Array.isArray(topic.people) ? topic.people : []).join('; ')}
Key terms: ${(Array.isArray(topic.terms) ? topic.terms : []).join('; ')}
Student answer: ${answer}

Use this rubric and maximums: knowledge/content 40, analysis/understanding 30, structure/logic 20, language/style 10. Return ONLY valid JSON with exactly these keys: score, knowledge, analysis, structure, language, feedback, strengths, improvements. Scores must be integers within their maximums; score must equal their sum. feedback must be a short response in the student's language. strengths and improvements must each be arrays of 2-4 short strings.`;

  let raw = '';
  let lastError = null;
  for (const model of ['openai/gpt-oss-20b', 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b']) {
    try {
      raw = await callGroq(model, prompt);
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (error.status !== 404 && error.status !== 400) throw error;
    }
  }
  if (lastError) throw lastError;
  return normalizeResult(parseModelJson(raw));
}

function serveStatic(request, response) {
  const requested = request.url === '/' ? '/index.html' : request.url.split('?')[0];
  const filePath = path.resolve(ROOT, `.${requested}`);
  const isDotfile = path.basename(filePath).startsWith('.');
  if (isDotfile || !filePath.startsWith(ROOT) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  response.writeHead(200, {'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream'});
  fs.createReadStream(filePath).pipe(response);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 1000000) {
        reject(new Error('Request is too large'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  if (request.method === 'GET' && request.url === '/api/health') {
    sendJson(response, 200, {ok: true, groqConfigured: Boolean(GROQ_API_KEY)});
    return;
  }

  if (request.method === 'POST' && request.url === '/api/evaluate') {
    try {
      const payload = await readBody(request);
      sendJson(response, 200, {result: await evaluateAnswer(payload)});
    } catch (error) {
      const status = error.status || 400;
      console.error('Groq evaluation failed:', error.message, error.providerMessage || '');
      let message = 'Groq could not evaluate this answer.';
      if (status === 503) message = 'GROQ_API_KEY is not loaded by this server. Stop it and start again after exporting the key.';
      else if (status === 400) message = `Groq rejected the request: ${error.providerMessage || 'bad request'}`;
      else if (status === 401 || status === 403) message = 'Groq rejected the API key. Create a new key at console.groq.com and export it before npm start.';
      else if (status === 404) message = 'The Groq model is unavailable for this API key or project.';
      else if (status === 429) message = 'Groq free-tier limit reached. Wait and try again later.';
      else if (status >= 500) message = 'Groq is temporarily unavailable. Try again in a moment.';
      sendJson(response, status, {error: message});
    }
    return;
  }

  if (request.method === 'GET') {
    serveStatic(request, response);
    return;
  }

  sendJson(response, 405, {error: 'Method not allowed'});
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Stop the old server or run PORT=3001 npm start.`);
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`HK6002 exam prep running at http://localhost:${PORT}`);
});