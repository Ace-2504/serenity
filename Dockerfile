# One image for the web app, the job worker and migrations. Node 20 + Python 3.13 (ML worker).
#
#   docker compose build            (see docs/platform/09-operations.md)
#
# Behind a TLS-inspecting proxy, pass its CA certificate as a build secret:
#   docker build --secret id=extra_ca,src=/path/to/proxy-ca.crt .

FROM node:20-bookworm-slim AS node

FROM python:3.13-slim-bookworm AS base
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && groupadd --system serenity && useradd --system --gid serenity --home-dir /app serenity
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra_ca; fi; \
    npm ci --no-audit --no-fund

FROM base AS ml
COPY ml/requirements.txt ml/requirements.txt
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -f /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi; \
    python -m venv ml/.venv && ml/.venv/bin/pip install --no-cache-dir -q -r ml/requirements.txt

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000
COPY --from=build --chown=serenity:serenity /app ./
COPY --from=ml --chown=serenity:serenity /app/ml/.venv ./ml/.venv
USER serenity
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-p", "3000"]
