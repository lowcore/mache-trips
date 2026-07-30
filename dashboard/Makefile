.PHONY: build srv-config deploy logs stop restart status require-deploy-host

IMAGE=mache-dashboard
SRV=$(HOME)/srv/mache-trips
COMPOSE=docker compose -f $(SRV)/docker-compose.yml --project-directory $(SRV)

# --- deploy host guard ------------------------------------------------------
# Production runs on the Mac Mini. These targets build an image and start
# containers against $(SRV), which is a path on THIS machine — so running them
# from the MBP would quietly bring up a second, empty instance locally against
# an empty data/ dir, leave production untouched, and report success. Fail
# loudly instead. Override with DEPLOY_ANYWAY=1 if you really mean it.
DEPLOY_HOST ?= MiniM4
require-deploy-host:
ifndef DEPLOY_ANYWAY
	@test "$$(scutil --get ComputerName 2>/dev/null)" = "$(DEPLOY_HOST)" || { \
	  echo "ERROR: deploy targets must run on $(DEPLOY_HOST) (this is $$(scutil --get ComputerName 2>/dev/null))."; \
	  echo "       Push from here, then pull and deploy on $(DEPLOY_HOST)."; \
	  echo "       Override with DEPLOY_ANYWAY=1 if you really mean it."; \
	  exit 1; }
endif
# ----------------------------------------------------------------------------


# Native arm64 build on the Mac Mini, which is now both build host and run
# host — no buildx --platform, no registry, no ssh. (Migrated off the Synology
# 2026-07-28.)
build:
	@echo "→ Building image (arm64)..."
	docker build -t $(IMAGE):latest .

# The repo's compose file is authoritative; copy it into the runtime dir before
# restarting so a ports or env change can't appear to deploy and silently not.
srv-config: require-deploy-host
	@mkdir -p $(SRV)/data
	cp docker-compose.yml $(SRV)/docker-compose.yml

deploy: require-deploy-host build srv-config
	$(COMPOSE) up -d
	@echo "✓ Done. Dashboard at https://mache-trips.lowcore.net (LAN: http://localhost:3000)"

logs:
	docker logs -f $(IMAGE)

stop: require-deploy-host
	$(COMPOSE) down

restart: require-deploy-host stop deploy

status:
	$(COMPOSE) ps
