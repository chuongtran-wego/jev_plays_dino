package main

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

//go:embed web/*
var webFiles embed.FS

type obstacleState struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"`
	Distance float64 `json:"distance"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Y        float64 `json:"y"`
}

type decisionRequest struct {
	Speed           float64       `json:"speed"`
	Score           int           `json:"score"`
	DinoState       string        `json:"dino_state"`
	TimeToCollision float64       `json:"time_to_collision_ms"`
	Obstacle        obstacleState `json:"obstacle"`
}

type decisionResponse struct {
	ObstacleID   string             `json:"obstacle_id"`
	Action       string             `json:"action"`
	Probabilities map[string]float64 `json:"probabilities"`
	Confidence   float64            `json:"confidence"`
	CollisionRisk float64           `json:"collision_risk"`
	LatencyMS    int64              `json:"latency_ms"`
	Engine       string             `json:"engine"`
}

type jevClient struct {
	apiKey string
	baseURL string
	client *http.Client
}

func newJevClient() *jevClient {
	baseURL := strings.TrimRight(os.Getenv("TYPESAFE_BASE_URL"), "/")
	if baseURL == "" {
		baseURL = "https://api.typesafe.ai"
	}
	return &jevClient{
		apiKey: os.Getenv("TYPESAFE_API_KEY"),
		baseURL: baseURL,
		client: &http.Client{Timeout: 3 * time.Second},
	}
}

func (c *jevClient) decide(ctx context.Context, state decisionRequest) (decisionResponse, error) {
	started := time.Now()
	if c.apiKey == "" {
		select {
		case <-time.After(90 * time.Millisecond):
		case <-ctx.Done():
			return decisionResponse{}, ctx.Err()
		}
		result := mockDecision(state)
		result.LatencyMS = time.Since(started).Milliseconds()
		result.Engine = "simulation"
		return result, nil
	}

	payload := map[string]any{
		"model": "jev-latest",
		"state": state,
		"questions": map[string]any{
			"next_action": map[string]any{
				"type": "choice",
				"instructions": "Choose the safest immediate action for the dinosaur. Account for obstacle type, distance, speed, time to collision, and current dinosaur state. Do not act earlier than necessary.",
				"criteria": map[string]any{
					"jump": "Jump now to clear a ground obstacle or a bird that cannot be safely ducked under.",
					"duck": "Duck now under a low-flying bird.",
					"continue": "Do not press a key yet; keep running or keep the current airborne motion.",
				},
			},
			"collision_risk": map[string]any{
				"type": "score",
				"instructions": "Rate the risk of collision if no new action is taken now.",
				"criteria": []string{"Very low", "Low", "Medium", "High", "Imminent"},
			},
		},
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return decisionResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/systemone", bytes.NewReader(body))
	if err != nil {
		return decisionResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.client.Do(req)
	if err != nil {
		return decisionResponse{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return decisionResponse{}, fmt.Errorf("typesafe returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}

	var result struct {
		Answers struct {
			NextAction struct {
				Choice        string             `json:"choice"`
				Probabilities map[string]float64 `json:"probabilities"`
				Confidence    float64            `json:"confidence"`
			} `json:"next_action"`
			CollisionRisk struct {
				Score float64 `json:"score"`
			} `json:"collision_risk"`
		} `json:"answers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return decisionResponse{}, err
	}
	if !validAction(result.Answers.NextAction.Choice) {
		return decisionResponse{}, errors.New("typesafe returned an invalid action")
	}

	return decisionResponse{
		ObstacleID: state.Obstacle.ID,
		Action: result.Answers.NextAction.Choice,
		Probabilities: result.Answers.NextAction.Probabilities,
		Confidence: result.Answers.NextAction.Confidence,
		CollisionRisk: result.Answers.CollisionRisk.Score,
		LatencyMS: time.Since(started).Milliseconds(),
		Engine: "jev",
	}, nil
}

func validAction(action string) bool {
	return action == "jump" || action == "duck" || action == "continue"
}

func mockDecision(state decisionRequest) decisionResponse {
	action := "continue"
	probabilities := map[string]float64{"jump": 0.05, "duck": 0.03, "continue": 0.92}
	distance := state.Obstacle.Distance
	risk := 0.6

	if strings.HasPrefix(state.Obstacle.Type, "cactus") {
		threshold := 122.0 + state.Speed*5
		if distance <= threshold && state.DinoState == "running" {
			action = "jump"
			probabilities = map[string]float64{"jump": 0.93, "duck": 0.01, "continue": 0.06}
			risk = 4.4
		} else if distance < threshold+90 {
			probabilities = map[string]float64{"jump": 0.36, "duck": 0.02, "continue": 0.62}
			risk = 2.7
		}
	} else if state.Obstacle.Type == "bird_low" {
		if distance <= 135 {
			action = "duck"
			probabilities = map[string]float64{"jump": 0.08, "duck": 0.87, "continue": 0.05}
			risk = 4.2
		}
	} else if state.Obstacle.Type == "bird_high" {
		probabilities = map[string]float64{"jump": 0.03, "duck": 0.04, "continue": 0.93}
		risk = 0.4
	}

	confidence := probabilities[action]
	return decisionResponse{
		ObstacleID: state.Obstacle.ID,
		Action: action,
		Probabilities: probabilities,
		Confidence: confidence,
		CollisionRisk: risk,
	}
}

type rateLimiter struct {
	mu sync.Mutex
	clients map[string]*rateWindow
}

type rateWindow struct {
	start time.Time
	count int
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{clients: make(map[string]*rateWindow)}
}

func (r *rateLimiter) allow(ip string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	w, ok := r.clients[ip]
	if !ok || now.Sub(w.start) >= time.Minute {
		r.clients[ip] = &rateWindow{start: now, count: 1}
		return true
	}
	if w.count >= 180 {
		return false
	}
	w.count++
	return true
}

func clientIP(req *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(req.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err == nil {
		return host
	}
	return req.RemoteAddr
}

func main() {
	if err := loadDotEnv(".env"); err != nil {
		log.Fatalf("load .env: %v", err)
	}
	client := newJevClient()
	limiter := newRateLimiter()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "engine": map[bool]string{true: "jev", false: "simulation"}[client.apiKey != ""]})
	})
	mux.HandleFunc("POST /api/decision", func(w http.ResponseWriter, req *http.Request) {
		if !limiter.allow(clientIP(req)) {
			writeJSON(w, http.StatusTooManyRequests, map[string]string{"error": "rate limit exceeded"})
			return
		}
		req.Body = http.MaxBytesReader(w, req.Body, 16<<10)
		var state decisionRequest
		if err := json.NewDecoder(req.Body).Decode(&state); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request"})
			return
		}
		if state.Obstacle.ID == "" || state.Obstacle.Type == "" || state.Speed <= 0 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "missing game state"})
			return
		}
		result, err := client.decide(req.Context(), state)
		if err != nil {
			log.Printf("decision error: %v", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "decision service unavailable"})
			return
		}
		writeJSON(w, http.StatusOK, result)
	})

	static, err := fs.Sub(webFiles, "web")
	if err != nil {
		log.Fatal(err)
	}
	mux.Handle("/", http.FileServer(http.FS(static)))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	if _, err := strconv.Atoi(port); err != nil {
		log.Fatalf("invalid PORT %q", port)
	}

	server := &http.Server{
		Addr: ":" + port,
		Handler: securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 5 * time.Second,
		WriteTimeout: 8 * time.Second,
		IdleTimeout: 60 * time.Second,
	}
	log.Printf("Jev Plays Dino listening on http://localhost:%s", port)
	log.Fatal(server.ListenAndServe())
}

func loadDotEnv(path string) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	for lineNumber, rawLine := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, found := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !found || key == "" {
			return fmt.Errorf("invalid entry on line %d", lineNumber+1)
		}
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		if _, exists := os.LookupEnv(key); !exists {
			if err := os.Setenv(key, value); err != nil {
				return err
			}
		}
	}
	return nil
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'")
		next.ServeHTTP(w, req)
	})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
