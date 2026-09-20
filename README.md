# Jev Plays Dino

Jev Plays Dino is a browser game that lets [TypeSafe AI](https://typesafe.ai/)'s Jev model control an original pixel dinosaur. Jev receives structured game state and chooses whether to jump, duck, or continue. The interface shows each decision, probability, confidence score, input, and API latency in real time.

![Jev Plays Dino game interface](docs/screenshot.jpg)

## Features

- Three play modes: Human, deterministic Rule bot, and Jev AI.
- Typed Jev decisions with visible probabilities, confidence, collision risk, and latency.
- Starting-speed presets at `1x`, `2x`, and `3x`; every run continues accelerating from the selected starting speed.
- Pixel-style sound effects implemented with the Web Audio API.
- Responsive two-panel interface with the game on the left and the decision log on the right.
- Simulation fallback when no TypeSafe API key is configured.

## Requirements

- Go 1.22 or newer.
- A TypeSafe API key for live Jev decisions. The game still runs in simulation mode without one.

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
PORT=8080
```

Start the server:

```bash
go run .
```

Open <http://localhost:8080>. Values already exported in your shell take precedence over `.env`.

## Play modes

- **Human** — press `Space` or `Arrow Up` to jump and `Arrow Down` to duck.
- **Rule** — a deterministic local controller uses obstacle type, distance, and current speed.
- **Jev** — the Go server sends structured game state to Jev and returns a typed action.

The `1x`, `2x`, and `3x` controls select the starting speed for the next run. Speed then increases gradually as the score grows, matching the original endless-runner behavior.

## Project structure

```text
.
├── main.go          # Go server, TypeSafe client, and embedded web assets
├── main_test.go     # Server and decision tests
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
