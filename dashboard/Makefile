.PHONY: deploy logs stop restart status

REGISTRY=192.168.1.39:5001
IMAGE=mache-dashboard
NAS=dave@blackbox.local
SSH=ssh -p 7722
COMPOSE_DIR=/volume1/docker/mache-dashboard

deploy:
	@echo "→ Building and pushing image (linux/amd64)..."
	cd /Volumes/OWC2TB/dave/dev/projects/mache-trips/dashboard && \
	docker buildx build \
	  --platform linux/amd64 \
	  -t $(REGISTRY)/$(IMAGE):latest \
	  --push \
	  .
	@echo "→ Deploying on NAS..."
	$(SSH) $(NAS) "cd $(COMPOSE_DIR) && sudo /usr/local/bin/docker-compose pull && sudo /usr/local/bin/docker-compose up -d"
	@echo "✓ Done. Dashboard at https://mache-trips.lowcore.net"

logs:
	$(SSH) $(NAS) "sudo /usr/local/bin/docker logs -f $(IMAGE)"

stop:
	$(SSH) $(NAS) "cd $(COMPOSE_DIR) && sudo /usr/local/bin/docker-compose down"

restart: stop deploy

status:
	$(SSH) $(NAS) "sudo /usr/local/bin/docker ps | grep $(IMAGE)"