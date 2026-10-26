# Amber: Production Deployment Guide

This guide details the step-by-step process for deploying Amber to a real, public cloud infrastructure:
- **Frontend**: Vercel (React 19 / TypeScript / Vite)
- **Backend**: Render Web Service (Docker container with Java 21, Spring Boot 3, and FFmpeg)
- **Database**: Neon Serverless PostgreSQL (or Render PostgreSQL)
- **Repository**: GitHub (`https://github.com/sars-23/Amber_Project`)

---

## 1. Architecture & Network Flow

```
[ User Browser / Mic ]
        |
        +---> HTTPS: https://amber.vercel.app  (Vercel Edge CDN)
        |
        +---> HTTPS API: https://amber-backend.onrender.com/api/v1  (Render Docker)
        |
        +---> WSS: wss://amber-backend.onrender.com/api/v1/ws/audio-stream  (Render Docker)
                                     |
                                     v
                       [ Neon PostgreSQL / Render DB ]
                       (SSL Encrypted - Port 5432)
```

---

## 2. PostgreSQL Setup (Neon Serverless or Render PostgreSQL)

### Option A: Neon Serverless PostgreSQL (Recommended)
Neon offers a fast, serverless PostgreSQL with generous free compute and storage that does not expire:
1. Go to [neon.tech](https://neon.tech) and create an account.
2. Create a new project named **amber**.
3. In your Neon dashboard, copy your connection details:
   - Select **Pooled connection** or **Direct connection**.
   - Note the Host (`ep-something.aws.neon.tech`), Database (`amber` or `neondb`), User, and Password.
4. Construct your Spring Boot JDBC connection URL:
   ```
   jdbc:postgresql://<neon-host>/<database>?sslmode=require
   ```
   Example:
   ```
   jdbc:postgresql://ep-silent-wave-12345.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
*(Flyway will automatically create `songs`, `fingerprints`, and indexes upon first backend startup).*

### Option B: Render Managed PostgreSQL
1. On [dashboard.render.com](https://dashboard.render.com), click **New +** -> **PostgreSQL**.
2. Name: `amber-db`, Database: `amber`, User: `amber_user`.
3. Plan: **Free**.
4. Once provisioned, copy the **Internal Database URL** (if backend is on Render) or **External Database URL**. Prepend `jdbc:` to the URL:
   ```
   jdbc:postgresql://amber-db-xxx.render.com/amber?sslmode=require
   ```

---

## 3. Backend Deployment (Render Web Service)

Amber requires FFmpeg for decoding MP3, OGG, and M4A audio. The repository provides a multi-stage `backend/Dockerfile` that installs Alpine Linux, FFmpeg, and Eclipse Temurin Java 21.

### Step-by-Step Setup on Render:
1. Go to [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository: `sars-23/Amber_Project`.
4. Configure service details:
   - **Name**: `amber-backend`
   - **Region**: Choose closest to you (e.g. `Oregon (US West)` or `Frankfurt (EU)`)
   - **Branch**: `main`
   - **Root Directory**: Leave blank (or `backend` if deploying only backend directory)
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `backend/Dockerfile`
   - **Docker Build Context**: `backend`
   - **Instance Type**: **Free** (or Starter for 0 cold-starts)
5. Set **Health Check Path**:
   ```
   /api/v1/health
   ```
6. Add **Environment Variables**:

| Variable Name | Value / Description | Required? |
|---|---|---|
| `PORT` | `10000` (Render defaults to 10000) | Automatic |
| `SPRING_DATASOURCE_URL` | `jdbc:postgresql://<host>/<db>?sslmode=require` | **Yes** |
| `SPRING_DATASOURCE_USERNAME` | `<database-username>` | **Yes** |
| `SPRING_DATASOURCE_PASSWORD` | `<database-password>` | **Yes** |
| `CORS_ALLOWED_ORIGINS` | `https://*.vercel.app,http://localhost:3000,http://localhost:5173` | **Yes** |
| `JAVA_OPTS` | `-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0` | **Recommended** |
| `AMBER_FFMPEG_PATH` | `ffmpeg` | Default |

7. Click **Create Web Service**.
8. Render will pull Maven dependencies, compile the JAR, build the Alpine image with FFmpeg, and launch the service.
9. Note your backend URL: `https://amber-backend.onrender.com`.

---

## 4. Frontend Deployment (Vercel)

The frontend is a Vite + React 19 application located in the `frontend/` directory.

### Step-by-Step Setup on Vercel:
1. Go to [vercel.com](https://vercel.com) and click **Add New...** -> **Project**.
2. Import the GitHub repository: `sars-23/Amber_Project`.
3. In **Project Settings**:
   - **Framework Preset**: `Vite`
   - **Root Directory**: Click *Edit* and select **`frontend`**
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Install Command**: `npm install`
4. Expand **Environment Variables** and add:

| Variable Name | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://amber-backend.onrender.com/api/v1` |
| `VITE_WS_URL` | `wss://amber-backend.onrender.com/api/v1/ws/audio-stream` |

*(Note: If `VITE_WS_URL` is omitted, the frontend automatically derives `wss://...` from `VITE_API_BASE_URL`).*

5. Click **Deploy**.
6. When deployment finishes, Vercel gives you your production URL (e.g. `https://amber.vercel.app`).
7. Update `CORS_ALLOWED_ORIGINS` on Render if you use a custom domain (e.g., `https://mycustomdomain.com,https://*.vercel.app`).

---

## 5. Live Post-Deployment Verification Checklist

Once both services are active, perform these live checks in your browser:

### 1. Backend Health Check
- Open `https://<your-render-backend>.onrender.com/api/v1/health` in a browser.
- Expect `200 OK` with JSON:
  ```json
  {"status":"UP","version":"1.0.0","database":"CONNECTED","sampleRate":11025,"fftSize":1024,"hopSize":512}
  ```

### 2. Frontend Connectivity
- Open `https://<your-vercel-domain>.vercel.app`.
- The header System Status badge should show a green indicator with **System Online (v1.0.0)**.
- The Engine Stats bar should display `0 Tracks Indexed`, `0 Fingerprints`, and database status.

### 3. Song Upload & Indexing
- Go to the **Upload & Index Track** tab.
- Upload an audio file (`.wav`, `.mp3`, `.m4a`).
- Enter Title and Artist (e.g., "Song Test" / "Artist Test") and click **Index Track**.
- Verify:
  - Progress bar reaches 100%.
  - Success alert displays the generated fingerprint count (e.g. `~150-300 fingerprints/sec`).
  - The song appears in the **Indexed Library** table with its duration and fingerprint count.

### 4. Audio Clip Search & Matching
- Go to the **Search & Identify** tab.
- Upload a 5–10 second excerpt of the indexed audio (or recording with background noise).
- Click **Identify Audio**.
- Verify:
  - Match card appears displaying the matched song, artist, and **Offset Alignment (ms)**.
  - Confidence rating is displayed (e.g., 90–100%).
  - Latency is under 50ms.

### 5. Live Microphone Recognition (WebSockets & HTTPS)
- Open the application on a device with a microphone.
- Go to the **Live Search** tab.
- Click **Start Live Search**.
- When prompted by the browser, click **Allow** for microphone permissions.
- Verify:
  - Status shows **Connected & Streaming**.
  - The live oscilloscope waveform animates in real-time as you speak or play audio.
  - Play the indexed track in the room: within 3-4 seconds, the match card appears with the detected track title and real-time confidence.
  - Click **Stop Listening** to cleanly close the WebSocket and audio track.

---

## 6. Production Gotchas & Solutions

1. **Render Free Tier Cold Starts**:
   - Render's free tier spins down after 15 minutes of inactivity. The first request after sleep may take ~30–50 seconds to boot the JVM and Flyway migrations.
   - The frontend gracefully displays a connecting status while the backend spins up.
2. **Microphone Permissions (HTTPS Requirement)**:
   - Modern browsers (Chrome, Safari, Firefox, Edge) block `navigator.mediaDevices.getUserMedia` on non-secure origins.
   - Vercel serves HTTPS by default. If testing on a private IP or custom domain without SSL, microphone recognition is disabled by browser security policies.
3. **CORS Headers**:
   - Spring Boot is configured with `allowedOriginPatterns` to accept all `https://*.vercel.app` domains, including preview deployments and branches.
4. **WebSocket Headers behind Render Proxy**:
   - Render's edge automatically handles HTTP `Upgrade: websocket` requests. No special proxy settings are required on Render.
