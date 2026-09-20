.PHONY: run laya test build web-dist

run:
	go run .

laya:
	cd laya-server && .venv/bin/python server.py

test:
	go test ./...
	node --check web/app.js
	python3 -m unittest laya-server/test_server.py

build:
	go build -o bin/jev-plays-dino .

web-dist:
	mkdir -p dist
	cp web/index.html web/styles.css web/app.js web/favicon.svg dist/
