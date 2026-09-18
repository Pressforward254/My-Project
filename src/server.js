import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';

import { authRouter } from './routes/auth.js';
import { centersRouter } from './routes/centers.js';
import { classesRouter } from './routes/classes.js';
import { subjectsRouter } from './routes/subjects.js';
import { teachersRouter } from './routes/teachers.js';
import { studentsRouter } from './routes/students.js';
import { examsRouter } from './routes/exams.js';
import { marksRouter } from './routes/marks.js';
import { remarksRouter } from './routes/remarks.js';
import { resultsRouter } from './routes/results.js';
import { editRequestsRouter } from './routes/editRequests.js';
import { reportCardRouter } from './routes/reportCard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Safety net: an error thrown inside an async Express route handler that
// isn't wrapped (see lib/asyncHandler.js — every route below is wrapped, but
// this is a second line of defense for anything that slips through, now or
// in a future change) becomes an "unhandled rejection." In Node, that can
// terminate the entire process by default — turning one bad request into
// total downtime (a 502) for every user until the platform restarts it.
// Logging it here instead keeps the process, and everyone else's requests,
// alive.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (recovered, process kept running):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (recovered, process kept running):', err);
});

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/centers', centersRouter);
app.use('/classes', classesRouter);
app.use('/subjects', subjectsRouter);
app.use('/teachers', teachersRouter);
app.use('/students', studentsRouter);
app.use('/exams', examsRouter);
app.use('/marks', marksRouter);
app.use('/remarks', remarksRouter);
app.use('/results', resultsRouter);
app.use('/edit-requests', editRequestsRouter);
app.use('/report-card', reportCardRouter);

// The frontend (public/index.html) is served by this same app — one service,
// one URL, no separate static host and no CORS setup needed. API routes are
// registered above this, so they always take priority over the static file.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Centralized error handler — keeps internal error detail out of API responses.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3001;
app.listen(port, () => console.log(`MOHI backend listening on :${port}`));
