.PHONY: run test build web-dist

run:
	go run .

test:
	go test ./...
	node --check web/app.js

build:
	go build -o bin/jev-plays-dino .

web-dist:
	mkdir -p dist
	cp web/index.html web/styles.css web/app.js web/favicon.svg dist/
