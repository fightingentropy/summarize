import { describe, expect, it } from "vitest";
import { createUnsupportedFunctionalityError } from "../src/llm/errors.js";

describe("llm errors", () => {
  it("builds a named error with the expected message", () => {
    const error = createUnsupportedFunctionalityError("feature x");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("UnsupportedFunctionalityError");
    expect(error.message).toBe("Functionality not supported: feature x");
  });
});
