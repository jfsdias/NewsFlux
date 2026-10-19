# syntax=docker/dockerfile:1

ARG VITE_BASE_PATH=/

# Stage 1: Build the React application
# Specify the version to ensure consistent builds
FROM --platform=$BUILDPLATFORM node:24.22.0-alpine3.24@sha256:44fce696f38ba8c987c4db89954051000bbd05ffd8d8659ba15ed4a8602e937f AS build

ARG SOURCE_COMMIT
ARG SOURCE_COMMIT_DATE
ARG VITE_BASE_PATH
ARG NEWSFLUX_REQUIRE_BUILD_REVISION=1

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEWSFLUX_REQUIRE_BUILD_REVISION=$NEWSFLUX_REQUIRE_BUILD_REVISION

# enable corepack to use pnpm
RUN corepack enable

# Set the working directory in the container
WORKDIR /app

# Copy dependency files first to preserve the install layer cache
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

# Install dependencies using pnpm
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

# Copy the rest of the code
COPY . .

# Build the project
RUN pnpm run build

# Stage 2: Run the server using Caddy
# Specify the version for consistency
FROM caddy:2.11.7@sha256:685ae3d7c34d9b5f8caeddc5d14051db7bbd88ff1f5a2fa0c16bd8ca328fb7af

ARG SOURCE_COMMIT
ARG VITE_BASE_PATH
ENV REACTFLUX_BASE_PATH=$VITE_BASE_PATH
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT \
    org.opencontainers.image.source="https://github.com/jfsdias/NewsFlux"

# Copy built assets to the URL path embedded in the frontend bundle
COPY --from=build /app/build /srv${REACTFLUX_BASE_PATH}

# Caddy will pick up the Caddyfile automatically
COPY Caddyfile /etc/caddy/Caddyfile

# Expose the port Caddy listens on
EXPOSE 2000

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
