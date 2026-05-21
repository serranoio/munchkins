import { describe, expect, test } from "bun:test";
import {
  type ParseSummaryWriterJsonResult,
  parseSummaryWriterJson,
} from "./parse-summary-writer-json.js";

function assertOk(
  r: ParseSummaryWriterJsonResult,
): asserts r is Extract<ParseSummaryWriterJsonResult, { ok: true }> {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("unreachable: expect above would have failed");
}

function assertErr(
  r: ParseSummaryWriterJsonResult,
): asserts r is Extract<ParseSummaryWriterJsonResult, { ok: false }> {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("unreachable: expect above would have failed");
}

describe("parseSummaryWriterJson", () => {
  test("1: single envelope parses cleanly", () => {
    const r = parseSummaryWriterJson('{"commitMessage":"x","markdown":"y"}');
    assertOk(r);
    expect(r.commitMessage).toBe("x");
    expect(r.markdown).toBe("y");
  });

  test("2: duplicate envelope (production regression) — last wins", () => {
    const dup = '{"commitMessage":"x","markdown":"y"}\n\n{"commitMessage":"x","markdown":"y"}';
    const r = parseSummaryWriterJson(dup);
    assertOk(r);
    expect(r.commitMessage).toBe("x");
    expect(r.markdown).toBe("y");
  });

  test("3: duplicate envelopes with different content — second one wins", () => {
    const dup = '{"commitMessage":"a","markdown":"a"}\n\n{"commitMessage":"b","markdown":"b"}';
    const r = parseSummaryWriterJson(dup);
    assertOk(r);
    expect(r.commitMessage).toBe("b");
    expect(r.markdown).toBe("b");
  });

  test("4: prose preceding the envelope is ignored", () => {
    const r = parseSummaryWriterJson('some prose\n\n{"commitMessage":"x","markdown":"y"}');
    assertOk(r);
    expect(r.commitMessage).toBe("x");
    expect(r.markdown).toBe("y");
  });

  test("5: trailing ``` fence is stripped before parsing", () => {
    const r = parseSummaryWriterJson('{"commitMessage":"x","markdown":"y"}\n```');
    assertOk(r);
    expect(r.commitMessage).toBe("x");
    expect(r.markdown).toBe("y");
  });

  test("6: brace inside a JSON string literal does not break depth tracking", () => {
    const r = parseSummaryWriterJson('{"commitMessage":"x","markdown":"see {a, b, c}"}');
    assertOk(r);
    expect(r.markdown).toBe("see {a, b, c}");
  });

  test("7: escaped quote inside a string literal is handled", () => {
    const r = parseSummaryWriterJson(
      '{"commitMessage":"x","markdown":"escaped \\"quote\\" inside"}',
    );
    assertOk(r);
    expect(r.markdown).toBe('escaped "quote" inside');
  });

  test("8: no JSON at all → ok:false with clear reason", () => {
    const r = parseSummaryWriterJson("no json here");
    assertErr(r);
    expect(r.reason).toMatch(/no JSON object found/);
  });

  test("9: object missing commitMessage/markdown → ok:false", () => {
    const r = parseSummaryWriterJson('{"foo":"bar"}');
    assertErr(r);
    expect(r.reason).toMatch(/no parseable JSON object with string commitMessage and markdown/);
  });

  test("10: markdown is a number, not a string → ok:false", () => {
    const r = parseSummaryWriterJson('{"commitMessage":"x","markdown":42}');
    assertErr(r);
    expect(r.reason).toMatch(/no parseable JSON object with string commitMessage and markdown/);
  });

  test("11: last-valid wins when first candidate is missing markdown", () => {
    const r = parseSummaryWriterJson(
      '{"commitMessage":"a"} not json {"commitMessage":"b","markdown":"b"}',
    );
    assertOk(r);
    expect(r.commitMessage).toBe("b");
    expect(r.markdown).toBe("b");
  });

  test("12: realistic summary writer response with prose, fence, and full envelope", () => {
    const fixture = [
      "I've reviewed the staged diff and produced a summary.",
      "",
      "```json",
      JSON.stringify({
        commitMessage: "fix(builder): tolerate duplicate JSON envelope from summary writer",
        markdown: [
          "## What changed",
          "",
          "- Replaced the regex extractor with a balanced-brace scan.",
          "- Added unit tests covering the duplicate-emit regression.",
          "",
          "## Why",
          "",
          "Models occasionally emit the JSON envelope twice; the harness should tolerate it.",
        ].join("\n"),
      }),
      "```",
    ].join("\n");
    const r = parseSummaryWriterJson(fixture);
    assertOk(r);
    expect(r.commitMessage).toBe(
      "fix(builder): tolerate duplicate JSON envelope from summary writer",
    );
    expect(r.markdown).toContain("## What changed");
    expect(r.markdown).toContain("## Why");
  });
});
