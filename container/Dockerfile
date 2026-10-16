FROM node:lts-bookworm-slim
# v8 S4a: Python (with pytest, for project checks) and Playwright's Chromium
# headless shell (browser checks); util-linux gives the checks prlimit, unshare
# and nsenter. Channels only (the base is the Node LTS channel, decision
# U12), no versions pinned: every verification records the versions it
# ran (the report's inventory).
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pytest ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g playwright && playwright install --with-deps --only-shell chromium \
 && rm -rf /root/.npm /root/.cache /var/lib/apt/lists/* \
 && mkdir -p /opt/toolchain && python3 -c "import sys;print('\n'.join(sorted(sys.stdlib_module_names)))" > /opt/toolchain/python-stdlib.txt
RUN command -v timeout && command -v unshare && command -v nsenter && command -v prlimit && useradd --create-home --uid 10001 builder
COPY build-runner.mjs build-path.mjs stack-frames.mjs /opt/
COPY adapters/ /opt/adapters/
RUN chmod 0444 /opt/build-runner.mjs /opt/build-path.mjs /opt/stack-frames.mjs && chmod -R a+rX /opt/adapters /opt/toolchain /ms-playwright \
 && mkdir -p /work && chown builder:builder /work
USER builder
WORKDIR /work
CMD ["sleep", "infinity"]
