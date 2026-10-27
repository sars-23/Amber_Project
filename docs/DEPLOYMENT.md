# Amber: Production Deployment Guide

This guide details the complete production architecture, deployment configuration, and verification procedures for the live Amber application.

---

## 1. Production Architecture Overview

Amber is deployed as a distributed web application across cloud providers:

- **Frontend Application**: [Render Static Site](https://amber-frontend-w78m.onrender.com) (React 19 / TypeScript 6 / Vite 5 / Tailwind CSS 3.4).
- **Backend Service**: [Render Web Service](https://amber-backend-ler4.onrender.com) (Docker container running Eclipse Temurin Java 21 LTS, Spring Boot 3.3, and Alpine FFmpeg).
- **Database Engine**: [Neon Serverless PostgreSQL](https://neon.tech) (PostgreSQL 16 with SSL encryption and versioned Flyway migrations).
- **Repository & CI**: GitHub (`sars-23/Amber_Project` on branch `main`), with automated build and test quality gates via GitHub Actions.

```
                      +---------------------------------------+
                      |       Client Browser / Microphone      |
                      +---------------------------------------+
                                   |                 |
                   HTTPS (Assets)  |                 |  WSS / HTTPS (API)
                                   v                 v
                 +----------------------+   +-----------------------+
                 |  Render Static Site  |   |   Render Web Service  |
                 |   (amber-frontend)   |   |    (amber-backend)    |
                 +----------------------+   +-----------------------+
                                                        |
                                                        | JDBC over TLS (Port 5432)
                                                        v
                                            +-----------------------+
                                            |    Neon PostgreSQL    |
                                            |  (B-Tree Hash Index)  |
                                            +-----------------------+
```

---

## 2. Infrastructure as Code (`render.yaml`)

Both backend and frontend services are defined declaratively in the root [render.yaml](../render.yaml):

```yaml
services:
  - type: web
    name: amber-backend
    runtime: docker
    dockerfilePath: backend/Dockerfile
    dockerContext: backend
    plan: free
    region: oregon
    healthCheckPath: /api/v1/health
    envVars:
      - key: PORT
        value: 10000
      - key: SPRING_DATASOURCE_URL
        sync: false
      - key: SPRING_DATASOURCE_USERNAME
        sync: false
      - key: SPRING_DATASOURCE_PASSWORD
        sync: false
      - key: CORS_ALLOWED_ORIGINS
        value: https://*.onrender.com,https://*.vercel.app,http://localhost:3000,http://localhost:5173
      - key: AMBER_ADMIN_API_KEY
        sync: false
      - key: JAVA_OPTS
        value: -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0

  - type: static
    name: amber-frontend
    buildCommand: npm install && npm run build
    staticPublishPath: dist
    rootDir: frontend
    envVars:
      - key: VITE_API_BASE_URL
        value: https://amber-backend-ler4.onrender.com/api/v1
      - key: VITE_WS_URL
        value: wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

---

## 3. Environment Variables & Secret Provisioning

Sensitive credentials (`sync: false`) are configured privately in the **Render Dashboard** and are never committed to git:

| Variable Name | Service | Purpose | Security Rule |
| :--- | :--- | :--- | :--- |
| `SPRING_DATASOURCE_URL` | `amber-backend` | Neon PostgreSQL pooled JDBC URL (`jdbc:postgresql://<host>/<db>?sslmode=require`) | Set in Render Dashboard (`sync: false`). Never commit passwords. |
| `SPRING_DATASOURCE_USERNAME` | `amber-backend` | Database user account | Set in Render Dashboard (`sync: false`). |
| `SPRING_DATASOURCE_PASSWORD` | `amber-backend` | Database user password | Set in Render Dashboard (`sync: false`). |
| `AMBER_ADMIN_API_KEY` | `amber-backend` | Secret token authorizing `POST /api/v1/songs` and `DELETE /api/v1/songs/{id}` | Set in Render Dashboard (`sync: false`). Backend fails closed if missing. Never expose in frontend bundles. |
| `CORS_ALLOWED_ORIGINS` | `amber-backend` | Allowed browser origins for CORS preflight | Defined in `render.yaml`. Includes `https://*.onrender.com`, `https://*.vercel.app` (retained in deployed configuration), and localhost. |
| `VITE_API_BASE_URL` | `amber-frontend` | Base HTTP endpoint for REST communication | `https://amber-backend-ler4.onrender.com/api/v1` |
| `VITE_WS_URL` | `amber-frontend` | WebSocket endpoint for real-time microphone stream | `wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream` |

---

## 4. Verification & Health Monitoring

### 4.1 Automated Health Probe
The backend exposes a lightweight health endpoint polled by Render's container watchdog:
- **URL**: `GET https://amber-backend-ler4.onrender.com/api/v1/health`
- **Expected Status**: `200 OK`
- **Payload Schema**:
  ```json
  {
    "status": "UP",
    "version": "1.0.0",
    "database": "CONNECTED",
    "sampleRate": 11025,
    "fftSize": 1024,
    "hopSize": 512
  }
  ```

### 4.2 Security Health Probe
Verify that catalog write endpoints enforce authentication:
```bash
# Must return HTTP 401 Unauthorized
curl -i -X DELETE https://amber-backend-ler4.onrender.com/api/v1/songs/999999
```

### 4.3 WebSocket Streaming Probe
Verify that the WebSocket accepts binary audio frames:
```bash
# Connects to wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream
# Accepts 16-bit 11,025 Hz little-endian mono PCM frames
```

---

## 5. Operational Gotchas & Troubleshooting

1. **Render Free-Tier Spin-Down (Cold Starts)**:
   - When inactive for 15 minutes, Render spins down the backend container.
   - The initial request wakes the instance and boots the JVM + Flyway migrations, which takes 30–50 seconds.
   - The frontend displays an ambient connecting status during cold starts.
2. **Microphone Permissions (HTTPS Requirement)**:
   - Modern browsers block `navigator.mediaDevices.getUserMedia` and `AudioWorklet` on unencrypted HTTP connections.
   - Render serves all frontend and backend traffic over TLS (`https://` and `wss://`), satisfying browser security policies.
3. **Reverse Proxy & Client IP Extraction**:
   - Render operates as a reverse proxy in front of the container, appending the connecting client's verified IP to the end of `X-Forwarded-For`.
   - `ClientRateLimiter` parses the rightmost token to prevent header-spoofing attacks against the benchmark rate limits.
4. **Administrative Operations**:
   - Catalogue writes (`POST /api/v1/songs` and `DELETE /api/v1/songs/{id}`) require the `X-Amber-Admin-Key` header matching `AMBER_ADMIN_API_KEY`.
   - The frontend does not persist this secret in browser storage; administrators provide it on-demand within the ingestion modal or deletion confirmation prompt.
