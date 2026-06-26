require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const axios = require('axios');
const path = require('path');

const app = express();

app.set('trust proxy', 1);

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
    hasSession: !!req.session.pickerSessionId,
  });
});

// Create a new picker session
app.post('/api/picker/create', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const response = await axios.post(
      'https://photospicker.googleapis.com/v1/sessions',
      {},
      { headers: { Authorization: `Bearer ${req.user.accessToken}` } }
    );
    req.session.pickerSessionId = response.data.id;
    res.json({ pickerUri: response.data.pickerUri });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// Check if user has finished picking
app.get('/api/picker/status', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.session.pickerSessionId) return res.json({ ready: false, noSession: true });

  try {
    const response = await axios.get(
      `https://photospicker.googleapis.com/v1/sessions/${req.session.pickerSessionId}`,
      { headers: { Authorization: `Bearer ${req.user.accessToken}` } }
    );
    res.json({ ready: !!response.data.mediaItemsSet });
  } catch (err) {
    req.session.pickerSessionId = null;
    res.json({ ready: false, noSession: true });
  }
});

// Get a random photo from the picker session
app.get('/api/random-photo', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.session.pickerSessionId) {
    return res.status(404).json({ error: 'No photos selected yet' });
  }

  try {
    const response = await axios.get(
      'https://photospicker.googleapis.com/v1/mediaItems',
      {
        headers: { Authorization: `Bearer ${req.user.accessToken}` },
        params: { sessionId: req.session.pickerSessionId, pageSize: 100 },
      }
    );

    const items = (response.data.mediaItems || []).filter(
      (item) => item.type === 'PHOTO'
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'No photos in your selection' });
    }

    const item = items[Math.floor(Math.random() * items.length)];
    res.json({
      url: `${item.mediaFile.baseUrl}=w1400-h1000`,
      filename: item.mediaFile.filename || '',
    });
  } catch (err) {
    const detail = err.response?.data || err.message;
    console.error('Picker API error:', detail);
    res.status(500).json({ error: 'Failed to fetch photos', detail });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Picster running at http://localhost:${PORT}`);
});
