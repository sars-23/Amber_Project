# Amber: Production Deployment & Operations Guide

This guide details the complete production deployment architecture, infrastructure configuration, environment variables, and verification procedures for the live Amber application.

---

## 1. Production Architecture Overview

Amber is deployed as a cloud-native distributed application:

- **Frontend Static Site**: [Render Static Site](https://amber-frontend-w78m.onrender.com) (`amber-frontend-w78m`).
- **Backend Web Service**: [Render Web Service](https://amber-backend-ler4.onrender.com) (`amber-backend-ler4`), running Dockerized Java 21 LTS with Spring Boot 3.3.4 and Alpine FFmpeg.
- **Database Engine**: [Neon Serverless PostgreSQL](https://neon.tech) (PostgreSQL 16 with SSL encryption, HikariCP pooling, and Flyway versioned migrations).
- **Continuous Integration**: GitHub Actions (`sars-23/Amber_Project` on branch `main`).

```mermaid
flowchart TD
    Client["User Browser / Physical Microphone\n(Web Audio API & AudioWorklet)"]

    subgraph Edge["Render Cloud Edge (Oregon Region)"]
        FrontendSite["amber-frontend (Static Site)\nhttps://amber-frontend-w78m.onrender.com"]
        BackendService["amber-backend (Web Service Container)\nhttps://amber-backend-ler4.onrender.com"]
    end

    subgraph Database["Neon Serverless PostgreSQL (PostgreSQL 16)"]
        NeonDB[("Primary Database\n(35 Tracks, 3.32M Fingerprints\nsnapshot dated 2026-10-31)")]
        BTreeIndex["Composite B-Tree Index\nidx_fingerprints_hash_song"]
    end

    Client -->|HTTPS (Static Assets)| FrontendSite
    Client -->|HTTPS REST API| BackendService
    Client -->|WSS Binary PCM Frames| BackendService
    BackendService -->|TLS Encrypted JDBC (Port 5432)| NeonDB
    NeonDB --- BTreeIndex
```

---

## 2. Infrastructure as Code (`render.yaml`)

Both backend and frontend services are declared in the repository's root [`render.yaml`](../render.yaml):

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

## 3. Environment Variables Reference

Environment variables marked `sync: false` represent sensitive credentials configured strictly within the **Render Dashboard**. They are never committed to version control.

| Environment Variable | Target Service | Classification | Purpose & Configuration |
|---|---|---|---|
| `SPRING_DATASOURCE_URL` | `amber-backend` | Secret (`sync: false`) | Pooled JDBC URL to Neon PostgreSQL with SSL enforced (`jdbc:postgresql://<host>/<database>?sslmode=require`). |
| `SPRING_DATASOURCE_USERNAME` | `amber-backend` | Secret (`sync: false`) | Neon database user account. |
| `SPRING_DATASOURCE_PASSWORD` | `amber-backend` | Secret (`sync: false`) | Neon database user password. |
| `AMBER_ADMIN_API_KEY` | `amber-backend` | Secret (`sync: false`) | Master administrative secret authorizing catalogue indexing and deletions. Fails closed if missing. |
| `JAMENDO_CLIENT_ID` | `amber-backend` | Secret (`sync: false`) | Optional Jamendo developer client ID for Open Music exploration. |
| `CORS_ALLOWED_ORIGINS` | `amber-backend` | Configuration | Comma-delimited origins permitted for browser CORS preflights. |
| `JAVA_OPTS` | `amber-backend` | Runtime Flag | Container memory management: `-XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0`. |
| `PORT` | `amber-backend` | Runtime Flag | HTTP listening port assigned by Render container harness (defaults to `10000`). |
| `VITE_API_BASE_URL` | `amber-frontend` | Build Configuration | Public base HTTP endpoint: `https://amber-backend-ler4.onrender.com/api/v1`. |
| `VITE_WS_URL` | `amber-frontend` | Build Configuration | Public WebSocket stream endpoint: `wss://amber-backend-ler4.onrender.com/api/v1/ws/audio-stream`. |

---

## 4. Database Connectivity & Migration Strategy

### 4.1 Neon Serverless PostgreSQL
Amber connects to PostgreSQL 16 on Neon using HikariCP connection pooling:
- **Maximum Pool Size**: 10 connections (tailored to serverless connection limits).
- **Minimum Idle Connections**: 2.
- **Connection Timeout**: 20,000 ms.
- **Idle Timeout**: 30,000 ms.
- **Max Lifetime**: 1,800,000 ms (30 minutes).

### 4.2 Flyway Schema Versioning
Database schema lifecycle is managed automatically on backend startup via Flyway:
- `V1__init_schema.sql`: Initializes `songs` and `fingerprints` tables, composite B-Tree index on `(hash, song_id)`.
- `V2__open_music_importer.sql`: Creates `open_music_import_jobs` and `open_music_import_items` tables with indices on `(status, next_attempt_at)`.
- `V3__open_music_hardening.sql`: Adds durable lease fields (`locked_by`, `lease_until`, `last_error_code`) and deduplication indices on `(source_provider, source_track_id)`.

---

## 5. Health Checks, Monitoring & Operational Constraints

### 5.1 Health Probe
Render probes `GET /api/v1/health` periodically:
```bash
curl -s https://amber-backend-ler4.onrender.com/api/v1/health
```
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

### 5.2 Free-Tier Sleep Cycle & Cold Starts
- **Idle Timeout**: Render spins down free web service containers after 15 minutes of zero inbound HTTP traffic.
- **Cold Boot Duration**: First request after container suspension takes $\approx 30–50\text{ seconds}$ to initialize the JVM, load Flyway schema validations, and establish database pools.
- **Client Handling**: The frontend displays a non-blocking connection banner if health checks take $>5\text{ seconds}$.
