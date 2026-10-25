# Multi-stage Dockerfile for EchoTrace Java 21 Backend with FFmpeg

# Stage 1: Build JAR with Maven
FROM maven:3.9.9-eclipse-temurin-21-alpine AS builder
WORKDIR /app

# Cache dependencies
COPY pom.xml .
RUN mvn dependency:go-offline -B

# Build application
COPY src ./src
RUN mvn clean package -DskipTests

# Stage 2: Minimal Distroless / Alpine Runtime with FFmpeg
FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

# Install FFmpeg and curl for health checks
RUN apk add --no-cache ffmpeg curl

# Create non-root user for security
RUN addgroup -S echotrace && adduser -S echotrace -G echotrace
USER echotrace:echotrace

# Copy built artifact
COPY --from=builder /app/target/echotrace-backend-1.0.0.jar app.jar

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:${PORT:-8080}/api/v1/health || exit 1

ENTRYPOINT ["sh", "-c", "exec java ${JAVA_OPTS:--XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0} -jar app.jar"]
