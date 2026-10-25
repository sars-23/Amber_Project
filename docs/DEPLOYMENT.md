# EchoTrace: Deployment & Operations Guide

## 1. Local Development via Docker Compose
EchoTrace can be run with Docker Compose:

```bash
docker compose up --build -d
```
This boots:
1. `postgres`: Alpine PostgreSQL 16 on port `5432` with healthcheck.
2. `backend`: Java 21 Spring Boot on port `8080`, with FFmpeg installed and Flyway automatic migration.
3. `frontend`: React/TypeScript Nginx container on port `5173`.

## 2. Cloud Deployment (Google Cloud Run / AWS ECS)

### Backend Container (Cloud Run)
- Build container:
  ```bash
  docker build -t gcr.io/${PROJECT_ID}/echotrace-backend:latest ./backend
  docker push gcr.io/${PROJECT_ID}/echotrace-backend:latest
  ```
- Deploy with Cloud SQL PostgreSQL connection:
  ```bash
  gcloud run deploy echotrace-backend \
    --image gcr.io/${PROJECT_ID}/echotrace-backend:latest \
    --platform managed \
    --region us-central1 \
    --allow-unauthenticated \
    --set-env-vars SPRING_DATASOURCE_URL=jdbc:postgresql:///echotrace?cloudSqlInstance=PROJECT:REGION:INSTANCE&socketFactory=com.google.cloud.sql.postgres.SocketFactory \
    --memory 1Gi \
    --cpu 2 \
    --session-affinity
  ```
*(Note: Cloud Run enables WebSocket support by default; session affinity should be enabled for WebSocket streaming).*

### Frontend Deployment (Firebase Hosting / Vercel / Cloud Storage + CDN)
- Build bundle:
  ```bash
  cd frontend
  npm install
  npm run build
  ```
- Configure static hosting pointing `/api/*` to the backend Cloud Run service URL.
