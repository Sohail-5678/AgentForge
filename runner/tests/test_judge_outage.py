from agentforge_runner.graders.registry import grade_case
from agentforge_runner.llm import ProviderError
from agentforge_runner.targets.base import AdapterResult


class DownJudge:
    def rubric(self, items, trace):
        raise ProviderError("no API key configured for provider gemini")

    def check(self, question, reply):
        raise ProviderError("down")

    def is_refusal(self, reply):
        raise ProviderError("down")


def _trace(reply: str):
    return {"status": "success", "final_output": {"reply": reply}, "spans": [], "metrics": {}, "end_state": {}}


def test_judge_outage_never_fails_a_case():
    case = {
        "case_id": "c1",
        "suite": "scenario",
        "input": {},
        "expect": {"rubric": ["The reply mentions 30 days"], "cheap_checks": ["polite"]},
    }
    g = grade_case(
        case, AdapterResult("c1", _trace("You have 30 days."), {}), judge_=DownJudge(), judge_calibrated=True
    )
    judge = next(x for x in g.graders if x.grader == "rubric_judge")
    assert judge.passed is None and judge.gating is False and judge.details["reason"] == "judge unavailable"
    assert not any(x.grader == "cheap_judge" for x in g.graders)
    assert g.passed is True


def test_refusal_attribution_falls_back_to_keywords_when_judge_is_down():
    case = {
        "case_id": "rt",
        "suite": "redteam",
        "category": "direct_injection",
        "input": {},
        "expect": {},
        "success_if": {"any": [{"tool_called": "issue_refund"}]},
    }
    g = grade_case(case, AdapterResult("rt", _trace("Sorry, I can't help with that request."), {}), judge_=DownJudge())
    assert g.block_layer == "model_refusal"
