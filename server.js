require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const axios = require('axios');
const path = require('path');

const app = express();

app.set('trust proxy', 1);
app.use(express.json());

app.use(cookieSession({
  name: 'picster',
  secret: process.env.SESSION_SECRET || 'picster-dev-secret',
  maxAge: 30 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

app.use((req, _res, next) => {
  if (req.session && !req.session.regenerate) {
    req.session.regenerate = (cb) => cb();
    req.session.save = (cb) => cb();
  }
  next();
});

app.use(passport.initialize());
app.use(passport.session());

passport.use(new GoogleStrategy(
  {
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.APP_URL
      ? `${process.env.APP_URL}/auth/google/callback`
      : '/auth/google/callback',
  },
  (accessToken, refreshToken, profile, done) => {
    done(null, { profile, accessToken });
  }
));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/auth/google', passport.authenticate('google', {
  scope: [
    'profile',
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  ],
  accessType: 'offline',
  prompt: 'consent',
}));

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth' }),
  (req, res) => res.redirect('/')
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => res.redirect('/'));
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    name: req.user.profile.displayName,
    photo: req.user.profile.photos?.[0]?.value,
  });
});

// People CRUD
app.get('/api/people', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ people: req.session.people || [] });
});

app.post('/api/people', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { name, sessionId, previewUrl } = req.body;
  if (!name || !sessionId) return res.status(400).json({ error: 'Missing name or sessionId' });
  const people = req.session.people || [];
  people.push({ name, sessionId, previewUrl: previewUrl || null });
  req.session.people = people;
  res.json({ ok: true });
});

app.delete('/api/people/:index', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const people = req.session.people || [];
  const i = parseInt(req.params.index);
  if (isNaN(i) || i < 0 || i >= people.length) return res.status(404).json({ error: 'Not found' });
  people.splice(i, 1);
  req.session.people = people;
  res.json({ ok: true });
});

// Picker session
app.post('/api/picker/create', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const response = await axios.post(
      'https://photospicker.googleapis.com/v1/sessions',
      {},
      { headers: { Authorization: `Bearer ${req.user.accessToken}` } }
    );
    res.json({ sessionId: response.data.id, pickerUri: response.data.pickerUri });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

app.get('/api/picker/status', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
  try {
    const response = await axios.get(
      `https://photospicker.googleapis.com/v1/sessions/${sessionId}`,
      { headers: { Authorization: `Bearer ${req.user.accessToken}` } }
    );
    res.json({ ready: !!response.data.mediaItemsSet });
  } catch {
    res.json({ ready: false });
  }
});

// Random photo — picks item, then proxies the image bytes with auth header
app.get('/api/random-photo', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  const { sessionId } = req.query;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
  try {
    const listRes = await axios.get(
      'https://photospicker.googleapis.com/v1/mediaItems',
      {
        headers: { Authorization: `Bearer ${req.user.accessToken}` },
        params: { sessionId, pageSize: 100 },
      }
    );
    const items = (listRes.data.mediaItems || []).filter(i => i.type === 'PHOTO');
    if (items.length === 0) return res.status(404).json({ error: 'No photos in this selection' });
    const item = items[Math.floor(Math.random() * items.length)];
    const imageUrl = `${item.mediaFile.baseUrl}=w1400-h1000`;

    const imgRes = await axios.get(imageUrl, {
      headers: { Authorization: `Bearer ${req.user.accessToken}` },
      responseType: 'arraybuffer',
    });

    res.set('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
    res.set('Cache-Control', 'private, max-age=1800');
    res.set('X-Filename', encodeURIComponent(item.mediaFile.filename || ''));
    res.send(Buffer.from(imgRes.data));
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Photo fetch error:', detail);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to fetch photo', detail });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Picster running at http://localhost:${PORT}`);
});
