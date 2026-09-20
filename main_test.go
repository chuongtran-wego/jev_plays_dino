package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}

type eofTrackingBody struct {
	reader *strings.Reader
	sawEOF bool
}

func (b *eofTrackingBody) Read(p []byte) (int, error) {
	n, err := b.reader.Read(p)
	if err == io.EOF {
		b.sawEOF = true
	}
	return n, err
}

func (b *eofTrackingBody) Close() error { return nil }

func TestMockDecisionCactus(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed:     8,
		DinoState: "running",
		Obstacle:  obstacleState{ID: "1", Type: "cactus_large", Distance: 100},
	})
	if got.Action != "jump" {
		t.Fatalf("expected jump, got %s", got.Action)
	}
}

func TestMockDecisionPlansForFarCactus(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed:     6,
		DinoState: "running",
		Obstacle:  obstacleState{ID: "1", Type: "cactus_large", Distance: 464},
	})
	if got.Action != "jump" {
		t.Fatalf("expected a jump plan for far cactus, got %s", got.Action)
	}
}

func TestMockDecisionLowBird(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed:     8,
		DinoState: "running",
		Obstacle:  obstacleState{ID: "1", Type: "bird_low", Distance: 100},
	})
	if got.Action != "duck" {
		t.Fatalf("expected duck, got %s", got.Action)
	}
}

func TestMockDecisionPlansForFarLowBird(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed:     6,
		DinoState: "running",
		Obstacle:  obstacleState{ID: "1", Type: "bird_low", Distance: 464},
	})
	if got.Action != "duck" {
		t.Fatalf("expected a duck plan for far low bird, got %s", got.Action)
	}
}

func TestJevClientWarmPreconnectsWithAuthentication(t *testing.T) {
	var method, path, authorization string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		method = req.Method
		path = req.URL.Path
		authorization = req.Header.Get("Authorization")
		w.WriteHeader(http.StatusMethodNotAllowed)
	}))
	defer server.Close()

	client := &jevClient{
		apiKey:  "test-key",
		baseURL: server.URL,
		client:  server.Client(),
	}
	if err := client.warm(context.Background()); err != nil {
		t.Fatalf("warm connection: %v", err)
	}
	if method != http.MethodHead {
		t.Fatalf("expected HEAD warm-up, got %s", method)
	}
	if path != "/v1/systemone" {
		t.Fatalf("expected systemone path, got %s", path)
	}
	if authorization != "Bearer test-key" {
		t.Fatalf("expected bearer authorization, got %q", authorization)
	}
}

func TestJevClientSendsMinimalStateAndActionQuestion(t *testing.T) {
	var payload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if err := json.NewDecoder(req.Body).Decode(&payload); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"answers":{"next_action":{"choice":"jump","probabilities":{"jump":0.95,"duck":0.02,"continue":0.03},"confidence":0.95}}}`)
	}))
	defer server.Close()

	client := &jevClient{apiKey: "test-key", baseURL: server.URL, client: server.Client()}
	_, err := client.decide(context.Background(), decisionRequest{
		Speed:           6,
		Score:           42,
		DinoState:       "running",
		TimeToCollision: 1200,
		Obstacle:        obstacleState{ID: "obstacle-1", Type: "cactus_large", Distance: 432, Width: 36, Height: 66, Y: 294},
	})
	if err != nil {
		t.Fatalf("decide: %v", err)
	}

	wantState := map[string]any{
		"dino_state":           "running",
		"obstacle_type":        "cactus_large",
		"time_to_collision_ms": float64(1200),
	}
	if got := payload["state"]; !reflect.DeepEqual(got, wantState) {
		t.Fatalf("unexpected model state: %#v", got)
	}
	questions, ok := payload["questions"].(map[string]any)
	if !ok {
		t.Fatalf("questions is not an object: %#v", payload["questions"])
	}
	if len(questions) != 1 || questions["next_action"] == nil {
		t.Fatalf("expected only next_action question, got %#v", questions)
	}
}

func TestJevClientReadsSuccessfulResponseToEOF(t *testing.T) {
	body := &eofTrackingBody{reader: strings.NewReader(`{"answers":{"next_action":{"choice":"jump","probabilities":{"jump":1},"confidence":1}}}`)}
	client := &jevClient{
		apiKey:  "test-key",
		baseURL: "https://example.test",
		client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: http.StatusOK, Body: body, Header: make(http.Header)}, nil
		})},
	}

	_, err := client.decide(context.Background(), decisionRequest{Obstacle: obstacleState{ID: "1", Type: "cactus_large"}})
	if err != nil {
		t.Fatalf("decide: %v", err)
	}
	if !body.sawEOF {
		t.Fatal("expected response body to be read to EOF for connection reuse")
	}
}

func TestJevClientReadsErrorResponseToEOF(t *testing.T) {
	body := &eofTrackingBody{reader: strings.NewReader(strings.Repeat("x", 3000))}
	client := &jevClient{
		apiKey:  "test-key",
		baseURL: "https://example.test",
		client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusBadGateway,
				Status:     "502 Bad Gateway",
				Body:       body,
				Header:     make(http.Header),
			}, nil
		})},
	}

	_, err := client.decide(context.Background(), decisionRequest{Obstacle: obstacleState{ID: "1", Type: "cactus_large"}})
	if err == nil {
		t.Fatal("expected non-2xx response to fail")
	}
	if !body.sawEOF {
		t.Fatal("expected error response body to be read to EOF for connection reuse")
	}
}

func TestValidAction(t *testing.T) {
	for _, action := range []string{"jump", "duck", "continue"} {
		if !validAction(action) {
			t.Fatalf("expected %s to be valid", action)
		}
	}
	if validAction("fly") {
		t.Fatal("fly must be invalid")
	}
}

func TestFormatDecisionLogIncludesOnlyAPILatencyAndProbabilities(t *testing.T) {
	result := decisionResponse{
		ObstacleID: "obstacle-7",
		Action:     "jump",
		Probabilities: map[string]float64{
			"jump":     0.93,
			"duck":     0.01,
			"continue": 0.06,
		},
		LatencyMS: 287,
		Engine:    "jev",
	}

	line := formatDecisionLog(result, 305*time.Millisecond)
	for _, want := range []string{
		"api_latency_ms=287",
		`probabilities={"continue":0.06,"duck":0.01,"jump":0.93}`,
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("expected log line to contain %q, got %q", want, line)
		}
	}
	for _, unwanted := range []string{"response=", "server_latency_ms=", "obstacle-7", "action=", "engine="} {
		if strings.Contains(line, unwanted) {
			t.Fatalf("expected log line not to contain %q, got %q", unwanted, line)
		}
	}
}
