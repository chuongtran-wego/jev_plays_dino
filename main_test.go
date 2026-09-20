package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

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

func TestFormatDecisionLogIncludesResponseAndLatencies(t *testing.T) {
	result := decisionResponse{
		ObstacleID: "obstacle-7",
		Action:     "jump",
		LatencyMS:  287,
		Engine:     "jev",
	}

	line := formatDecisionLog(result, 305*time.Millisecond)
	for _, want := range []string{
		`response={"obstacle_id":"obstacle-7","action":"jump"`,
		"api_latency_ms=287",
		"server_latency_ms=305",
	} {
		if !strings.Contains(line, want) {
			t.Fatalf("expected log line to contain %q, got %q", want, line)
		}
	}
}
