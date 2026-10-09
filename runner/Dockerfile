# AgentForge runner image (SPEC §6.1): graders, statistics, red team and optimizer, run as the job container of the
# run-suite / nightly / optimize workflows. Target agents are installed later, inside the job, in their own venv.
# Node 22 comes from the official image: DataPilot's Pyodide sandbox needs Node >= 20 (Debian bookworm ships 18).
FROM node:22-bookworm-slim AS node

FROM python:3.12-slim

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && apt-get update \
    && apt-get install -y --no-install-recommends git postgresql-client ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv==0.11.15 \
    && useradd -m runner

WORKDIR /opt/agentforge
ENV UV_PROJECT_ENVIRONMENT=/opt/agentforge/.venv \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PYTHONUNBUFFERED=1

# Dependencies first (cached layer), then the project itself.
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY agentforge_runner ./agentforge_runner
COPY examples ./examples
RUN uv sync --frozen --no-dev --no-editable \
    && chown -R runner:runner /opt/agentforge

ENV PATH="/opt/agentforge/.venv/bin:$PATH"
USER runner
ENTRYPOINT ["af-run"]
CMD ["--help"]
