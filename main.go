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
	Count    int     `json:"count,omitempty"`
	Distance float64 `json:"distance"`
	Width    float64 `json:"width"`
	Height   float64 `json:"height"`
	Y        float64 `json:"y"`
}

type decisionRequest struct {
	Engine          string        `json:"engine,omitempty"`
	Speed           float64       `json:"speed"`
	Score           int           `json:"score"`
	DinoState       string        `json:"dino_state"`
	TimeToCollision float64       `json:"time_to_collision_ms"`
	Obstacle        obstacleState `json:"obstacle"`
}

type decisionResponse struct {
	ObstacleID    string             `json:"obstacle_id"`
	Action        string             `json:"action"`
	Probabilities map[string]float64 `json:"probabilities"`
	Confidence    float64            `json:"confidence"`
	LatencyMS     int64              `json:"latency_ms"`
	Engine        string             `json:"engine"`
}

type jevClient struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

type layaClient struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func newJevClient() *jevClient {
	baseURL := strings.TrimRight(os.Getenv("TYPESAFE_BASE_URL"), "/")
	if baseURL == "" {
		baseURL = "https://api.typesafe.ai"
	}
	return &jevClient{
		apiKey:  os.Getenv("TYPESAFE_API_KEY"),
		baseURL: baseURL,
		client:  &http.Client{Timeout: 3 * time.Second},
	}
}

func newLayaClient() *layaClient {
	baseURL := strings.TrimRight(os.Getenv("LAYA_BASE_URL"), "/")
	if baseURL == "" {
		baseURL = "http://127.0.0.1:8090"
	}
	return &layaClient{
		apiKey:  os.Getenv("LAYA_API_KEY"),
		baseURL: baseURL,
		client:  &http.Client{Timeout: 3 * time.Second},
	}
}

func (c *jevClient) warm(ctx context.Context) error {
	if c.apiKey == "" {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, c.baseURL+"/v1/systemone", nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)

	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	_, err = io.Copy(io.Discard, resp.Body)
	return err
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

	modelState := map[string]any{
		"obstacle_type":        state.Obstacle.Type,
		"time_to_collision_ms": state.TimeToCollision,
		"dino_state":           state.DinoState,
	}
	payload := map[string]any{
		"model": "jev-latest",
		"state": modelState,
		"questions": map[string]any{
			"next_action": map[string]any{
				"type":         "choice",
				"instructions": "Select the maneuver for this obstacle.",
				"criteria": map[string]any{
					"jump":     "Ground cactus.",
					"duck":     "Low bird.",
					"continue": "High bird.",
				},
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
		data, readErr := io.ReadAll(io.LimitReader(resp.Body, 2048))
		_, drainErr := io.Copy(io.Discard, resp.Body)
		if readErr != nil {
			return decisionResponse{}, readErr
		}
		if drainErr != nil {
			return decisionResponse{}, drainErr
		}
		return decisionResponse{}, fmt.Errorf("typesafe returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}

	var result struct {
		Answers struct {
			NextAction struct {
				Choice        string             `json:"choice"`
				Probabilities map[string]float64 `json:"probabilities"`
				Confidence    float64            `json:"confidence"`
			} `json:"next_action"`
		} `json:"answers"`
	}
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return decisionResponse{}, err
	}
	if err := json.Unmarshal(responseBody, &result); err != nil {
		return decisionResponse{}, err
	}
	if !validAction(result.Answers.NextAction.Choice) {
		return decisionResponse{}, errors.New("typesafe returned an invalid action")
	}

	return decisionResponse{
		ObstacleID:    state.Obstacle.ID,
		Action:        result.Answers.NextAction.Choice,
		Probabilities: result.Answers.NextAction.Probabilities,
		Confidence:    result.Answers.NextAction.Confidence,
		LatencyMS:     time.Since(started).Milliseconds(),
		Engine:        "jev",
	}, nil
}

func (c *layaClient) health(ctx context.Context) bool {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode >= 200 && resp.StatusCode < 300
}

func (c *layaClient) decide(ctx context.Context, state decisionRequest) (decisionResponse, error) {
	started := time.Now()
	state.Engine = ""
	body, err := json.Marshal(state)
	if err != nil {
		return decisionResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/decision", bytes.NewReader(body))
	if err != nil {
		return decisionResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if c.apiKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.apiKey)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return decisionResponse{}, err
	}
	defer resp.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(resp.Body, 16<<10))
	_, drainErr := io.Copy(io.Discard, resp.Body)
	if readErr != nil {
		return decisionResponse{}, readErr
	}
	if drainErr != nil {
		return decisionResponse{}, drainErr
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return decisionResponse{}, fmt.Errorf("laya returned %s: %s", resp.Status, strings.TrimSpace(string(data)))
	}

	var result decisionResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return decisionResponse{}, err
	}
	if result.ObstacleID != state.Obstacle.ID {
		return decisionResponse{}, errors.New("laya returned a stale obstacle id")
	}
	if !validAction(result.Action) {
		return decisionResponse{}, errors.New("laya returned an invalid action")
	}
	if result.Probabilities == nil {
		return decisionResponse{}, errors.New("laya returned no probabilities")
	}
	if result.Engine == "" {
		result.Engine = "laya-mlx"
	}
	if result.LatencyMS <= 0 {
		result.LatencyMS = time.Since(started).Milliseconds()
	}
	return result, nil
}

func validAction(action string) bool {
	return action == "jump" || action == "duck" || action == "continue"
}

func formatDecisionLog(result decisionResponse, _ time.Duration) string {
	probabilities, err := json.Marshal(result.Probabilities)
	if err != nil {
		probabilities = []byte("{}")
	}
	return fmt.Sprintf("decision api_latency_ms=%d probabilities=%s", result.LatencyMS, probabilities)
}

func mockDecision(state decisionRequest) decisionResponse {
	action := "continue"
	probabilities := map[string]float64{"jump": 0.05, "duck": 0.03, "continue": 0.92}
	if strings.HasPrefix(state.Obstacle.Type, "cactus") {
		action = "jump"
		probabilities = map[string]float64{"jump": 0.93, "duck": 0.01, "continue": 0.06}
	} else if state.Obstacle.Type == "bird_low" {
		action = "duck"
		probabilities = map[string]float64{"jump": 0.08, "duck": 0.87, "continue": 0.05}
	} else if state.Obstacle.Type == "bird_high" {
		probabilities = map[string]float64{"jump": 0.03, "duck": 0.04, "continue": 0.93}
	}

	confidence := probabilities[action]
	return decisionResponse{
		ObstacleID:    state.Obstacle.ID,
		Action:        action,
		Probabilities: probabilities,
		Confidence:    confidence,
	}
}

type rateLimiter struct {
	mu      sync.Mutex
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
	laya := newLayaClient()
	if client.apiKey != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		if err := client.warm(ctx); err != nil {
			log.Printf("TypeSafe preconnect failed: %v", err)
		}
		cancel()
	}
	limiter := newRateLimiter()
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 600*time.Millisecond)
		defer cancel()
		layaStatus := "unavailable"
		if laya.health(ctx) {
			layaStatus = "laya-mlx"
		}
		jevStatus := map[bool]string{true: "jev", false: "simulation"}[client.apiKey != ""]
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"engine":  jevStatus,
			"engines": map[string]string{"jev": jevStatus, "laya": layaStatus},
		})
	})
	mux.HandleFunc("POST /api/decision", func(w http.ResponseWriter, req *http.Request) {
		started := time.Now()
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
		var result decisionResponse
		var err error
		switch state.Engine {
		case "", "jev":
			result, err = client.decide(req.Context(), state)
		case "laya":
			result, err = laya.decide(req.Context(), state)
		default:
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown decision engine"})
			return
		}
		if err != nil {
			log.Printf("decision error: %v", err)
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": "decision service unavailable"})
			return
		}
		log.Print(formatDecisionLog(result, time.Since(started)))
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
		Addr:              ":" + port,
		Handler:           securityHeaders(mux),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Second,
		WriteTimeout:      8 * time.Second,
		IdleTimeout:       60 * time.Second,
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
