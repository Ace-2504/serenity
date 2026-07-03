import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password";

describe("password hashing", () => {
  it("verifies a correct password", () => {
    const encoded = hashPassword("s3cret!");
    expect(verifyPassword("s3cret!", encoded)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const encoded = hashPassword("s3cret!");
    expect(verifyPassword("wrong-password", encoded)).toBe(false);
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyPassword("anything", "not-a-valid-hash")).toBe(false);
  });

  it("uses a fresh salt each time (no identical hashes)", () => {
    expect(hashPassword("same-input")).not.toBe(hashPassword("same-input"));
  });
});
