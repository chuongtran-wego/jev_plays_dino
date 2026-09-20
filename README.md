# Typed AI Plays Dino

Typed AI Plays Dino is a browser game where either [TypeSafe AI](https://typesafe.ai/)'s Jev API or the local [Laya-MLX](https://github.com/mizorewww/laya-mlx) runtime controls an original pixel dinosaur. Both engines receive the same structured game state and choose whether to jump, duck, or continue. The interface shows every decision, probability, confidence score, input, and latency in real time.

![Jev Plays Dino game interface](docs/screenshot.jpg)

## Features

- Four play modes: Human, deterministic Rule bot, Jev API, and local Laya-MLX.
- Typed Jev decisions with visible probabilities, confidence, collision risk, and latency.
- Starting-speed presets at `1x`, `2x`, `4x`, and `8x`; every run continues accelerating from the selected starting speed.
- Pixel-style sound effects implemented with the Web Audio API.
- Responsive two-panel interface with the game on the left and the decision log on the right.
- Simulation fallback when no TypeSafe API key is configured.
- A separate lightweight Python service that keeps Laya-MLX loaded on Apple Silicon.

## Requirements

- Go 1.22 or newer.
- A TypeSafe API key for live Jev decisions. The game still runs in simulation mode without one.
- For Laya mode: an Apple Silicon Mac, macOS 14+, and Python 3.11+. Laya-MLX does not run on Linux or Intel Macs.

## Run locally

Clone the repository and create your local environment file:

```bash
git clone https://github.com/chuongtrh/jev_plays_dino.git
cd jev_plays_dino
cp .env.example .env
```

Set your API key in `.env`:

```dotenv
TYPESAFE_API_KEY=your_typesafe_api_key
TYPESAFE_BASE_URL=https://api.typesafe.ai
LAYA_BASE_URL=http://127.0.0.1:8090
LAYA_API_KEY=
PORT=8080
```

Start the server:

```bash
go run .
```

Open <http://localhost:8080>. Values already exported in your shell take precedence over `.env`.

## Run Laya-MLX locally

Laya runs as a separate service so the Go application remains small and can switch decision engines at runtime. On an Apple Silicon Mac:

```bash
cd laya-server
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
set -a
source .env
set +a
python server.py
```

The first start downloads the `aac6fef/laya-mlx` checkpoint. Later starts use the local Hugging Face cache. Keep this service running, start the Go application in another terminal, then choose **Laya** in the game.

The service binds to `127.0.0.1:8090` by default. To expose it to another machine, set `LAYA_HOST=0.0.0.0`, configure the same secret as `LAYA_SERVER_API_KEY` in the Python service and `LAYA_API_KEY` in the Go application, and protect the connection with a private network or TLS reverse proxy.

## Play modes

- **Human** — press `Space` or `Arrow Up` to jump and `Arrow Down` to duck.
- **Rule** — a deterministic local controller uses obstacle type, distance, and current speed.
- **Jev** — the Go server sends structured game state to Jev and returns a typed action.
- **Laya** — the Go server forwards the same state to a local Laya-MLX service; model weights and inference stay on your Mac.

The `1x`, `2x`, `4x`, and `8x` controls select the starting speed for the next run. Speed then increases gradually as the score grows, matching the original endless-runner behavior.

## Project structure

```text
.
├── main.go          # Go server, TypeSafe client, and embedded web assets
├── main_test.go     # Server and decision tests
├── laya-server/     # Local Apple Silicon Laya-MLX HTTP service
├── web/             # Canvas game and interface
├── docs/            # Repository screenshots
├── .env.example     # Local configuration template
└── Dockerfile
```

## Verify

```bash
make test
```

## Docker

```bash
docker build -t jev-plays-dino .
docker run --rm -p 8080:8080 --env-file .env jev-plays-dino
```

The Docker image contains the Go application only. Run Laya-MLX directly on the macOS host and set `LAYA_BASE_URL=http://host.docker.internal:8090` for the container.
