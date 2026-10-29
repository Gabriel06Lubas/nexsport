import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// Guards against "Trojan Source" style code: invisible and bidirectional
// control characters that make source read differently from how it runs.
// Write such characters as escapes (\u202e) instead.

const FORBIDDEN = /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
const ROOTS = ["src", "e2e", "scripts", "drizzle", "tests"];
const EXTENSIONS = /\.(ts|tsx|mjs|js|sql|json|css)$/;

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (EXTENSIONS.test(name)) yield path;
  }
}

describe("source files", () => {
  it("contain no invisible or bidi control characters", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of files(root)) {
        readFileSync(file, "utf8")
          .split("\n")
          .forEach((line, i) => FORBIDDEN.test(line) && offenders.push(`${file}:${i + 1}`));
      }
    }
    expect(offenders).toEqual([]);
  });
});
