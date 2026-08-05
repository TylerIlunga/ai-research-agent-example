import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { closeDanglingToolCalls, extractPlan } from "../agents/researchAgent";

describe("closeDanglingToolCalls", () => {
  it("returns nothing for an empty transcript", () => {
    const transcript: AIMessage[] = [];
    expect(closeDanglingToolCalls(transcript)).toEqual([]);
    expect(transcript).toHaveLength(0);
  });

  it("leaves a transcript ending in plain text alone", () => {
    const transcript = [new HumanMessage("q"), new AIMessage("answer")];
    expect(closeDanglingToolCalls(transcript)).toEqual([]);
    expect(transcript).toHaveLength(2);
  });

  it("closes a single dangling call in place", () => {
    const transcript = [
      new HumanMessage("q"),
      new AIMessage({
        content: "",
        tool_calls: [{ id: "call_1", name: "web_search", args: { query: "x" } }],
      }),
    ];

    const repairs = closeDanglingToolCalls(transcript);

    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toBeInstanceOf(ToolMessage);
    expect(repairs[0].tool_call_id).toBe("call_1");
    expect(repairs[0].name).toBe("web_search");
    // Mutated in place so the checkpointed thread is the repaired one.
    expect(transcript).toHaveLength(3);
    expect(transcript[2]).toBe(repairs[0]);
  });

  it("closes every call of a parallel tool round", () => {
    const transcript = [
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "a", name: "web_search", args: {} },
          { id: "b", name: "recall_memory", args: {} },
          { id: "c", name: "save_memory", args: {} },
        ],
      }),
    ];

    const repairs = closeDanglingToolCalls(transcript);

    expect(repairs.map((r) => r.tool_call_id)).toEqual(["a", "b", "c"]);
    expect(transcript).toHaveLength(4);
  });

  it("is idempotent — a second pass adds nothing", () => {
    const transcript = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: "a", name: "web_search", args: {} }],
      }),
    ];

    closeDanglingToolCalls(transcript);
    const second = closeDanglingToolCalls(transcript);

    expect(second).toEqual([]);
    expect(transcript).toHaveLength(2);
  });

  it("tolerates a call with no id", () => {
    const transcript = [
      new AIMessage({
        content: "",
        tool_calls: [{ id: undefined, name: "web_search", args: {} }],
      }),
    ];

    const repairs = closeDanglingToolCalls(transcript);
    expect(repairs).toHaveLength(1);
    expect(repairs[0].tool_call_id).toBe("");
  });
});

describe("extractPlan", () => {
  it("parses a clean JSON object", () => {
    const plan = extractPlan('{"objective":"o","questions":["a","b"]}');
    expect(plan).toEqual({ objective: "o", questions: ["a", "b"] });
  });

  it("pulls the object out of a markdown fence with prose around it", () => {
    const text = 'Here is the plan:\n```json\n{"objective":"o","questions":["a"]}\n```\nDone.';
    expect(extractPlan(text)).toEqual({ objective: "o", questions: ["a"] });
  });

  it("returns null for text with no JSON", () => {
    expect(extractPlan("I could not produce a plan.")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(extractPlan('{"objective": "o", "questions": [unquoted]}')).toBeNull();
  });

  it("returns null when there are no usable questions", () => {
    expect(extractPlan('{"objective":"o","questions":[]}')).toBeNull();
    expect(extractPlan('{"objective":"o","questions":[42, "", "   "]}')).toBeNull();
    expect(extractPlan('{"objective":"o"}')).toBeNull();
  });

  it("filters non-strings and caps at five questions", () => {
    const questions = ["a", 1, "b", null, "c", "d", "e", "f", "g"];
    const plan = extractPlan(JSON.stringify({ objective: "o", questions }));
    expect(plan?.questions).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("trims whitespace from the objective and questions", () => {
    const plan = extractPlan('{"objective":"  o  ","questions":["  a  "]}');
    expect(plan).toEqual({ objective: "o", questions: ["a"] });
  });

  it("treats a missing objective as empty rather than failing", () => {
    const plan = extractPlan('{"questions":["a"]}');
    expect(plan).toEqual({ objective: "", questions: ["a"] });
  });
});
