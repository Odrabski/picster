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
  maxAge: 7 * 24 * 60 * 60 * 1000,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// cookie-session compatibility shim for passport
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
    'https://www.googleapis.com/auth/drive.readonly',
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

app.get('/api/random-photo', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const response = await axios.get(
      'https://www.googleapis.com/drive/v3/files',
      {
        headers: { Authorization: `Bearer ${req.user.accessToken}` },
        params: {
          q: "mimeType contains 'image/' and trashed = false",
          pageSize: 100,
          fields: 'files(id,name,thumbnailLink,mimeType)',
          orderBy: 'modifiedTime desc',
        },
      }
    );

    const items = response.data.files || [];

    if (items.length === 0) {
      return res.status(404).json({ error: 'No photos found in your Google Drive' });
    }

    const item = items[Math.floor(Math.random() * items.length)];
    const thumbnail = item.thumbnailLink?.replace(/=s\d+$/, '=s1600') || null;

    res.json({
      url: thumbnail,
      fileId: item.id,
      filename: item.name,
    });
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      return res.status(401).json({ error: 'Session expired, please log in again' });
    }
    const detail = err.response?.data || err.message;
    console.error('Drive API error:', detail);
    res.status(500).json({ error: 'Failed to fetch photos', detail });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Picster running at http://localhost:${PORT}`);
});
