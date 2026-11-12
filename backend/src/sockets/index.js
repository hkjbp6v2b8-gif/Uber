const jwt = require('jsonwebtoken');
const db = require('../config/db');
const redis = require('../config/redis');
const M = require('../services/matching');

module.exports = (io) => {
  io.use((socket, next) => {
    try {
      socket.user = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);
      next();
    } catch { next(new Error('unauthorized')); }
  });

  io.on('connection', (socket) => {
    const me = socket.user;
    socket.join(`user:${me.id}`);

    socket.on('ride:join', async (rideId) => {
      const { rows } = await db.query('SELECT 1 FROM rides WHERE id=$1 AND (rider_id=$2 OR driver_id=$2)', [rideId, me.id]).catch(() => ({ rows: [] }));
      if (rows.length) socket.join(`ride:${rideId}`);
    });

    // driver sends position every few seconds
    socket.on('driver:location', async ({ lat, lng, rideId } = {}) => {
      if (me.role !== 'driver' || typeof lat !== 'number' || typeof lng !== 'number') return;
      await redis.set(`driver:pos:${me.id}`, JSON.stringify({ lat, lng }), { EX: 300 });
      if (rideId) {
        if (socket.rooms.has(`ride:${rideId}`)) io.to(`ride:${rideId}`).emit('ride:driver_location', { rideId, lat, lng });
        return;
      }
      if (await M.isOnline(me.id)) await M.setOnline(me.id, lat, lng);
    });
  });
};
