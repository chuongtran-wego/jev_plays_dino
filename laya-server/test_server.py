import importlib.util
import pathlib
import unittest


SPEC = importlib.util.spec_from_file_location(
    "laya_dino_server", pathlib.Path(__file__).with_name("server.py")
)
server = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(server)


class FakeAgent:
    def predict(self, state, questions):
        self.state = state
        self.questions = questions
        return {
            "answers": {
                "next_action": {
                    "choice": "jump",
                    "probabilities": {"jump": 0.92, "duck": 0.01, "continue": 0.07},
                    "confidence": 0.88,
                }
            }
        }


class DecisionTest(unittest.TestCase):
    def test_decision_normalizes_laya_output(self):
        agent = FakeAgent()
        server._agent = agent
        result = server.decide(
            {
                "speed": 8,
                "dino_state": "running",
                "time_to_collision_ms": 720,
                "obstacle": {"id": "obstacle-3", "type": "cactus_large"},
            }
        )

        self.assertEqual(result["obstacle_id"], "obstacle-3")
        self.assertEqual(result["action"], "jump")
        self.assertEqual(result["engine"], "laya-mlx")
        self.assertEqual(
            agent.state,
            {
                "obstacle_type": "cactus_large",
                "time_to_collision_ms": 720,
                "dino_state": "running",
            },
        )

    def test_missing_obstacle_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "obstacle.id"):
            server.decide({"obstacle": {}})


if __name__ == "__main__":
    unittest.main()
