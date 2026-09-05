# HK6002 History of Kazakhstan — Exam Prep

Study site based on the supplied HK6002 syllabus, with secure server-side Gemini assessment for the oral-exam section.

## Run
The Gemini button uses the local `/api/evaluate` endpoint, so run the included Node server:

```bash
npm start
```

Then open `http://localhost:3000`.

Node 18 or newer is required. No npm packages are needed.

## Current build
- Russian / Kazakh language switch with saved preference
- 14 historical course topics from the syllabus
- Topic pages with dates, people, facts, terms and exam-answer guidance
- Practice mode with mandatory topic selection
- Practice questions restricted to the selected topic
- Correct answer position randomized for every question/session
- Syllabus sample exam questions
- Oral Exam Simulator with the 40/30/20/10 rubric
- Optional Gemini evaluation through Google AI Studio's free-tier API
- Flashcards
- Course timeline
- Local learning state persistence via `localStorage`

## Removed from the main navigation
- AI History Tutor
- Progress
- Midterm Prep

## Gemini evaluation

The oral-exam screen now has two evaluation modes:

- **Local evaluation** works offline and keeps the original rubric-based estimate.
- **Gemini evaluation** sends the question, syllabus context, and answer through the server to Google's Gemini API and returns rubric scores, strengths, and improvements.

Set the API key as a server environment secret. Never put it in `app.js`, HTML, Git, or the zip archive:

```bash
GEMINI_API_KEY="your-key" npm start
```

On Replit, add `GEMINI_API_KEY` through the Secrets tool, then run the app. The Google AI Studio free tier is subject to Google's current rate limits.

For local development, create a new key in [Google AI Studio](https://aistudio.google.com/apikey) and set it in your shell:

```bash
export GEMINI_API_KEY="your-key"
npm start
```

If port 3000 is already occupied by an older server:

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
kill <PID>
```

Then start the server again. Alternatively, use another port:

```bash
PORT=3001 npm start
```

Open the URL in your browser (`http://localhost:3000` or `http://localhost:3001`); do not type the URL as a terminal command.

To check whether the running server received the secret, open:

```text
http://localhost:3000/api/health
```

The response must contain `"geminiConfigured":true`. If it says `false`, stop the server with `Control+C`, export the key again, and run `npm start`.
