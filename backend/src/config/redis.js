const { createClient } = require('redis');
const client = createClient({ url: process.env.REDIS_URL });
client.on('error', (e) => console.error('Redis error:', e.message));
module.exports = client;
