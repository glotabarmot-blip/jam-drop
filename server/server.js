require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = 'jamdrop';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Glist228443434322ff';
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_please_32_chars_min';

let db;
let client;

async function connectDB() {
  client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('✅ MongoDB подключена');
}
connectDB().catch(err => { console.error('❌ MongoDB:', err); process.exit(1); });

app.use(express.json());
app.use(cors({ origin: true, credentials: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URL }),
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(passport.initialize());
app.use(passport.session());

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/auth/google/callback'
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = (profile.emails?.[0]?.value || '').toLowerCase();
        if (!email) return done(null, false);
        let user = await db.collection('users').findOne({ googleId: profile.id });
        if (!user) {
          let nick = (profile.displayName || email.split('@')[0]).replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
          if (nick.length < 3) nick = 'user' + Date.now().toString().slice(-6);
          let suffix = 0;
          while (await db.collection('users').findOne({ nick: { $regex: new RegExp('^' + nick + '$', 'i') } })) {
            suffix++;
            nick = nick.slice(0, 16) + suffix;
          }
          const result = await db.collection('users').insertOne({
            googleId: profile.id, email, nick,
            balance: 0, inventory: [], casesOpened: 0, upgrades: 0, upgradesWon: 0,
            usedPromos: [], createdAt: new Date()
          });
          user = await db.collection('users').findOne({ _id: result.insertedId });
        }
        return done(null, user);
      } catch (e) { return done(e); }
    }
  ));
}
passport.serializeUser((user, done) => done(null, user._id.toString()));
passport.deserializeUser(async (id, done) => {
  try { done(null, await db.collection('users').findOne({ _id: new ObjectId(id) })); }
  catch (e) { done(e); }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not logged in' });
  res.json({
    nick: req.user.nick, balance: req.user.balance,
    inventory: req.user.inventory || [], casesOpened: req.user.casesOpened || 0,
    upgrades: req.user.upgrades || 0, upgradesWon: req.user.upgradesWon || 0,
    usedPromos: req.user.usedPromos || []
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { nick, pass } = req.body;
  const clean = String(nick || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  if (clean.length < 3) return res.status(400).json({ error: 'Ник от 3 символов' });
  if (!pass || pass.length < 4) return res.status(400).json({ error: 'Пароль от 4 символов' });
  const exist = await db.collection('users').findOne({ nick: { $regex: new RegExp('^' + clean + '$', 'i') } });
  if (exist) return res.status(400).json({ error: 'Ник занят' });
  const result = await db.collection('users').insertOne({
    nick: clean, pass,
    balance: 0, inventory: [], casesOpened: 0, upgrades: 0, upgradesWon: 0,
    usedPromos: [], createdAt: new Date()
  });
  const user = await db.collection('users').findOne({ _id: result.insertedId });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Ошибка входа' });
    res.json({ nick: user.nick, balance: user.balance });
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { nick, pass } = req.body;
  const clean = String(nick || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  const user = await db.collection('users').findOne({ nick: { $regex: new RegExp('^' + clean + '$', 'i') } });
  if (!user || user.pass !== pass) return res.status(400).json({ error: 'Неверный ник или пароль' });
  req.login(user, err => {
    if (err) return res.status(500).json({ error: 'Ошибка входа' });
    res.json({ nick: user.nick, balance: user.balance });
  });
});

app.post('/api/logout', (req, res) => {
  req.logout(() => res.json({ ok: true }));
});

app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=1' }),
  (req, res) => res.redirect('/')
);

app.post('/api/admin/topup', async (req, res) => {
  const { adminPass, nick, amount } = req.body;
  if (adminPass !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Неверный админ-пароль' });
  const clean = String(nick || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 20);
  const sum = Number(amount);
  if (clean.length < 3) return res.status(400).json({ error: 'Неверный ник' });
  if (!sum || sum <= 0 || !isFinite(sum)) return res.status(400).json({ error: 'Неверная сумма' });

  const player = await db.collection('users').findOne({ nick: { $regex: new RegExp('^' + clean + '$', 'i') } });
  if (!player) return res.status(404).json({ error: `Игрок "${clean}" не найден` });

  await db.collection('users').updateOne({ _id: player._id }, { $inc: { balance: sum } });
  const updated = await db.collection('users').findOne({ _id: player._id });

  res.json({ success: true, nick: updated.nick, before: player.balance, after: updated.balance });
});

app.get('/api/admin/players', async (req, res) => {
  const { adminPass } = req.query;
  if (adminPass !== ADMIN_PASSWORD) return res.status(403).json({ error: 'Нет доступа' });
  const players = await db.collection('users').find({}, { projection: { nick: 1, balance: 1 } }).toArray();
  res.json(players.map(p => ({ nick: p.nick, balance: p.balance })));
});

app.post('/api/state', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'not logged in' });
  const { inventory, casesOpened, upgrades, upgradesWon, usedPromos, balance } = req.body;
  const update = {};
  if (Array.isArray(inventory)) update.inventory = inventory;
  if (typeof casesOpened === 'number') update.casesOpened = casesOpened;
  if (typeof upgrades === 'number') update.upgrades = upgrades;
  if (typeof upgradesWon === 'number') update.upgradesWon = upgradesWon;
  if (Array.isArray(usedPromos)) update.usedPromos = usedPromos;
  if (typeof balance === 'number') update.balance = balance;
  await db.collection('users').updateOne({ _id: req.user._id }, { $set: update });
  res.json({ ok: true });
});

app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.listen(PORT, () => console.log(`🚀 Сервер: http://localhost:${PORT}`));
