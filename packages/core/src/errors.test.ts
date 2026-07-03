import { describe, it, expect } from "vitest";
import {
  DemoForgeError,
  ValidationError,
  RenderError,
  ExplorerError,
  HealError,
  ConfigError,
} from "../src/index.js";

describe("DemoForgeError base class", () => {
  it("should have name, message, and demoforge property", () => {
    const err = new DemoForgeError("test error");
    expect(err.name).toBe("DemoForgeError");
    expect(err.message).toBe("test error");
    expect(err.demoforge).toBe(true);
  });

  it("should have a stack trace", () => {
    const err = new DemoForgeError("test");
    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe("string");
  });

  it("should be catchable as DemoForgeError", () => {
    try {
      throw new ValidationError("validation failed");
    } catch (e) {
      expect(e).toBeInstanceOf(DemoForgeError);
      expect(e).toBeInstanceOf(ValidationError);
    }
  });
});

describe("ValidationError", () => {
  it("should have correct name", () => {
    const err = new ValidationError("invalid script");
    expect(err.name).toBe("ValidationError");
  });

  it("should extend DemoForgeError", () => {
    const err = new ValidationError("test");
    expect(err).toBeInstanceOf(DemoForgeError);
  });

  it("should store issues", () => {
    const issues = [{ path: ["demo"], message: "required" }];
    const err = new ValidationError("invalid", { issues });
    expect(err.issues).toEqual(issues);
  });

  it("should have issues as undefined when not provided", () => {
    const err = new ValidationError("test");
    expect(err.issues).toBeUndefined();
  });
});

describe("RenderError", () => {
  it("should have correct name", () => {
    const err = new RenderError("encoding failed");
    expect(err.name).toBe("RenderError");
  });

  it("should extend DemoForgeError", () => {
    const err = new RenderError("test");
    expect(err).toBeInstanceOf(DemoForgeError);
  });

  it("should store step info", () => {
    const err = new RenderError("failed at step", { stepIndex: 3, stepType: "click" });
    expect(err.stepIndex).toBe(3);
    expect(err.stepType).toBe("click");
  });
});

describe("ExplorerError", () => {
  it("should have correct name", () => {
    const err = new ExplorerError("agent loop failed");
    expect(err.name).toBe("ExplorerError");
  });

  it("should extend DemoForgeError", () => {
    const err = new ExplorerError("test");
    expect(err).toBeInstanceOf(DemoForgeError);
  });

  it("should store turn info", () => {
    const err = new ExplorerError("timeout", { turn: 5, budgetExceeded: "steps" });
    expect(err.turn).toBe(5);
    expect(err.budgetExceeded).toBe("steps");
  });
});

describe("HealError", () => {
  it("should have correct name", () => {
    const err = new HealError("selector repair failed");
    expect(err.name).toBe("HealError");
  });

  it("should extend DemoForgeError", () => {
    const err = new HealError("test");
    expect(err).toBeInstanceOf(DemoForgeError);
  });

  it("should store selector info", () => {
    const err = new HealError("no match found", {
      oldSelector: "#btn",
      newSelector: "button.submit",
      reason: "element not found",
    });
    expect(err.oldSelector).toBe("#btn");
    expect(err.newSelector).toBe("button.submit");
    expect(err.reason).toBe("element not found");
  });
});

describe("ConfigError", () => {
  it("should have correct name", () => {
    const err = new ConfigError("missing config file");
    expect(err.name).toBe("ConfigError");
  });

  it("should extend DemoForgeError", () => {
    const err = new ConfigError("test");
    expect(err).toBeInstanceOf(DemoForgeError);
  });

  it("should store path info", () => {
    const err = new ConfigError("not found", { path: "/nonexistent/demoforge.yaml" });
    expect(err.path).toBe("/nonexistent/demoforge.yaml");
  });
});

describe("Common handler", () => {
  it("should catch all error types with a DemoForgeError handler", () => {
    const errors: DemoForgeError[] = [
      new ValidationError("v"),
      new RenderError("r"),
      new ExplorerError("e"),
      new HealError("h"),
      new ConfigError("c"),
    ];

    for (const err of errors) {
      expect(err).toBeInstanceOf(DemoForgeError);
      expect(err.demoforge).toBe(true);
      expect(err.name).toMatch(/^(ValidationError|RenderError|ExplorerError|HealError|ConfigError|DemoForgeError)$/);
    }
  });

  it("should allow try/catch with base class", () => {
    const handler = (err: unknown) => {
      if (err instanceof DemoForgeError) {
        return err.message;
      }
      return null;
    };

    expect(handler(new ValidationError("test"))).toBe("test");
    expect(handler(new RenderError("test"))).toBe("test");
    expect(handler(new ExplorerError("test"))).toBe("test");
    expect(handler(new HealError("test"))).toBe("test");
    expect(handler(new ConfigError("test"))).toBe("test");
    expect(handler(new DemoForgeError("test"))).toBe("test");
    expect(handler(new Error("plain error"))).toBe(null);
  });
});
