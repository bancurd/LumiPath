import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

type Checkin = {
  date: string;
  learnedWords: number;
  source: 'daily-vocabulary';
};

const app = new Hono();
const checkins = new Map<string, Checkin>();
const port = Number(process.env.LUMIPATH_API_PORT ?? 8938);

const todayKey = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

app.use('/api/*', cors());

app.get('/api/health', (c) =>
  c.json({
    ok: true,
    service: 'lumipath-api',
    storage: 'memory',
  }),
);

app.get('/api/checkins', (c) =>
  c.json({
    checkins: Array.from(checkins.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
  }),
);

app.post('/api/checkins/today', async (c) => {
  const body: { learnedWords?: number } = await c.req
    .json<{ learnedWords?: number }>()
    .catch(() => ({}));
  const date = todayKey();
  const checkin: Checkin = {
    date,
    learnedWords: Math.max(1, Number(body.learnedWords ?? 12)),
    source: 'daily-vocabulary',
  };

  checkins.set(date, checkin);

  return c.json({
    checkin,
    message: 'Daily vocabulary learning completed.',
  });
});

serve(
  {
    fetch: app.fetch,
    port,
    hostname: '127.0.0.1',
  },
  (info) => {
    console.log(`LumiPath API running at http://${info.address}:${info.port}`);
  },
);
