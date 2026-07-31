.PHONY: build srv-config deploy logs stop restart status \
        require-deploy-host deploy-mini deploy-mini-setup

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
	  echo "       Run 'make deploy-mini' instead -- it ships this commit to"; \
	  echo "       $(DEPLOY_HOST) and deploys it there in one step."; \
	  echo "       Override with DEPLOY_ANYWAY=1 if you really mean it."; \
	  exit 1; }
endif
# ----------------------------------------------------------------------------

# --- deploy to the Mini from a dev machine ----------------------------------
# The Mini is the only host that can actually deploy (see the guard above), so
# from the MBP the job is just: get the commit onto the Mini, then run the
# ordinary deploy there. Everything host-specific -- the bind-mounted data/ dir
# holding trips.db, the native arm64 image build -- stays on the Mini. Note this
# ships the whole repo, not just dashboard/: watcher.py and process_trip.py run
# under launchd on the Mini and are updated by the same push.
#
# Code travels over ssh straight into the Mini's checkout rather than via
# GitHub, deliberately: the Mini's origin is an https URL using the osxkeychain
# credential helper, which cannot be unlocked from a non-interactive ssh
# session (`git pull` there dies with keychain error -25308). Pushing to the
# Mini needs no GitHub credentials on it at all.
MINI_HOST ?= minim4.local
MINI_REPO ?= dev/projects/mache-trips
MINI_BRANCH ?= master
MINI_PORT ?= 3000
# Where `make deploy` lives on the Mini, relative to $(HOME). This Makefile sits
# one level below the git root, so unlike every other project it is not
# $(MINI_REPO) -- the remote and the push still address the repo root.
MINI_MAKE_DIR ?= $(MINI_REPO)/dashboard

# One-time bootstrap; idempotent, so it is safe to re-run.
deploy-mini-setup:
	@git remote get-url mini >/dev/null 2>&1 \
	  || git remote add mini $(MINI_HOST):$(MINI_REPO)
	@echo "-> mini remote: $$(git remote get-url mini)"
	@# Lets a push fast-forward the Mini's checked-out branch. It refuses if the
	@# Mini's own tree is dirty, so this can never clobber edits made there.
	ssh $(MINI_HOST) 'git -C $(MINI_REPO) config receive.denyCurrentBranch updateInstead'
	@echo "-> $(MINI_HOST) will accept pushes to its checked-out $(MINI_BRANCH)."

deploy-mini:
	@test "$$(scutil --get ComputerName 2>/dev/null)" != "$(DEPLOY_HOST)" || { \
	  echo "ERROR: this is already $(DEPLOY_HOST) -- just run 'make deploy'."; exit 1; }
	@git remote get-url mini >/dev/null 2>&1 || { \
	  echo "ERROR: no 'mini' remote. Run 'make deploy-mini-setup' once first."; exit 1; }
	@# Untracked files count as dirty: they would not be pushed, so a new file
	@# that is part of the change would silently be missing on the Mini.
	@test -z "$$(git status --porcelain)" || { \
	  echo "ERROR: working tree is dirty -- commit first so what runs in"; \
	  echo "       production matches a commit. Offenders:"; \
	  git status --short | sed 's/^/         /'; \
	  exit 1; }
	@echo "-> Pushing $(MINI_BRANCH) ($$(git rev-parse --short HEAD)) to $(MINI_HOST)..."
	git push mini $(MINI_BRANCH)
	@echo "-> Building and deploying on $(MINI_HOST)..."
	ssh $(MINI_HOST) 'make -C $(MINI_MAKE_DIR) deploy'
	@echo "-> Checking the dashboard responds..."
	@curl -fsS -o /dev/null --retry 10 --retry-delay 2 --retry-all-errors \
	  -w "   HTTP %{http_code} from $(MINI_HOST):$(MINI_PORT)\n" \
	  http://$(MINI_HOST):$(MINI_PORT)/ \
	  || { echo "   FAILED: no healthy response -- check 'make logs' on $(MINI_HOST)."; exit 1; }
	@echo "Deployed. http://$(MINI_HOST):$(MINI_PORT)"
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
