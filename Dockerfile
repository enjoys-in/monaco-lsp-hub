# ── Build stage ───────────────────────────────────────────────────────────────
FROM oven/bun:1 AS builder

WORKDIR /app

COPY package.json bun.lock* ./
COPY packages/client/package.json ./packages/client/
COPY packages/server/package.json ./packages/server/

RUN bun install

COPY . .

RUN bun run build:client && bun run build:server

# ── System language servers ───────────────────────────────────────────────────
# Prebuilt binaries and compiled tools that can't be installed via npm.
FROM debian:bookworm-slim AS systools

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl wget unzip git xz-utils \
    python3 python3-pip python3-venv \
    ruby ruby-dev build-essential \
    php-cli php-xml php-mbstring php-curl \
    && rm -rf /var/lib/apt/lists/*

# ── C/C++: clangd ────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends clangd \
    && rm -rf /var/lib/apt/lists/*

# ── Go: gopls ────────────────────────────────────────────────────────────────
ARG GO_VERSION=1.23.4
RUN curl -fsSL "https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"
RUN go install golang.org/x/tools/gopls@latest

# ── Rust: rust-analyzer ──────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/rust-lang/rust-analyzer/releases/latest/download/rust-analyzer-x86_64-unknown-linux-gnu.gz \
    | gunzip > /usr/local/bin/rust-analyzer && chmod +x /usr/local/bin/rust-analyzer

# ── Lua: lua-language-server ─────────────────────────────────────────────────
RUN mkdir -p /opt/lua-language-server \
    && LLSVER=$(curl -fsSL https://api.github.com/repos/LuaLS/lua-language-server/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+') \
    && curl -fsSL "https://github.com/LuaLS/lua-language-server/releases/download/${LLSVER}/lua-language-server-${LLSVER}-linux-x64.tar.gz" \
    | tar -C /opt/lua-language-server -xz

# ── Markdown: marksman ───────────────────────────────────────────────────────
RUN curl -fsSL -o /usr/local/bin/marksman \
    https://github.com/artempyanykh/marksman/releases/latest/download/marksman-linux-x64 \
    && chmod +x /usr/local/bin/marksman

# ── TOML: taplo ──────────────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/tamasfe/taplo/releases/latest/download/taplo-linux-x86_64.gz \
    | gunzip > /usr/local/bin/taplo && chmod +x /usr/local/bin/taplo

# ── LaTeX: texlab ────────────────────────────────────────────────────────────
RUN TEXLAB_VER=$(curl -fsSL https://api.github.com/repos/latex-lsp/texlab/releases/latest | grep -oP '"tag_name":\s*"v?\K[^"]+') \
    && curl -fsSL "https://github.com/latex-lsp/texlab/releases/download/v${TEXLAB_VER}/texlab-x86_64-linux.tar.gz" \
    | tar -xz -C /usr/local/bin

# ── Terraform: terraform-ls ──────────────────────────────────────────────────
RUN TFLS_VER=$(curl -fsSL https://api.github.com/repos/hashicorp/terraform-ls/releases/latest | grep -oP '"tag_name":\s*"v?\K[^"]+') \
    && curl -fsSL "https://releases.hashicorp.com/terraform-ls/${TFLS_VER}/terraform-ls_${TFLS_VER}_linux_amd64.zip" \
        -o /tmp/tfls.zip \
    && unzip /tmp/tfls.zip -d /usr/local/bin && rm /tmp/tfls.zip

# ── Zig: zls ─────────────────────────────────────────────────────────────────
RUN ZLS_VER=$(curl -fsSL https://api.github.com/repos/zigtools/zls/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+') \
    && curl -fsSL "https://github.com/zigtools/zls/releases/download/${ZLS_VER}/zls-x86_64-linux.tar.xz" \
    | tar -xJ --strip-components=1 -C /usr/local/bin

# ── Clojure: clojure-lsp ────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/clojure-lsp/clojure-lsp/releases/latest/download/clojure-lsp-native-static-linux-amd64.zip \
    -o /tmp/clj-lsp.zip && unzip /tmp/clj-lsp.zip -d /usr/local/bin && rm /tmp/clj-lsp.zip

# ── Helm: helm-ls ───────────────────────────────────────────────────────────
RUN curl -fsSL "https://github.com/mrjosh/helm-ls/releases/latest/download/helm_ls_linux_amd64" \
    -o /usr/local/bin/helm_ls && chmod +x /usr/local/bin/helm_ls

# ── Grammar: harper-ls ──────────────────────────────────────────────────────
RUN HARPER_VER=$(curl -fsSL https://api.github.com/repos/Automattic/harper/releases/latest | grep -oP '"tag_name":\s*"v?\K[^"]+') \
    && curl -fsSL "https://github.com/Automattic/harper/releases/download/v${HARPER_VER}/harper-ls-x86_64-unknown-linux-gnu" \
    -o /usr/local/bin/harper-ls && chmod +x /usr/local/bin/harper-ls

# ── JRE 21 (for JVM-based language servers) ──────────────────────────────────
RUN curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse" \
    -o /tmp/jre.tar.gz \
    && mkdir -p /opt/java && tar -xzf /tmp/jre.tar.gz -C /opt/java --strip-components=1 \
    && rm /tmp/jre.tar.gz
ENV JAVA_HOME=/opt/java
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# ── Java: Eclipse JDT LS ─────────────────────────────────────────────────────
RUN mkdir -p /opt/jdtls \
    && curl -fsSL "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz" \
    | tar -xz -C /opt/jdtls
COPY <<'EOF' /usr/local/bin/jdtls
#!/bin/sh
exec java \
  -Declipse.application=org.eclipse.jdt.ls.core.id1 \
  -Dosgi.bundles.defaultStartLevel=4 \
  -Declipse.product=org.eclipse.jdt.ls.core.product \
  -Dlog.level=ALL \
  -noverify -Xmx1G --add-modules=ALL-SYSTEM --add-opens java.base/java.util=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED \
  -jar /opt/jdtls/plugins/org.eclipse.equinox.launcher_*.jar \
  -configuration /opt/jdtls/config_linux \
  -data "${JDTLS_DATA:-/tmp/jdtls-data}" \
  "$@"
EOF
RUN chmod +x /usr/local/bin/jdtls

# ── Kotlin: kotlin-language-server ───────────────────────────────────────────
RUN KLS_VER=$(curl -fsSL https://api.github.com/repos/fwcd/kotlin-language-server/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+') \
    && curl -fsSL "https://github.com/fwcd/kotlin-language-server/releases/download/${KLS_VER}/server.zip" \
        -o /tmp/kls.zip \
    && unzip /tmp/kls.zip -d /opt && mv /opt/server /opt/kotlin-language-server && rm /tmp/kls.zip
RUN ln -s /opt/kotlin-language-server/bin/kotlin-language-server /usr/local/bin/kotlin-language-server

# ── Scala: metals ────────────────────────────────────────────────────────────
RUN curl -fsSL "https://github.com/coursier/coursier/releases/latest/download/cs-x86_64-pc-linux.gz" \
    | gunzip > /usr/local/bin/cs && chmod +x /usr/local/bin/cs \
    && /usr/local/bin/cs install metals --install-dir /usr/local/bin

# ── XML: lemminx ─────────────────────────────────────────────────────────────
RUN LEMMINX_VER=$(curl -fsSL https://api.github.com/repos/eclipse/lemminx/releases/latest | grep -oP '"tag_name":\s*"\K[^"]+') \
    && curl -fsSL "https://github.com/eclipse/lemminx/releases/download/${LEMMINX_VER}/lemminx-linux.zip" \
        -o /tmp/lemminx.zip \
    && unzip /tmp/lemminx.zip -d /usr/local/bin && chmod +x /usr/local/bin/lemminx && rm /tmp/lemminx.zip

# ── Dart: Dart SDK ───────────────────────────────────────────────────────────
RUN curl -fsSL "https://storage.googleapis.com/dart-archive/channels/stable/release/latest/sdk/dartsdk-linux-x64-release.zip" \
    -o /tmp/dart.zip \
    && unzip /tmp/dart.zip -d /opt && rm /tmp/dart.zip
ENV PATH="/opt/dart-sdk/bin:${PATH}"

# ── Python-based LSP servers (pip) ───────────────────────────────────────────
RUN pip3 install --break-system-packages --no-cache-dir \
    python-lsp-server \
    cmake-language-server \
    esbonio \
    nginx-language-server

# ── Ruby: solargraph ─────────────────────────────────────────────────────────
RUN gem install --no-document solargraph

# ── PHP: phpactor ────────────────────────────────────────────────────────────
RUN curl -fsSL https://github.com/phpactor/phpactor/releases/latest/download/phpactor.phar \
    -o /usr/local/bin/phpactor && chmod +x /usr/local/bin/phpactor

# ── Production stage ──────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    libstdc++6 \
    libgcc-s1 \
    zlib1g \
    ca-certificates \
    python3 \
    ruby \
    php-cli php-xml php-mbstring \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Copy JRE ─────────────────────────────────────────────────────────────────
COPY --from=systools /opt/java /opt/java
ENV JAVA_HOME=/opt/java
ENV PATH="${JAVA_HOME}/bin:${PATH}"

# ── Copy prebuilt binaries ───────────────────────────────────────────────────

# Go: gopls
COPY --from=systools /root/go/bin/gopls /usr/local/bin/gopls

# Rust: rust-analyzer
COPY --from=systools /usr/local/bin/rust-analyzer /usr/local/bin/rust-analyzer

# C/C++: clangd + LLVM libs
COPY --from=systools /usr/bin/clangd /usr/local/bin/clangd

# Lua: lua-language-server (self-contained)
COPY --from=systools /opt/lua-language-server /opt/lua-language-server
RUN ln -s /opt/lua-language-server/bin/lua-language-server /usr/local/bin/lua-language-server

# Markdown: marksman
COPY --from=systools /usr/local/bin/marksman /usr/local/bin/marksman

# TOML: taplo
COPY --from=systools /usr/local/bin/taplo /usr/local/bin/taplo

# LaTeX: texlab
COPY --from=systools /usr/local/bin/texlab /usr/local/bin/texlab

# Terraform: terraform-ls
COPY --from=systools /usr/local/bin/terraform-ls /usr/local/bin/terraform-ls

# Zig: zls
COPY --from=systools /usr/local/bin/zls /usr/local/bin/zls

# Clojure: clojure-lsp
COPY --from=systools /usr/local/bin/clojure-lsp /usr/local/bin/clojure-lsp

# Helm: helm-ls
COPY --from=systools /usr/local/bin/helm_ls /usr/local/bin/helm_ls

# Grammar: harper-ls
COPY --from=systools /usr/local/bin/harper-ls /usr/local/bin/harper-ls

# Java: Eclipse JDT LS
COPY --from=systools /opt/jdtls /opt/jdtls
COPY --from=systools /usr/local/bin/jdtls /usr/local/bin/jdtls

# Kotlin: kotlin-language-server
COPY --from=systools /opt/kotlin-language-server /opt/kotlin-language-server
RUN ln -s /opt/kotlin-language-server/bin/kotlin-language-server /usr/local/bin/kotlin-language-server

# Scala: metals
COPY --from=systools /usr/local/bin/metals /usr/local/bin/metals

# XML: lemminx
COPY --from=systools /usr/local/bin/lemminx /usr/local/bin/lemminx

# Dart SDK
COPY --from=systools /opt/dart-sdk /opt/dart-sdk
ENV PATH="/opt/dart-sdk/bin:${PATH}"

# Python pip LSPs (pylsp, cmake-language-server, esbonio, nginx-language-server)
COPY --from=systools /usr/local/lib/python3.11/dist-packages /usr/local/lib/python3.11/dist-packages
COPY --from=systools /usr/local/bin/pylsp /usr/local/bin/cmake-language-server \
    /usr/local/bin/esbonio /usr/local/bin/nginx-language-server /usr/local/bin/

# Ruby: solargraph
COPY --from=systools /usr/local/lib/ruby /usr/local/lib/ruby
COPY --from=systools /usr/local/bin/solargraph /usr/local/bin/solargraph

# PHP: phpactor
COPY --from=systools /usr/local/bin/phpactor /usr/local/bin/phpactor

# ── Copy app and install npm deps ────────────────────────────────────────────

COPY package.json bun.lock* ./
COPY packages/server/package.json ./packages/server/

RUN cd packages/server && bun install --production

# Copy built client
COPY --from=builder /app/packages/client/dist ./packages/client/dist

# Copy built server
COPY --from=builder /app/packages/server/dist ./packages/server/dist

# ── Runtime config ───────────────────────────────────────────────────────────
ENV PORT=9601
ENV CLIENT_DIST_PATH=/app/packages/client/dist
EXPOSE 9601

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:9601/api/languages').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "packages/server/dist/main.js"]
