FROM node:22-bookworm-slim
RUN command -v timeout >/dev/null && useradd --create-home --uid 10001 builder
COPY build-runner.mjs build-path.mjs /opt/
RUN chmod 0444 /opt/build-runner.mjs /opt/build-path.mjs && mkdir -p /work && chown builder:builder /work
USER builder
WORKDIR /work
CMD ["sleep", "infinity"]
