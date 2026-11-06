# ==============================================================================
# Stage 1: Build React + Vite Frontend & TypeScript Backend
# ==============================================================================
FROM node:20-bookworm-slim AS builder

WORKDIR /build

COPY package*.json tsconfig.server.json ./
COPY web/ ./web/
COPY src/ ./src/
COPY templates/ ./templates/
COPY media/ ./media/
COPY mcp/ ./mcp/

RUN npm install && npm run build

# ==============================================================================
# Stage 2: Self-Contained All-in-One Runtime
# Bundles:
#   1. Node.js 20 + tidyproteomics-agent Web App & Orchestrator (Port 3000)
#   2. Python 3 + tidyproteomics-mcp stdio server (/app/mcp/server.py)
#   3. R 4.3.2 + tidyproteomics + limma + fgsea + persistent R daemon (/app/mcp/r_daemon.R)
# ==============================================================================
FROM rocker/r-ver:4.3.2

# Install system dependencies, Python 3, and Node.js 20
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    gnupg \
    python3 \
    python3-pip \
    libcurl4-openssl-dev \
    libssl-dev \
    libxml2-dev \
    libfontconfig1-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libfreetype6-dev \
    libpng-dev \
    libtiff5-dev \
    libjpeg-dev \
    poppler-utils \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Configure Posit Package Manager for pre-compiled Linux binaries (Debian Bookworm) to accelerate installation
RUN echo 'options(repos = c(CRAN = "https://packagemanager.posit.co/cran/__linux__/bookworm/latest"))' >> /usr/local/lib/R/etc/Rprofile.site && \
    echo 'options(HTTPUserAgent = sprintf("R/%s R (%s)", getRversion(), paste(getRversion(), R.version$platform, R.version$arch, R.version$os)))' >> /usr/local/lib/R/etc/Rprofile.site

# Install required R packages & tidyproteomics (including imputation, normalization, plotting, and literature packages)
RUN R -e "install.packages(c('httpuv', 'jsonlite', 'dplyr', 'tidyr', 'readr', 'ggplot2', 'stringr', 'purrr', 'tibble', 'glue', 'rlang', 'httr', 'remotes', 'BiocManager', 'DBI', 'duckdb', 'readxl', 'writexl', 'knitr', 'rmarkdown', 'missForest', 'randomForest', 'doParallel', 'foreach', 'e1071', 'pheatmap', 'RColorBrewer', 'ggrepel', 'gridExtra', 'scales', 'patchwork', 'viridis', 'babelgene'))" && \
    R -e "BiocManager::install(c('limma', 'fgsea', 'BiocParallel'), ask = FALSE, update = FALSE)" && \
    R -e "remotes::install_github('jeffsocal/tidyproteomics', upgrade = 'never')"

WORKDIR /app

# Copy compiled artifacts & runtime assets from builder
COPY --from=builder /build/package.json ./package.json
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/templates ./templates
COPY --from=builder /build/media ./media
COPY --from=builder /build/mcp ./mcp

RUN chmod +x /app/mcp/server.py /app/mcp/r_daemon.R /app/mcp/entrypoint.sh

# Create default mounted workspaces directory
RUN mkdir -p /tidyproteomics_agent
VOLUME ["/tidyproteomics_agent"]

ENV PORT=3000
ENV NODE_ENV=production
ENV TIDY_WORKSPACE=/tidyproteomics_agent/project_01
ENV TIDY_MCP_MODE=local
ENV TIDY_MCP_SERVER_PATH=/app/mcp/server.py
ENV TIDY_DAEMON_PORT=8765
ENV TIDY_DAEMON_URL="http://127.0.0.1:8765"

EXPOSE 3000

CMD ["node", "/app/dist/server.js"]

