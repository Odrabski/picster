# Picster — Setup Guide

## Step 1: Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Click **Select a project** (top left) → **New Project**
3. Name it `picster` → **Create**

## Step 2: Enable the Google Photos Library API

1. In your project, go to **APIs & Services → Library**
2. Search for **Google Photos Library API**
3. Click it → **Enable**

## Step 3: Configure the OAuth consent screen

1. Go to **APIs & Services → OAuth consent screen**
2. Choose **External** → **Create**
3. Fill in:
   - App name: `Picster`
   - User support email: your email
   - Developer contact email: your email
4. Click **Save and Continue** through the next screens
5. On the **Scopes** step, click **Add or Remove Scopes** and add:
   - `https://www.googleapis.com/auth/photoslibrary.readonly`
6. On the **Test users** step, add your Google account email
7. Finish and save

## Step 4: Create OAuth credentials

1. Go to **APIs & Services → Credentials**
2. Click **Create Credentials → OAuth client ID**
3. Application type: **Web application**
4. Name: `Picster`
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:3000/auth/google/callback
   ```
6. Click **Create**
7. Copy the **Client ID** and **Client Secret**

## Step 5: Configure the app

```bash
cp .env.example .env
```

Open `.env` and paste your credentials:

```
GOOGLE_CLIENT_ID=paste_your_client_id_here
GOOGLE_CLIENT_SECRET=paste_your_client_secret_here
SESSION_SECRET=anyrandomstring123
PORT=3000
```

## Step 6: Install and run

```bash
npm install
npm start
```

Open http://localhost:3000 — click **Sign in with Google** and you're done.

---

**Note:** While the app is in "Testing" mode (default), only the Google accounts you added as test users can log in. To open it to everyone, publish the app from the OAuth consent screen (requires Google's verification for the Photos scope).
