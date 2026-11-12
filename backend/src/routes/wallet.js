const router = require('express').Router();
const db = require('../config/db');
const { auth } = require('../middleware/auth');

router.use(auth());

router.get('/', async (req, res) => {
  const { rows: [u] } = await db.query('SELECT wallet_balance FROM users WHERE id=$1', [req.user.id]);
  const { rows } = await db.query('SELECT * FROM wallet_transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
  res.json({ balance: u.wallet_balance, transactions: rows });
});

// DEV STUB: credits the wallet without charging anything.
// For production replace with a payment gateway (Stripe / local gateway) and credit on its webhook.
router.post('/topup', async (req, res) => {
  if (process.env.NODE_ENV === 'production')
    return res.status(501).json({ error: 'connect a payment gateway before enabling top-ups' });
  const amount = Number(req.body?.amount);
  if (!(amount > 0 && amount <= 1000)) return res.status(400).json({ error: 'amount must be between 0 and 1000' });
  await db.query('UPDATE users SET wallet_balance = wallet_balance + $1 WHERE id=$2', [amount, req.user.id]);
  await db.query("INSERT INTO wallet_transactions(user_id,amount,kind) VALUES($1,$2,'topup')", [req.user.id, amount]);
  res.json({ ok: true });
});

module.exports = router;
