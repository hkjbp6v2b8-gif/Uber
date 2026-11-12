// Usage: node scripts/create-admin.js "Admin" 0500000000 StrongPass123
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

(async () => {
  const [name, phone, password] = process.argv.slice(2);
  if (!name || !phone || !password) { console.log('usage: create-admin <name> <phone> <password>'); process.exit(1); }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await bcrypt.hash(password, 10);
  await pool.query("INSERT INTO users(name,phone,password_hash,role,phone_verified) VALUES($1,$2,$3,'admin',true)", [name, phone, hash]);
  console.log('admin created');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
