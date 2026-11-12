require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const redis = require('./config/redis');

for (const k of ['DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
  if (!process.env[k]) { console.error(`Missing env var ${k}`); process.exit(1); }
}

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(rateLimit({ windowMs: 60_000, max: 300 }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);

app.get('/health', (_req, res) => res.json({ ok: true }));
app.use('/auth', require('./routes/auth'));
app.use('/rides', require('./routes/rides'));
app.use('/drivers', require('./routes/drivers'));
app.use('/wallet', require('./routes/wallet'));
app.use('/admin', require('./routes/admin'));

// async route handler errors (Express 4 does not catch them by itself)
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'server error' }); });

(async () => {
  await redis.connect();
  require('./sockets')(io);
  const port = process.env.PORT || 3000;
  server.listen(port, () => console.log(`API on :${port}`));
})();
