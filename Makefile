PROJECT = "Kinvey JavaScript SDK Core"

clean: ;@echo "Cleaning ${PROJECT}..."; \
	rm -rf node_modules

install: ;@echo "Installing dependencies for ${PROJECT}..."; \
	npm install

test: ;@echo "Testing ${PROJECT}..."; \
	npm run test:jenkins

build: ;@echo "Building ${PROJECT}..."; \
	npm run build

publish: ;@echo "Publishing ${PROJECT}..."; \
	npm publish .

audit: clean install test
release: audit build publish

.PHONY: clean install test build publish audit release
