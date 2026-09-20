package main

import "testing"

func TestMockDecisionCactus(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed: 8,
		DinoState: "running",
		Obstacle: obstacleState{ID: "1", Type: "cactus_large", Distance: 100},
	})
	if got.Action != "jump" {
		t.Fatalf("expected jump, got %s", got.Action)
	}
}

func TestMockDecisionLowBird(t *testing.T) {
	got := mockDecision(decisionRequest{
		Speed: 8,
		DinoState: "running",
		Obstacle: obstacleState{ID: "1", Type: "bird_low", Distance: 100},
	})
	if got.Action != "duck" {
		t.Fatalf("expected duck, got %s", got.Action)
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
