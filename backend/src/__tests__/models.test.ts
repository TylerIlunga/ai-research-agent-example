import { AIMessage } from "@langchain/core/messages";
import { textOf } from "../models";

describe("textOf", () => {
  it("passes plain string content through", () => {
    expect(textOf(new AIMessage("hello"))).toBe("hello");
  });

  it("joins the text blocks of block-array content", () => {
    const message = new AIMessage({
      content: [
        { type: "text", text: "part one " },
        { type: "text", text: "part two" },
      ],
    });
    expect(textOf(message)).toBe("part one part two");
  });

  it("skips thinking blocks so reasoning never leaks into the answer", () => {
    const message = new AIMessage({
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "the answer" },
      ] as never,
    });
    expect(textOf(message)).toBe("the answer");
  });

  it("tolerates bare strings inside a block array", () => {
    expect(textOf({ content: ["a", { type: "text", text: "b" }] })).toBe("ab");
  });

  it("returns empty string for content that is neither string nor array", () => {
    expect(textOf({ content: 42 })).toBe("");
    expect(textOf({ content: null })).toBe("");
    expect(textOf({ content: undefined })).toBe("");
  });

  it("ignores malformed blocks instead of throwing", () => {
    expect(textOf({ content: [null, {}, { type: "text" }, { type: "text", text: "ok" }] })).toBe(
      "ok"
    );
  });
});
